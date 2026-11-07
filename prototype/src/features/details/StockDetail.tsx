import { BellPlus, ChartLine, Maximize2, SearchX } from 'lucide-react';
import { useRef } from 'react';
import { useLocation } from 'wouter';
import { paths } from '../../app/routes';
import { useUiStore } from '../../app/uiStore';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { EmptyState } from '../../components/ui/EmptyState';
import { IconButton } from '../../components/ui/IconButton';
import { normalizeSymbol } from '../../domain/symbols';
import { ChartPanel } from './ChartPanel';
import { useChartRange, useChartStyle } from './chartView';
import { InstrumentLine } from './InstrumentLine';
import { QuoteSummary } from './QuoteSummary';
import { useInstrument } from './useInstrument';
import './details.css';

interface StockDetailProps {
  /** Show a button that opens the symbol's full page, for the quick view beside a table. */
  expandable?: boolean;
}

/**
 * Compact detail panel for the selected symbol: identity, live quote, stats and the history chart.
 * The chart range and style follow the settings until the user picks a range, and the pick carries
 * over when the selection changes and to the full page.
 */
export function StockDetail({ expandable = false }: StockDetailProps) {
  const selected = useUiStore((s) => s.selectedSymbol);

  if (selected === null) {
    return (
      <div className="details details--empty">
        <EmptyState
          icon={<ChartLine />}
          title="Select a symbol to see its details"
          description="Choose a row in the market table or search for a symbol."
        />
      </div>
    );
  }

  const symbol = normalizeSymbol(selected);
  // ** Keyed by symbol so every request, tooltip and timer from the previous symbol is dropped at once.
  return <SymbolDetail key={symbol} symbol={symbol} expandable={expandable} />;
}

function SymbolDetail({ symbol, expandable }: { symbol: string; expandable: boolean }) {
  const [, navigate] = useLocation();
  const { view, retry } = useInstrument(symbol);
  const [range, setRange] = useChartRange();
  const [chartStyle] = useChartStyle();
  const identityRef = useRef<HTMLDivElement>(null);
  const unknown = view.status === 'ready' && view.instrument === null;
  const retryInstrument = () => {
    // ** The retry button unmounts while the lookup runs, so focus stays on the identity block.
    identityRef.current?.focus();
    retry();
  };

  return (
    <div className="details">
      <div className="details__header">
        <div ref={identityRef} className="details__identity" tabIndex={-1}>
          <div className="details__title-row">
            <h2 className="details__symbol">{symbol}</h2>
            <Badge tone="warning" size="sm" title="Simulated prices, not real market data">
              Simulated
            </Badge>
          </div>
          <InstrumentLine view={view} onRetry={retryInstrument} />
        </div>
        {!unknown && (
          <div className="details__actions">
            <Button
              size="sm"
              icon={<BellPlus />}
              onClick={() => {
                useUiStore.getState().openCreateAlert(symbol);
              }}
            >
              Create alert
            </Button>
            {expandable && (
              <IconButton
                label={`Open ${symbol} full page`}
                icon={<Maximize2 />}
                size="sm"
                onClick={() => {
                  navigate(paths.symbol(symbol));
                }}
              />
            )}
          </div>
        )}
      </div>
      {unknown ? (
        <EmptyState
          icon={<SearchX />}
          title={`No instrument found for ${symbol}`}
          description="The data provider doesn't know this symbol. Check the ticker and try again."
        />
      ) : (
        <>
          <QuoteSummary symbol={symbol} />
          <ChartPanel symbol={symbol} range={range} onRangeChange={setRange} chartStyle={chartStyle} />
        </>
      )}
    </div>
  );
}
