import { TickMarkType, type UTCTimestamp } from 'lightweight-charts';
import { describe, expect, it } from 'vitest';
import { CHART_RANGES, type Bar, type HistoryResult } from '../../domain/types';
import {
  announceBar,
  chartSummary,
  describeBar,
  formatBarTime,
  formatTickMark,
  historyStartNote,
  isIntradayTimeframe,
  rangeLabel,
  timeframeForRange,
} from './chartFormat';

const seconds = (iso: string) => (Date.parse(iso) / 1000) as UTCTimestamp;

function bar(time: number, open: number, close: number, volume = 1_200_000): Bar {
  return { time, open, high: Math.max(open, close) + 1, low: Math.min(open, close) - 1, close, volume };
}

function result(overrides: Partial<HistoryResult>): HistoryResult {
  return { symbol: 'AAPL', range: 'ALL', timeframe: '1Month', bars: [], truncated: false, simulated: true, ...overrides };
}

describe('timeframes', () => {
  it('treats minute and hourly bars as intraday', () => {
    expect(isIntradayTimeframe('5Min')).toBe(true);
    expect(isIntradayTimeframe('1Hour')).toBe(true);
    expect(isIntradayTimeframe('1Day')).toBe(false);
    expect(isIntradayTimeframe('1Month')).toBe(false);
  });

  it('knows the bar size of every range before any request', () => {
    expect(timeframeForRange('1D')).toBe('5Min');
    expect(timeframeForRange('1M')).toBe('1Hour');
    expect(timeframeForRange('YTD')).toBe('1Day');
    expect(timeframeForRange('5Y')).toBe('1Week');
    expect(timeframeForRange('ALL')).toBe('1Month');
  });

  it('labels every range', () => {
    expect(CHART_RANGES.map(rangeLabel)).toEqual(['1D', '1W', '1M', '3M', '6M', 'YTD', '1Y', '5Y', '10Y', 'All']);
  });
});

describe('formatBarTime', () => {
  it('shows intraday bars in New York time, across daylight saving', () => {
    // 13:35 UTC is 09:35 EDT in October and 08:35 EST in December.
    expect(formatBarTime(seconds('2026-10-23T13:35:00Z'), '5Min')).toBe('Oct 23, 2026 09:35 ET');
    expect(formatBarTime(seconds('2026-12-04T14:30:00Z'), '30Min')).toBe('Dec 4, 2026 09:30 ET');
  });

  it('shows daily and longer bars as dates in UTC, where they are labeled', () => {
    const midnight = seconds('2026-10-23T00:00:00Z');
    expect(formatBarTime(midnight, '1Day')).toBe('Oct 23, 2026');
    expect(formatBarTime(seconds('2026-10-19T00:00:00Z'), '1Week')).toBe('Week of Oct 19, 2026');
    expect(formatBarTime(seconds('2026-10-01T00:00:00Z'), '1Month')).toBe('Oct 2026');
  });

  it('returns a dash for a time it cannot show', () => {
    expect(formatBarTime(Number.NaN, '1Day')).toBe('—');
  });
});

describe('formatTickMark', () => {
  const open = seconds('2026-10-23T13:30:00Z');

  it('formats intraday time ticks in New York time', () => {
    expect(formatTickMark(open, TickMarkType.Time, '5Min')).toBe('09:30');
    expect(formatTickMark(open, TickMarkType.TimeWithSeconds, '5Min')).toBe('09:30:00');
  });

  it('formats date ticks by kind', () => {
    const day = seconds('2026-10-23T00:00:00Z');
    expect(formatTickMark(day, TickMarkType.DayOfMonth, '1Day')).toBe('23');
    expect(formatTickMark(day, TickMarkType.Month, '1Day')).toBe('Oct');
    expect(formatTickMark(day, TickMarkType.Year, '1Month')).toBe('2026');
  });

  it('leaves non-numeric times to the chart', () => {
    expect(formatTickMark('2026-10-23', TickMarkType.DayOfMonth, '1Day')).toBeNull();
  });
});

describe('historyStartNote', () => {
  const first = bar(seconds('2016-01-01T00:00:00Z'), 10, 11);

  it('names the first available month when history is truncated', () => {
    expect(historyStartNote(result({ truncated: true, bars: [first] }))).toBe(
      'History starts Jan 2016 (earliest available)',
    );
  });

  it('says nothing when the range is complete or empty', () => {
    expect(historyStartNote(result({ truncated: false, bars: [first] }))).toBeNull();
    expect(historyStartNote(result({ truncated: true, bars: [] }))).toBeNull();
  });
});

describe('describeBar', () => {
  const t0 = seconds('2026-10-22T00:00:00Z');
  const t1 = seconds('2026-10-23T00:00:00Z');
  const bars = [bar(t0, 100, 102), bar(t1, 102.5, 101)];

  it('lists OHLC and volume with the change from the previous close', () => {
    const details = describeBar(bars, 1, '1Day');
    expect(details).toEqual({
      time: 'Oct 23, 2026',
      rows: [
        { label: 'Open', value: '102.50' },
        { label: 'High', value: '103.50' },
        { label: 'Low', value: '100.00' },
        { label: 'Close', value: '101.00' },
        { label: 'Volume', value: '1.20M' },
      ],
      change: '−1.00 (−0.98%)',
      direction: -1,
    });
  });

  it('measures the first bar against its own open', () => {
    expect(describeBar(bars, 0, '1Day')?.change).toBe('+2.00 (+2.00%)');
  });

  it('prints a change below a dollar with the decimals of the close', () => {
    expect(describeBar([bar(t0, 235, 235.5), bar(t1, 235.4, 236.26)], 1, '1Day')?.change).toBe('+0.76 (+0.32%)');
    expect(describeBar([bar(t0, 0.5, 0.51), bar(t1, 0.51, 0.5076)], 1, '1Day')?.change).toBe(
      '−0.0024 (−0.47%)',
    );
  });

  it('returns null for an index outside the bars', () => {
    expect(describeBar(bars, -1, '1Day')).toBeNull();
    expect(describeBar(bars, 2, '1Day')).toBeNull();
  });

  it('reads as one sentence for screen readers', () => {
    const details = describeBar(bars, 0, '1Day');
    expect(details && announceBar(details)).toBe(
      'Oct 22, 2026. Open 100.00, High 103.00, Low 99.00, Close 102.00, Volume 1.20M. Change +2.00 (+2.00%).',
    );
  });
});

describe('chartSummary', () => {
  it('describes the span, bar count and key prices', () => {
    const bars = [bar(seconds('2026-10-22T00:00:00Z'), 100, 102), bar(seconds('2026-10-23T00:00:00Z'), 102.5, 101)];
    expect(chartSummary('AAPL', '3M', result({ range: '3M', timeframe: '1Day', bars }))).toBe(
      'AAPL price history, 3 months, daily bars. 2 bars from Oct 22, 2026 to Oct 23, 2026. ' +
        'Last close 101.00, high 103.50, low 99.00.',
    );
  });

  it('handles an empty result', () => {
    expect(chartSummary('AAPL', '1D', result({ range: '1D', timeframe: '5Min' }))).toBe(
      'AAPL price history, 1 day, 5-minute bars. No bars.',
    );
  });
});
