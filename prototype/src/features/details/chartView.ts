import { create } from 'zustand';
import type { ChartRange } from '../../domain/types';
import { useSettingsStore } from '../settings/settingsStore';
import type { ChartStyle } from './chartData';

/**
 * The chart range and style the user picked this session, shared by the quick view and the stock
 * page so Expand keeps the chart as it was. Until the user picks, both follow the settings.
 */

interface ChartViewState {
  range: ChartRange | null;
  style: ChartStyle | null;
}

const useChartViewStore = create<ChartViewState>(() => ({ range: null, style: null }));

// A changed setting replaces the user's pick, so the new default takes effect at once.
useSettingsStore.subscribe((state, previous) => {
  if (state.settings.defaultChartRange !== previous.settings.defaultChartRange) {
    useChartViewStore.setState({ range: null });
  }
  if (state.settings.chartStyle !== previous.settings.chartStyle) useChartViewStore.setState({ style: null });
});

function pickRange(range: ChartRange): void {
  useChartViewStore.setState({ range });
}

function pickStyle(style: ChartStyle): void {
  useChartViewStore.setState({ style });
}

/** Forgets the picks (tests). */
export function resetChartView(): void {
  useChartViewStore.setState({ range: null, style: null });
}

export function useChartRange(): [ChartRange, (range: ChartRange) => void] {
  const fallback = useSettingsStore((s) => s.settings.defaultChartRange);
  const picked = useChartViewStore((s) => s.range);
  return [picked ?? fallback, pickRange];
}

export function useChartStyle(): [ChartStyle, (style: ChartStyle) => void] {
  const fallback = useSettingsStore((s) => s.settings.chartStyle);
  const picked = useChartViewStore((s) => s.style);
  return [picked ?? fallback, pickStyle];
}
