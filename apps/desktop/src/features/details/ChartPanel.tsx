import { ChartCandlestick, RotateCw, TriangleAlert } from 'lucide-react';
import { useMemo, useRef } from 'react';
import { Button } from '../../components/ui/Button';
import { EmptyState } from '../../components/ui/EmptyState';
import { SegmentedControl, type SegmentedOption } from '../../components/ui/SegmentedControl';
import { Spinner } from '../../components/ui/Spinner';
import { describeTimeframe } from '@aperture/shared/chartRanges';
import { useQuote } from '../../data/quoteStore';
import { CHART_RANGES, type ChartRange, type HistoryResult } from '../../domain/types';
import type { ChartStyle } from './chartData';
import { chartSummary, historyStartNote, rangeLabel, rangeName, timeframeForRange } from './chartFormat';
import { PriceChart } from './PriceChart';
import { liveLine } from './quoteView';
import { StockCard } from './StockCard';
import { useHistory, type HistoryView } from './useHistory';
import './details.css';

const RANGE_OPTIONS: SegmentedOption<ChartRange>[] = CHART_RANGES.map((range) => ({
  value: range,
  label: rangeLabel(range),
  title: `${rangeName(range)} · ${describeTimeframe(timeframeForRange(range))}`,
}));

const STYLE_OPTIONS: SegmentedOption<ChartStyle>[] = [
  { value: 'candles', label: 'Candles', title: 'Open, high, low and close for each bar' },
  { value: 'line', label: 'Line', title: 'A line through each bar’s close' },
];

interface ChartPanelProps {
  symbol: string;
  range: ChartRange;
  onRangeChange: (range: ChartRange) => void;
  chartStyle: ChartStyle;
  /** Shows a Candles/Line toggle. Without it the chart keeps `chartStyle`. */
  onChartStyleChange?: (style: ChartStyle) => void;
  /** `compact` fits the quick view; `card` is the stock page's large chart card. */
  variant?: 'compact' | 'card';
}

/** Range picker and the history chart with its loading, empty and error states. */
export function ChartPanel({
  symbol,
  range,
  onRangeChange,
  chartStyle,
  onChartStyleChange,
  variant = 'compact',
}: ChartPanelProps) {
  const { view, retry } = useHistory(symbol, range);
  const timeframe = view.status === 'ready' ? view.result.timeframe : timeframeForRange(range);
  const note = view.status === 'ready' ? historyStartNote(view.result) : null;
  const meta = (
    <>
      {describeTimeframe(timeframe)}
      {view.status === 'ready' && view.result.simulated && ' · Simulated'}
    </>
  );
  const ranges = (
    <SegmentedControl size="sm" aria-label="Chart range" options={RANGE_OPTIONS} value={range} onChange={onRangeChange} />
  );
  const styles = onChartStyleChange && (
    <SegmentedControl
      size="sm"
      aria-label="Chart style"
      options={STYLE_OPTIONS}
      value={chartStyle}
      onChange={onChartStyleChange}
    />
  );
  const body = (
    <ChartBody symbol={symbol} range={range} chartStyle={chartStyle} view={view} retry={retry} note={note} />
  );

  if (variant === 'card') {
    return (
      <StockCard
        title="Price history"
        meta={meta}
        className="stock-chart"
        actions={
          <>
            {ranges}
            {styles}
          </>
        }
      >
        {body}
      </StockCard>
    );
  }

  return (
    <div className="details-chart">
      <div className="details-chart__header">
        <h3 className="details-section-title">Price history</h3>
        <p className="details-chart__meta">{meta}</p>
      </div>
      <div className="details-chart__ranges">{ranges}</div>
      {styles}
      {body}
    </div>
  );
}

interface ChartBodyProps {
  symbol: string;
  range: ChartRange;
  chartStyle: ChartStyle;
  view: HistoryView;
  retry: () => void;
  note: string | null;
}

function ChartBody({ symbol, range, chartStyle, view, retry, note }: ChartBodyProps) {
  const bodyRef = useRef<HTMLDivElement>(null);
  return (
    <>
      {note && <p className="details-chart__note">{note}</p>}
      <div ref={bodyRef} className="details-chart__body" tabIndex={-1} aria-busy={view.status === 'loading'}>
        {view.status === 'loading' && (
          <div className="details-chart__state">
            <Spinner size={18} label={`Loading ${rangeName(range).toLowerCase()} price history`} />
            <span aria-hidden="true">Loading price history…</span>
          </div>
        )}
        {view.status === 'error' && (
          <EmptyState
            compact
            icon={<TriangleAlert />}
            title="Couldn't load price history"
            description={view.message}
            action={
              <Button
                size="sm"
                icon={<RotateCw />}
                onClick={() => {
                  // ** The button unmounts while the history reloads, so focus stays in the chart area.
                  bodyRef.current?.focus();
                  retry();
                }}
              >
                Retry
              </Button>
            }
          />
        )}
        {view.status === 'ready' && view.result.bars.length === 0 && (
          <EmptyState
            compact
            icon={<ChartCandlestick />}
            title="No bars for this range"
            description="The provider returned no history here. Try another range."
          />
        )}
        {view.status === 'ready' && view.result.bars.length > 0 && (
          <LiveChart symbol={symbol} range={range} result={view.result} chartStyle={chartStyle} />
        )}
      </div>
    </>
  );
}

interface LiveChartProps {
  symbol: string;
  range: ChartRange;
  result: HistoryResult;
  chartStyle: ChartStyle;
}

/** Joins the history with the live quote. Kept apart so a tick re-renders only the chart. */
function LiveChart({ symbol, range, result, chartStyle }: LiveChartProps) {
  const quote = useQuote(symbol);
  const summary = useMemo(() => chartSummary(symbol, range, result), [symbol, range, result]);
  return (
    <PriceChart
      bars={result.bars}
      timeframe={result.timeframe}
      live={liveLine(quote)}
      summary={summary}
      chartStyle={chartStyle}
    />
  );
}
