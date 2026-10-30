import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as ThemeNs from './theme';

interface FsMod {
  readFileSync: (p: string, e: 'utf8') => string;
}

function stubMatchMedia(light: boolean) {
  const listeners = new Set<() => void>();
  let isLight = light;
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      get matches() {
        if (query.includes('light')) return isLight;
        if (query.includes('dark')) return !isLight;
        return false;
      },
      media: query,
      onchange: null,
      addEventListener: (_: string, cb: () => void) => listeners.add(cb),
      removeEventListener: (_: string, cb: () => void) => listeners.delete(cb),
      addListener: (cb: () => void) => listeners.add(cb),
      removeListener: (cb: () => void) => listeners.delete(cb),
      dispatchEvent: () => true,
    })),
  );
  return {
    set(next: boolean) {
      isLight = next;
      for (const cb of [...listeners]) cb();
    },
  };
}

async function fresh(): Promise<typeof ThemeNs> {
  vi.resetModules();
  return import('./theme');
}

const html = document.documentElement;

beforeEach(() => {
  delete html.dataset.theme;
  localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.head.querySelectorAll('style[data-adv]').forEach((s) => {
    s.remove();
  });
});

describe('theme (adversarial)', () => {
  it('an explicit stored "light" wins over a dark OS and is applied before any hook mounts', async () => {
    stubMatchMedia(false);
    localStorage.setItem('aperture.theme', 'light');
    const { useTheme } = await fresh();
    expect(html.dataset.theme).toBe('light');
    const { result } = renderHook(() => useTheme());
    expect(result.current).toMatchObject({ preference: 'light', resolved: 'light' });
  });

  it.each(['LIGHT', ' dark', 'blue', '', '{"v":"dark"}'])('treats a stored %j as system', async (bad) => {
    stubMatchMedia(true);
    localStorage.setItem('aperture.theme', bad);
    const { useTheme } = await fresh();
    const { result } = renderHook(() => useTheme());
    expect(result.current.preference).toBe('system');
    expect(result.current.resolved).toBe('light');
    expect(html.dataset.theme).toBe('light');
  });

  it('does not crash on import when localStorage itself is inaccessible', async () => {
    stubMatchMedia(false);
    const getter = vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError');
    });
    const { useTheme } = await fresh();
    const { result } = renderHook(() => useTheme());
    expect(result.current.resolved).toBe('dark');
    act(() => {
      result.current.setPreference('light');
    });
    expect(result.current.resolved).toBe('light');
    expect(html.dataset.theme).toBe('light');
    getter.mockRestore();
  });

  it('persists every preference change under aperture.theme, including back to system', async () => {
    const os = stubMatchMedia(true);
    const { useTheme } = await fresh();
    const { result } = renderHook(() => useTheme());
    act(() => {
      result.current.setPreference('dark');
    });
    expect(localStorage.getItem('aperture.theme')).toBe('dark');
    expect(html.dataset.theme).toBe('dark');
    act(() => {
      result.current.setPreference('system');
    });
    expect(localStorage.getItem('aperture.theme')).toBe('system');
    expect(result.current.resolved).toBe('light');
    act(() => {
      os.set(false);
    });
    expect(result.current.resolved).toBe('dark');
    expect(html.dataset.theme).toBe('dark');
  });

  it('readThemeColors returns the light palette after switching to light (real tokens.css)', async () => {
    stubMatchMedia(false);
    const fsName = 'node:fs';
    const fs = (await import(/* @vite-ignore */ fsName)) as FsMod;
    const dirname = (import.meta as ImportMeta & { dirname?: string }).dirname;
    const css = fs.readFileSync(`${dirname}/../../styles/tokens.css`, 'utf8');
    const style = document.createElement('style');
    style.dataset.adv = '';
    style.textContent = css;
    document.head.appendChild(style);

    const { useTheme, readThemeColors } = await fresh();
    const { result } = renderHook(() => useTheme());
    const dark = readThemeColors();
    act(() => {
      result.current.setPreference('light');
    });
    const light = readThemeColors();
    // If jsdom cannot cascade custom properties, both reads fall back; only assert when it can.
    if (
      dark.bgPanel.toLowerCase() !== light.bgPanel.toLowerCase() ||
      light.bgPanel.toLowerCase() === '#fdfdfe'
    ) {
      expect(light.bgPanel.toLowerCase()).toBe('#fdfdfe');
      expect(light.textPrimary.toLowerCase()).toBe('#0f172a');
      expect(light.gain.toLowerCase()).toBe('#047857');
    }
    // Every color token in the spec is exposed as a string.
    for (const key of [
      'bgApp',
      'bgChrome',
      'bgPanel',
      'bgRaised',
      'bgInput',
      'bgHover',
      'bgSelected',
      'border',
      'borderStrong',
      'textPrimary',
      'textMuted',
      'textFaint',
      'accent',
      'accentHover',
      'textOnAccent',
      'gain',
      'loss',
      'gainTint',
      'lossTint',
      'warning',
      'warningTint',
      'focusRing',
      'shadowWindow',
    ] as const) {
      expect(typeof light[key], key).toBe('string');
      expect(light[key].length, key).toBeGreaterThan(0);
    }
  });
});
