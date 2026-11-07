import { act, fireEvent, render, screen } from '@testing-library/react';
import type * as LightweightCharts from 'lightweight-charts';
import { StrictMode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useTheme } from '../../components/ui/theme';
import type { Bar } from '../../domain/types';
import { liveChart, mockCharts, seriesOf } from './chartMock';
import { PriceChart } from './PriceChart';
import type { LiveLine } from './quoteView';

vi.mock('lightweight-charts', async (importOriginal) => {
  const actual = await importOriginal<typeof LightweightCharts>();
  const mock = await import('./chartMock');
  return { ...actual, createChart: mock.createChart };
});

const DAY = 86_400;
const START = Date.UTC(2026, 9, 19) / 1000;

function bars(count: number, start = START): Bar[] {
  return Array.from({ length: count }, (_, i) => ({
    time: start + i * DAY,
    open: 100 + i,
    high: 102 + i,
    low: 99 + i,
    close: 101 + i,
    volume: 1_000_000,
  }));
}

const LIVE: LiveLine = { price: 105.5, label: 'Live', muted: false };

function renderChart(props: Partial<Parameters<typeof PriceChart>[0]> = {}) {
  const all = { bars: bars(5), timeframe: '1Day' as const, live: LIVE, summary: 'AAPL price history', ...props };
  const view = render(<PriceChart {...all} />);
  return {
    ...view,
    update: (next: Partial<typeof all>) => {
      Object.assign(all, next);
      view.rerender(<PriceChart {...all} />);
    },
  };
}

afterEach(() => {
  mockCharts.length = 0;
  document.documentElement.removeAttribute('style');
});

describe('PriceChart', () => {
  it('draws candles and volume from the bars and fits them', () => {
    renderChart();
    const chart = liveChart();
    const candles = seriesOf(chart, 'Candlestick');
    expect(candles.data).toHaveLength(5);
    expect(candles.data[0]).toEqual({ time: START, open: 100, high: 102, low: 99, close: 101 });
    expect(seriesOf(chart, 'Histogram').data[0]).toMatchObject({ time: START, value: 1_000_000 });
    expect(chart.fitContent).toHaveBeenCalled();
    // Only the live line may mark the latest price.
    expect(candles.options).toMatchObject({ priceLineVisible: false, lastValueVisible: false });
  });

  it('is a labelled, focusable chart for keyboard and screen reader users', () => {
    renderChart({ summary: 'AAPL price history, 1 week' });
    const chart = screen.getByRole('group', { name: 'AAPL price history, 1 week' });
    expect(chart).toHaveAttribute('tabindex', '0');
    expect(chart).toHaveAccessibleDescription(/arrow keys to inspect bars/);
  });

  it('draws the live price as a dashed line and moves it on each tick without redrawing the bars', () => {
    const { update } = renderChart();
    const candles = seriesOf(liveChart(), 'Candlestick');
    expect(candles.priceLines).toHaveLength(1);
    expect(candles.priceLines[0]?.options).toMatchObject({ price: 105.5, title: 'Live', lineStyle: 2 });
    const setDataCalls = candles.setData.mock.calls.length;

    update({ live: { price: 106.25, label: 'Live', muted: false } });
    expect(candles.priceLines).toHaveLength(1);
    expect(candles.priceLines[0]?.options.price).toBe(106.25);
    expect(candles.setData).toHaveBeenCalledTimes(setDataCalls);
  });

  it('mutes a stale live line and removes it when there is no price', () => {
    const { update } = renderChart();
    const candles = seriesOf(liveChart(), 'Candlestick');
    const liveColor = candles.priceLines[0]?.options.color;
    update({ live: { price: 105.5, label: 'Stale', muted: true } });
    expect(candles.priceLines[0]?.options.title).toBe('Stale');
    expect(candles.priceLines[0]?.options.color).not.toBe(liveColor);
    update({ live: null });
    expect(candles.priceLines).toHaveLength(0);
  });

  it('refits when the bars change but not when only the live price does', () => {
    const { update } = renderChart();
    const chart = liveChart();
    const fits = chart.fitContent.mock.calls.length;
    update({ live: { ...LIVE, price: 107 } });
    expect(chart.fitContent).toHaveBeenCalledTimes(fits);
    update({ bars: bars(8) });
    expect(seriesOf(chart, 'Candlestick').data).toHaveLength(8);
    expect(chart.fitContent).toHaveBeenCalledTimes(fits + 1);
  });

  it('formats the time axis for the bar size', () => {
    const { update } = renderChart({ timeframe: '1Day' });
    const chart = liveChart();
    const lastTimeScale = () =>
      chart.optionHistory.flatMap((o) => (o.timeScale ? [o.timeScale as { timeVisible?: boolean }] : [])).at(-1);
    expect(lastTimeScale()?.timeVisible).toBe(false);
    update({ timeframe: '5Min' });
    expect(lastTimeScale()?.timeVisible).toBe(true);
  });

  it('re-reads the theme colors when the theme changes', () => {
    function ThemeToggle() {
      const { setPreference } = useTheme();
      return (
        <>
          <button
            type="button"
            onClick={() => {
              setPreference('light');
            }}
          >
            light
          </button>
          <button
            type="button"
            onClick={() => {
              setPreference('system');
            }}
          >
            system
          </button>
        </>
      );
    }
    render(<ThemeToggle />);
    renderChart();
    const chart = liveChart();
    const root = document.documentElement;
    root.style.setProperty('--bg-panel', '#fdfdfe');
    root.style.setProperty('--gain', '#047857');

    fireEvent.click(screen.getByRole('button', { name: 'light' }));

    const layouts = chart.optionHistory.flatMap((o) =>
      o.layout ? [o.layout as { background: { color: string } }] : [],
    );
    expect(layouts.at(-1)?.background.color).toBe('#fdfdfe');
    expect(seriesOf(chart, 'Candlestick').options.upColor).toBe('#047857');
    expect(seriesOf(chart, 'Histogram').data[0]).toMatchObject({ color: 'rgba(4, 120, 87, 0.38)' });
    fireEvent.click(screen.getByRole('button', { name: 'system' }));
  });

  it('shows a tooltip for the bar under the crosshair and hides it when the pointer leaves', () => {
    const { container } = renderChart();
    const chart = liveChart();
    act(() => {
      chart.moveCrosshair({ time: (START + DAY) as LightweightCharts.UTCTimestamp, point: { x: 40, y: 30 } as never });
    });
    const tooltip = container.querySelector('.price-chart__tooltip');
    expect(tooltip).toHaveTextContent('Oct 20, 2026');
    expect(tooltip).toHaveTextContent('Open101.00');
    expect(tooltip).toHaveTextContent('Volume1.00M');
    expect(tooltip).toHaveTextContent('+1.00 (+0.99%)');

    act(() => {
      chart.moveCrosshair({});
    });
    expect(container.querySelector('.price-chart__tooltip')).toBeNull();
  });

  it('lets the keyboard step through bars and announces each one', () => {
    const { container } = renderChart();
    const chart = liveChart();
    const canvas = screen.getByRole('group');
    canvas.focus();

    fireEvent.keyDown(canvas, { key: 'ArrowLeft' });
    expect(chart.setCrosshairPosition).toHaveBeenLastCalledWith(105, START + 4 * DAY, expect.anything());
    expect(container.querySelector('.price-chart__tooltip')).toHaveTextContent('Oct 23, 2026');

    fireEvent.keyDown(canvas, { key: 'ArrowLeft' });
    expect(container.querySelector('.price-chart__tooltip')).toHaveTextContent('Oct 22, 2026');
    expect(container.querySelector('[aria-live="polite"]')).toHaveTextContent(/^Oct 22, 2026\. Open 103\.00/);

    fireEvent.keyDown(canvas, { key: 'Home' });
    expect(container.querySelector('.price-chart__tooltip')).toHaveTextContent('Oct 19, 2026');
    fireEvent.keyDown(canvas, { key: 'ArrowRight', shiftKey: true });
    expect(container.querySelector('.price-chart__tooltip')).toHaveTextContent('Oct 23, 2026');

    fireEvent.keyDown(canvas, { key: 'Escape' });
    expect(container.querySelector('.price-chart__tooltip')).toBeNull();
    expect(chart.clearCrosshairPosition).toHaveBeenCalled();
  });

  it('drops an inspection that does not belong to new bars', () => {
    const { container, update } = renderChart();
    fireEvent.keyDown(screen.getByRole('group'), { key: 'End' });
    expect(container.querySelector('.price-chart__tooltip')).not.toBeNull();
    update({ bars: bars(3, START + 100 * DAY) });
    expect(container.querySelector('.price-chart__tooltip')).toBeNull();
  });

  it('keeps exactly one live chart through a StrictMode remount and removes it on unmount', () => {
    const { unmount } = render(
      <StrictMode>
        <PriceChart bars={bars(5)} timeframe="1Day" live={LIVE} summary="AAPL" />
      </StrictMode>,
    );
    expect(mockCharts.filter((c) => !c.removed)).toHaveLength(1);
    const chart = liveChart();
    expect(seriesOf(chart, 'Candlestick').data).toHaveLength(5);
    expect(seriesOf(chart, 'Candlestick').priceLines).toHaveLength(1);
    unmount();
    expect(chart.removed).toBe(true);
  });
});
