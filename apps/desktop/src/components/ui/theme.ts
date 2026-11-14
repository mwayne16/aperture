import { useLayoutEffect, useSyncExternalStore } from 'react';
import { create } from 'zustand';

export type ThemePreference = 'system' | 'dark' | 'light';
type ResolvedTheme = 'dark' | 'light';

const THEME_STORAGE_KEY = 'aperture.theme';
const LIGHT_QUERY = '(prefers-color-scheme: light)';
const PREFERENCES: readonly ThemePreference[] = ['system', 'dark', 'light'];

function isThemePreference(value: unknown): value is ThemePreference {
  return typeof value === 'string' && (PREFERENCES as readonly string[]).includes(value);
}

/** Stored preference, or 'system' when nothing valid is stored or storage is unavailable. */
function readStoredPreference(): ThemePreference {
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    return isThemePreference(stored) ? stored : 'system';
  } catch {
    return 'system';
  }
}

function writeStoredPreference(preference: ThemePreference): void {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, preference);
  } catch {
    // ** Storage can be blocked (private mode, quota). The in-memory preference still applies.
  }
}

function lightQuery(): MediaQueryList | null {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return null;
  try {
    return window.matchMedia(LIGHT_QUERY);
  } catch {
    return null;
  }
}

/** The OS color scheme. Dark when the platform can't tell us (the app is dark-first). */
function getSystemTheme(): ResolvedTheme {
  return lightQuery()?.matches ? 'light' : 'dark';
}

function subscribeSystemTheme(onChange: () => void): () => void {
  const query = lightQuery();
  if (!query) return () => undefined;
  query.addEventListener('change', onChange);
  return () => {
    query.removeEventListener('change', onChange);
  };
}

function resolveTheme(preference: ThemePreference, system: ResolvedTheme): ResolvedTheme {
  return preference === 'system' ? system : preference;
}

/** Writes the resolved theme to <html data-theme> so tokens.css switches palettes. */
function applyTheme(resolved: ResolvedTheme): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  if (root.dataset.theme !== resolved) root.dataset.theme = resolved;
}

interface ThemeState {
  preference: ThemePreference;
  setPreference: (preference: ThemePreference) => void;
}

const useThemeStore = create<ThemeState>((set) => ({
  preference: readStoredPreference(),
  setPreference: (preference) => {
    if (!isThemePreference(preference)) return;
    writeStoredPreference(preference);
    set({ preference });
    applyTheme(resolveTheme(preference, getSystemTheme()));
  },
}));

// ** Apply the stored theme as soon as the design system loads so the first paint uses the right
// palette, and keep following the OS while the preference is 'system', even with no hook mounted.
applyTheme(resolveTheme(useThemeStore.getState().preference, getSystemTheme()));
subscribeSystemTheme(() => {
  const { preference } = useThemeStore.getState();
  if (preference === 'system') applyTheme(getSystemTheme());
});

interface UseThemeResult {
  preference: ThemePreference;
  resolved: ResolvedTheme;
  setPreference: (preference: ThemePreference) => void;
}

export function useTheme(): UseThemeResult {
  const preference = useThemeStore((s) => s.preference);
  const setPreference = useThemeStore((s) => s.setPreference);
  const system = useSyncExternalStore(subscribeSystemTheme, getSystemTheme, () => 'dark' as const);
  const resolved = resolveTheme(preference, system);

  useLayoutEffect(() => {
    applyTheme(resolved);
  }, [resolved]);

  return { preference, resolved, setPreference };
}

/** Resolved color tokens, for consumers that can't use CSS (the chart canvas). */
export interface ThemeColors {
  bgApp: string;
  bgChrome: string;
  bgPanel: string;
  bgRaised: string;
  bgInput: string;
  bgHover: string;
  bgSelected: string;
  border: string;
  borderSubtle: string;
  borderStrong: string;
  textPrimary: string;
  textMuted: string;
  textFaint: string;
  textOnAccent: string;
  accent: string;
  accentHover: string;
  accentTint: string;
  gain: string;
  loss: string;
  gainTint: string;
  lossTint: string;
  warning: string;
  warningTint: string;
  focusRing: string;
  shadowWindow: string;
}

/** CSS custom property behind each ThemeColors key. */
export const THEME_COLOR_VARS: Readonly<Record<keyof ThemeColors, `--${string}`>> = {
  bgApp: '--bg-app',
  bgChrome: '--bg-chrome',
  bgPanel: '--bg-panel',
  bgRaised: '--bg-raised',
  bgInput: '--bg-input',
  bgHover: '--bg-hover',
  bgSelected: '--bg-selected',
  border: '--border',
  borderSubtle: '--border-subtle',
  borderStrong: '--border-strong',
  textPrimary: '--text-primary',
  textMuted: '--text-muted',
  textFaint: '--text-faint',
  textOnAccent: '--text-on-accent',
  accent: '--accent',
  accentHover: '--accent-hover',
  accentTint: '--accent-tint',
  gain: '--gain',
  loss: '--loss',
  gainTint: '--gain-tint',
  lossTint: '--loss-tint',
  warning: '--warning',
  warningTint: '--warning-tint',
  focusRing: '--focus-ring',
  shadowWindow: '--shadow-window',
};

/**
 * Dark palette used when a token can't be read (stylesheet not loaded yet, or a test DOM).
 * tokens.test.ts asserts these equal the dark values in tokens.css, so they can't drift.
 */
export const FALLBACK_THEME_COLORS: Readonly<ThemeColors> = {
  bgApp: '#0b0f14',
  bgChrome: '#0e1319',
  bgPanel: '#131920',
  bgRaised: '#19202a',
  bgInput: '#0f141a',
  bgHover: 'rgba(232, 238, 246, 0.05)',
  bgSelected: 'rgba(96, 165, 250, 0.14)',
  border: '#212a35',
  borderSubtle: '#1a212a',
  borderStrong: '#2e3846',
  textPrimary: '#e8eef6',
  textMuted: '#94a0b2',
  textFaint: '#6b7789',
  textOnAccent: '#0a1424',
  accent: '#60a5fa',
  accentHover: '#7db6fb',
  accentTint: 'rgba(96, 165, 250, 0.14)',
  gain: '#34d399',
  loss: '#f87171',
  gainTint: 'rgba(52, 211, 153, 0.14)',
  lossTint: 'rgba(248, 113, 113, 0.14)',
  warning: '#fbbf24',
  warningTint: 'rgba(251, 191, 36, 0.14)',
  focusRing: 'rgba(96, 165, 250, 0.55)',
  shadowWindow: 'rgba(0, 0, 0, 0.5)',
};

/**
 * Reads the current value of every color token from the computed style of `element`
 * (default <html>). Call it again after the theme changes; the values are not live.
 */
export function readThemeColors(element?: Element): ThemeColors {
  const colors = { ...FALLBACK_THEME_COLORS };
  if (typeof window === 'undefined' || typeof document === 'undefined') return colors;
  const style = window.getComputedStyle(element ?? document.documentElement);
  for (const key of Object.keys(THEME_COLOR_VARS) as (keyof ThemeColors)[]) {
    const value = style.getPropertyValue(THEME_COLOR_VARS[key]).trim();
    if (value) colors[key] = value;
  }
  return colors;
}
