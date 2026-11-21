import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from './settingsRules';
import { SETTINGS_STORAGE_KEY, useSettingsStore } from './settingsStore';

/** Loads a fresh copy of the store module, as a reload would. */
async function reloadStore() {
  vi.resetModules();
  const module = await import('./settingsStore');
  return module.useSettingsStore;
}

const stored = () => JSON.parse(localStorage.getItem(SETTINGS_STORAGE_KEY) ?? 'null') as unknown;

beforeEach(() => {
  localStorage.clear();
  useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS } });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('settingsStore', () => {
  it('saves every change and reads it back after a reload', async () => {
    useSettingsStore.getState().update({ chartStyle: 'line', defaultChartRange: '3M' });
    useSettingsStore.getState().update({ triggerToasts: false, desktopNotifications: false });
    const saved = {
      defaultChartRange: '3M',
      chartStyle: 'line',
      triggerToasts: false,
      desktopNotifications: false,
    };
    expect(stored()).toEqual(saved);

    const reloaded = await reloadStore();
    expect(reloaded.getState().settings).toEqual(saved);
  });

  it('starts from the defaults when the stored copy is corrupt', async () => {
    localStorage.setItem(SETTINGS_STORAGE_KEY, '{"chartStyle":"line",');
    const reloaded = await reloadStore();
    expect(reloaded.getState().settings).toEqual(DEFAULT_SETTINGS);
  });

  it('keeps the valid stored fields when others are invalid', async () => {
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify({ chartStyle: 'line', defaultChartRange: 7 }));
    const reloaded = await reloadStore();
    expect(reloaded.getState().settings).toEqual({ ...DEFAULT_SETTINGS, chartStyle: 'line' });
  });

  it('ignores invalid values in an update', () => {
    const before = useSettingsStore.getState().settings;
    useSettingsStore.getState().update({ chartStyle: 'bars' } as never);
    expect(useSettingsStore.getState().settings).toBe(before);
    expect(localStorage.getItem(SETTINGS_STORAGE_KEY)).toBeNull();
  });

  it('skips the write when an update changes nothing', () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    useSettingsStore.getState().update({ chartStyle: 'candles' });
    expect(setItem).not.toHaveBeenCalled();
  });

  it('still applies changes when storage is blocked', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    useSettingsStore.getState().update({ chartStyle: 'line' });
    expect(useSettingsStore.getState().settings.chartStyle).toBe('line');

    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    const reloaded = await reloadStore();
    expect(reloaded.getState().settings).toEqual(DEFAULT_SETTINGS);
  });

  it('resets to the defaults and saves them', () => {
    useSettingsStore.getState().update({ chartStyle: 'line', triggerToasts: false });
    useSettingsStore.getState().reset();
    expect(useSettingsStore.getState().settings).toEqual(DEFAULT_SETTINGS);
    expect(stored()).toEqual(DEFAULT_SETTINGS);
  });
});
