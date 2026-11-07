import { create } from 'zustand';
import { DEFAULT_SETTINGS, parseStoredSettings, validPatch, type Settings } from './settingsRules';

export const SETTINGS_STORAGE_KEY = 'aperture.settings';

function readStoredSettings(): Settings {
  try {
    return parseStoredSettings(window.localStorage.getItem(SETTINGS_STORAGE_KEY));
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function writeStoredSettings(settings: Settings): void {
  try {
    window.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // ** Storage can be blocked (private mode, quota). The in-memory settings still apply.
  }
}

/**
 * App preferences other features read, such as chart defaults and trigger toasts. Saved to
 * localStorage on every change and validated on load, so a stored value this version doesn't
 * understand falls back to its default. The theme lives in components/ui/theme.ts.
 */
interface SettingsState {
  settings: Settings;
  /** Applies the valid fields of `patch`; invalid values are ignored. */
  update(patch: Partial<Settings>): void;
  reset(): void;
}

export const useSettingsStore = create<SettingsState>()((set, get) => ({
  settings: readStoredSettings(),
  update: (patch) => {
    const valid = validPatch(patch);
    const current = get().settings;
    const changed = (Object.keys(valid) as (keyof Settings)[]).some((key) => valid[key] !== current[key]);
    if (!changed) return;
    const settings = { ...current, ...valid };
    writeStoredSettings(settings);
    set({ settings });
  },
  reset: () => {
    const settings = { ...DEFAULT_SETTINGS };
    writeStoredSettings(settings);
    set({ settings });
  },
}));
