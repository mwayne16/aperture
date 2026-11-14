import type { IChartApi, MouseEventParams } from 'lightweight-charts';
import { vi } from 'vitest';

/**
 * Test double for lightweight-charts' createChart (jsdom has no canvas). It records data and options
 * so tests can assert what the chart was told to draw. Use it with
 * `vi.mock('lightweight-charts', ...)`, keeping the real enums and series definitions.
 */

type Options = Record<string, unknown>;

interface MockPriceLine {
  options: Options;
  applyOptions: (options: Options) => void;
}

export interface MockSeries {
  type: string;
  data: unknown[];
  options: Options;
  priceLines: MockPriceLine[];
  setData: ReturnType<typeof vi.fn<(data: unknown[]) => void>>;
  applyOptions: ReturnType<typeof vi.fn<(options: Options) => void>>;
  createPriceLine: ReturnType<typeof vi.fn<(options: Options) => MockPriceLine>>;
  removePriceLine: ReturnType<typeof vi.fn<(line: MockPriceLine) => void>>;
  priceScale: () => { applyOptions: (options: Options) => void };
  priceToCoordinate: (price: number) => number;
}

export interface MockChart {
  container: HTMLElement;
  /** Every options object passed to createChart and applyOptions, in order. */
  optionHistory: Options[];
  series: MockSeries[];
  removed: boolean;
  applyOptions: ReturnType<typeof vi.fn<(options: Options) => void>>;
  setCrosshairPosition: ReturnType<typeof vi.fn<(price: number, time: unknown, series: unknown) => void>>;
  clearCrosshairPosition: ReturnType<typeof vi.fn<() => void>>;
  fitContent: ReturnType<typeof vi.fn<() => void>>;
  /** Calls the crosshair handlers as the chart would when the pointer moves. */
  moveCrosshair: (param: Partial<MouseEventParams>) => void;
}

export const mockCharts: MockChart[] = [];

/** The most recently created chart that has not been removed. */
export function liveChart(): MockChart {
  const chart = mockCharts.filter((c) => !c.removed).at(-1);
  if (!chart) throw new Error('No mounted chart.');
  return chart;
}

/** The chart's series of `type`. Removed series are dropped from `chart.series`, so they never match. */
export function seriesOf(chart: MockChart, type: 'Candlestick' | 'Line' | 'Histogram'): MockSeries {
  const series = chart.series.find((s) => s.type === type);
  if (!series) throw new Error(`No ${type} series.`);
  return series;
}

function createSeries(type: string): MockSeries {
  const series: MockSeries = {
    type,
    data: [],
    options: {},
    priceLines: [],
    setData: vi.fn((data: unknown[]) => {
      series.data = data;
    }),
    applyOptions: vi.fn((options: Options) => {
      Object.assign(series.options, options);
    }),
    createPriceLine: vi.fn((options: Options) => {
      const line: MockPriceLine = {
        options: { ...options },
        applyOptions: (next) => {
          Object.assign(line.options, next);
        },
      };
      series.priceLines.push(line);
      return line;
    }),
    removePriceLine: vi.fn((line: MockPriceLine) => {
      series.priceLines = series.priceLines.filter((l) => l !== line);
    }),
    priceScale: () => ({ applyOptions: () => undefined }),
    priceToCoordinate: (price) => price,
  };
  return series;
}

export function createChart(container: HTMLElement, options?: Options): IChartApi {
  const handlers = new Set<(param: MouseEventParams) => void>();
  let visible = { from: 0, to: 1000 };
  const chart: MockChart = {
    container,
    optionHistory: options ? [options] : [],
    series: [],
    removed: false,
    applyOptions: vi.fn((next: Options) => {
      chart.optionHistory.push(next);
    }),
    setCrosshairPosition: vi.fn(),
    clearCrosshairPosition: vi.fn(),
    fitContent: vi.fn(),
    moveCrosshair: (param) => {
      for (const handler of handlers) handler({ seriesData: new Map(), ...param });
    },
  };
  const timeScale = {
    fitContent: chart.fitContent,
    applyOptions: () => undefined,
    getVisibleLogicalRange: () => visible,
    setVisibleLogicalRange: (range: { from: number; to: number }) => {
      visible = range;
    },
    timeToCoordinate: (time: number) => time % 1000,
  };
  const api = {
    applyOptions: chart.applyOptions,
    addSeries: (definition: { type: string }, seriesOptions?: Options) => {
      const series = createSeries(definition.type);
      if (seriesOptions) series.applyOptions(seriesOptions);
      chart.series.push(series);
      return series;
    },
    removeSeries: (series: MockSeries) => {
      chart.series = chart.series.filter((s) => s !== series);
    },
    priceScale: () => ({ applyOptions: () => undefined }),
    timeScale: () => timeScale,
    subscribeCrosshairMove: (handler: (param: MouseEventParams) => void) => {
      handlers.add(handler);
    },
    unsubscribeCrosshairMove: (handler: (param: MouseEventParams) => void) => {
      handlers.delete(handler);
    },
    setCrosshairPosition: chart.setCrosshairPosition,
    clearCrosshairPosition: chart.clearCrosshairPosition,
    remove: () => {
      chart.removed = true;
      handlers.clear();
    },
  };
  mockCharts.push(chart);
  return api as unknown as IChartApi;
}
