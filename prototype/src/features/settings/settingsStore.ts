import { create } from 'zustand';
import type { ChartRange } from '../../domain/types';

interface Settings {
  /** Range a stock chart opens with. */
  defaultChartRange: ChartRange;
  chartStyle: 'candles' | 'line';
  /** Show a toast when an alert triggers. The notification inbox records triggers either way. */
  triggerToasts: boolean;
}

const DEFAULT_SETTINGS: Settings = { defaultChartRange: '1D', chartStyle: 'candles', triggerToasts: true };

/**
 * App preferences other features read, such as chart defaults. The theme lives in
 * components/ui/theme.ts. The settings feature owns this store and may add persistence.
 */
interface SettingsState {
  settings: Settings;
  update(patch: Partial<Settings>): void;
  reset(): void;
}

export const useSettingsStore = create<SettingsState>()((set) => ({
  settings: DEFAULT_SETTINGS,
  update: (patch) => {
    set((s) => ({ settings: { ...s.settings, ...patch } }));
  },
  reset: () => {
    set({ settings: DEFAULT_SETTINGS });
  },
}));
