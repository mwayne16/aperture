import { ChartCandlestick, RotateCw, TriangleAlert } from 'lucide-react';
import { useMemo, useRef } from 'react';
import { Button } from '../../components/ui/Button';
import { EmptyState } from '../../components/ui/EmptyState';
import { SegmentedControl, type SegmentedOption } from '../../components/ui/SegmentedControl';
import { Spinner } from '../../components/ui/Spinner';
import { describeTimeframe } from '../../domain/chartRanges';
import { useQuote } from '../../data/quoteStore';
import { CHART_RANGES, type ChartRange, type HistoryResult } from '../../domain/types';
import { chartSummary, historyStartNote, rangeLabel, rangeName, timeframeForRange } from './chartFormat';
import { PriceChart } from './PriceChart';
import { liveLine } from './quoteView';
import { useHistory } from './useHistory';
import './details.css';

const RANGE_OPTIONS: SegmentedOption<ChartRange>[] = CHART_RANGES.map((range) => ({
  value: range,
  label: rangeLabel(range),
  title: `${rangeName(range)} · ${describeTimeframe(timeframeForRange(range))}`,
}));

interface ChartPanelProps {
  symbol: string;
  range: ChartRange;
  onRangeChange: (range: ChartRange) => void;
}

/** Range picker and the history chart with its loading, empty and error states. */
export function ChartPanel({ symbol, range, onRangeChange }: ChartPanelProps) {
  const { view, retry } = useHistory(symbol, range);
  const bodyRef = useRef<HTMLDivElement>(null);
  const timeframe = view.status === 'ready' ? view.result.timeframe : timeframeForRange(range);
  const note = view.status === 'ready' ? historyStartNote(view.result) : null;

  return (
    <div className="details-chart">
      <div className="details-chart__header">
        <h3 className="details-section-title">Price history</h3>
        <p className="details-chart__meta">
          {describeTimeframe(timeframe)}
          {view.status === 'ready' && view.result.simulated && ' · Simulated'}
        </p>
      </div>
      <div className="details-chart__ranges">
        <SegmentedControl
          size="sm"
          aria-label="Chart range"
          options={RANGE_OPTIONS}
          value={range}
          onChange={onRangeChange}
        />
      </div>
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
          <LiveChart symbol={symbol} range={range} result={view.result} />
        )}
      </div>
    </div>
  );
}

interface LiveChartProps {
  symbol: string;
  range: ChartRange;
  result: HistoryResult;
}

/** Joins the history with the live quote. Kept apart so a tick re-renders only the chart. */
function LiveChart({ symbol, range, result }: LiveChartProps) {
  const quote = useQuote(symbol);
  const summary = useMemo(() => chartSummary(symbol, range, result), [symbol, range, result]);
  return <PriceChart bars={result.bars} timeframe={result.timeframe} live={liveLine(quote)} summary={summary} />;
}
