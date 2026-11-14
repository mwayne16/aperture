import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

function stubMatchMedia(initialLight: boolean) {
  const listeners = new Set<() => void>();
  let isLight = initialLight;
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      get matches() {
        return query.includes('light') ? isLight : !isLight;
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
  return (next: boolean) => {
    isLight = next;
    for (const cb of [...listeners]) cb();
  };
}

const html = document.documentElement;

beforeEach(() => {
  delete html.dataset.theme;
  localStorage.clear();
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('theme without a mounted hook (adversarial)', () => {
  it('follows OS changes on <html> while the preference is system', async () => {
    const setOs = stubMatchMedia(false);
    await import('./theme');
    expect(html.dataset.theme).toBe('dark');
    setOs(true);
    expect(html.dataset.theme).toBe('light');
    setOs(false);
    expect(html.dataset.theme).toBe('dark');
  });

  it('does not follow the OS when an explicit theme was stored', async () => {
    localStorage.setItem('aperture.theme', 'dark');
    const setOs = stubMatchMedia(false);
    await import('./theme');
    expect(html.dataset.theme).toBe('dark');
    setOs(true);
    expect(html.dataset.theme).toBe('dark');
  });
});
