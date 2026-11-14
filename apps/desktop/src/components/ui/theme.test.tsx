import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as ThemeModuleNs from './theme';

type ThemeModule = typeof ThemeModuleNs;

/** Controllable prefers-color-scheme mock. */
function mockMatchMedia(initialLight: boolean) {
  let light = initialLight;
  const listeners = new Set<(e: MediaQueryListEvent) => void>();
  const matchMedia = vi.fn((query: string) => ({
    get matches() {
      return query.includes('light') ? light : !light;
    },
    media: query,
    onchange: null,
    addEventListener: (_type: string, cb: (e: MediaQueryListEvent) => void) => listeners.add(cb),
    removeEventListener: (_type: string, cb: (e: MediaQueryListEvent) => void) => listeners.delete(cb),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
  vi.stubGlobal('matchMedia', matchMedia);
  return {
    setLight(next: boolean) {
      light = next;
      for (const cb of [...listeners]) cb({ matches: next } as MediaQueryListEvent);
    },
    listenerCount: () => listeners.size,
  };
}

/** theme.ts reads storage and the OS scheme at import, so each test loads a fresh copy. */
async function loadTheme(): Promise<ThemeModule> {
  vi.resetModules();
  return import('./theme');
}

const html = document.documentElement;

beforeEach(() => {
  delete html.dataset.theme;
  html.removeAttribute('style');
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('theme preference', () => {
  it('defaults to system and resolves dark when matchMedia is unavailable', async () => {
    vi.stubGlobal('matchMedia', undefined);
    const { useTheme } = await loadTheme();
    const { result } = renderHook(() => useTheme());
    expect(result.current.preference).toBe('system');
    expect(result.current.resolved).toBe('dark');
    expect(html.dataset.theme).toBe('dark');
  });

  it('follows the OS scheme while on system, including live changes', async () => {
    const media = mockMatchMedia(true);
    const { useTheme } = await loadTheme();
    expect(html.dataset.theme).toBe('light'); // applied at import, before any render

    const { result } = renderHook(() => useTheme());
    expect(result.current.resolved).toBe('light');

    act(() => {
      media.setLight(false);
    });
    expect(result.current.resolved).toBe('dark');
    expect(html.dataset.theme).toBe('dark');
  });

  it('ignores OS changes once an explicit theme is chosen', async () => {
    const media = mockMatchMedia(false);
    const { useTheme } = await loadTheme();
    const { result } = renderHook(() => useTheme());

    act(() => {
      result.current.setPreference('dark');
    });
    act(() => {
      media.setLight(true);
    });
    expect(result.current.resolved).toBe('dark');
    expect(html.dataset.theme).toBe('dark');
  });

  it('persists the preference and restores it on the next load', async () => {
    mockMatchMedia(false);
    const first = await loadTheme();
    const { result, unmount } = renderHook(() => first.useTheme());

    act(() => {
      result.current.setPreference('light');
    });
    expect(localStorage.getItem('aperture.theme')).toBe('light');
    expect(result.current).toMatchObject({ preference: 'light', resolved: 'light' });
    expect(html.dataset.theme).toBe('light');
    unmount();

    delete html.dataset.theme;
    const second = await loadTheme();
    expect(html.dataset.theme).toBe('light');
    const { result: reloaded } = renderHook(() => second.useTheme());
    expect(reloaded.current.preference).toBe('light');
  });

  it('switching back to system re-resolves from the OS', async () => {
    mockMatchMedia(true);
    localStorage.setItem('aperture.theme', 'dark');
    const { useTheme } = await loadTheme();
    const { result } = renderHook(() => useTheme());
    expect(result.current.resolved).toBe('dark');

    act(() => {
      result.current.setPreference('system');
    });
    expect(result.current).toMatchObject({ preference: 'system', resolved: 'light' });
    expect(localStorage.getItem('aperture.theme')).toBe('system');
  });

  it.each(['purple', '', 'DARK', '{"theme":"dark"}'])(
    'treats a stored value of %j as system',
    async (stored) => {
      mockMatchMedia(false);
      localStorage.setItem('aperture.theme', stored);
      const { useTheme } = await loadTheme();
      const { result } = renderHook(() => useTheme());
      expect(result.current.preference).toBe('system');
    },
  );

  it('keeps working when storage throws on read and write', async () => {
    mockMatchMedia(false);
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    const { useTheme } = await loadTheme();
    const { result } = renderHook(() => useTheme());
    expect(result.current.preference).toBe('system');

    act(() => {
      result.current.setPreference('light');
    });
    expect(setItem).toHaveBeenCalled();
    expect(result.current.resolved).toBe('light');
    expect(html.dataset.theme).toBe('light');
  });

  it('rejects invalid preferences passed at runtime', async () => {
    mockMatchMedia(false);
    const { useTheme } = await loadTheme();
    const { result } = renderHook(() => useTheme());
    act(() => {
      result.current.setPreference('sepia' as never);
    });
    expect(result.current.preference).toBe('system');
    expect(localStorage.getItem('aperture.theme')).toBeNull();
  });

  it('shares one preference across hook instances', async () => {
    mockMatchMedia(false);
    const { useTheme } = await loadTheme();
    const a = renderHook(() => useTheme());
    const b = renderHook(() => useTheme());
    act(() => {
      a.result.current.setPreference('light');
    });
    expect(b.result.current.resolved).toBe('light');
  });

  it('unsubscribes from the media query when the hook unmounts', async () => {
    const media = mockMatchMedia(false);
    const { useTheme } = await loadTheme();
    const baseline = media.listenerCount(); // the module-level listener
    const { unmount } = renderHook(() => useTheme());
    expect(media.listenerCount()).toBe(baseline + 1);
    unmount();
    expect(media.listenerCount()).toBe(baseline);
  });
});

describe('readThemeColors', () => {
  it('returns the computed token values', async () => {
    mockMatchMedia(false);
    const { readThemeColors } = await loadTheme();
    html.style.setProperty('--accent', '#123456');
    html.style.setProperty('--gain', ' rgba(1, 2, 3, 0.5) ');
    const colors = readThemeColors();
    expect(colors.accent).toBe('#123456');
    expect(colors.gain).toBe('rgba(1, 2, 3, 0.5)');
  });

  it('falls back to the dark palette for tokens that are not defined', async () => {
    mockMatchMedia(false);
    const { readThemeColors, FALLBACK_THEME_COLORS } = await loadTheme();
    const colors = readThemeColors();
    expect(colors).toEqual(FALLBACK_THEME_COLORS);
    expect(Object.values(colors).every((v) => typeof v === 'string' && v.length > 0)).toBe(true);
  });

  it('reads from a specific element when given one', async () => {
    mockMatchMedia(false);
    const { readThemeColors } = await loadTheme();
    const el = document.createElement('div');
    el.style.setProperty('--loss', '#abcdef');
    document.body.append(el);
    expect(readThemeColors(el).loss).toBe('#abcdef');
    el.remove();
  });
});
