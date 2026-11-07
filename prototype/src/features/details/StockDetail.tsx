import { BellPlus, ChartLine, Maximize2, RotateCw, SearchX } from 'lucide-react';
import { useRef, useState } from 'react';
import { useLocation } from 'wouter';
import { paths } from '../../app/routes';
import { useUiStore } from '../../app/uiStore';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { EmptyState } from '../../components/ui/EmptyState';
import { IconButton } from '../../components/ui/IconButton';
import { Skeleton } from '../../components/ui/Skeleton';
import { normalizeSymbol } from '../../domain/symbols';
import type { ChartRange } from '../../domain/types';
import { ChartPanel } from './ChartPanel';
import { QuoteSummary } from './QuoteSummary';
import { useInstrument, type InstrumentView } from './useInstrument';
import './details.css';

const DEFAULT_RANGE: ChartRange = '1D';

interface StockDetailProps {
  /** Show a button that opens the symbol's full page, for the quick view beside a table. */
  expandable?: boolean;
}

/**
 * Detail panel for the selected symbol: identity, live quote, stats and the history chart.
 * The chosen chart range carries over when the selection changes.
 */
export function StockDetail({ expandable = false }: StockDetailProps) {
  const selected = useUiStore((s) => s.selectedSymbol);
  const [range, setRange] = useState<ChartRange>(DEFAULT_RANGE);

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
  return (
    <SymbolDetail key={symbol} symbol={symbol} range={range} onRangeChange={setRange} expandable={expandable} />
  );
}

interface SymbolDetailProps {
  symbol: string;
  range: ChartRange;
  onRangeChange: (range: ChartRange) => void;
  expandable: boolean;
}

function SymbolDetail({ symbol, range, onRangeChange, expandable }: SymbolDetailProps) {
  const [, navigate] = useLocation();
  const { view, retry } = useInstrument(symbol);
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
          <ChartPanel symbol={symbol} range={range} onRangeChange={onRangeChange} />
        </>
      )}
    </div>
  );
}

function InstrumentLine({ view, onRetry }: { view: InstrumentView; onRetry: () => void }) {
  if (view.status === 'loading') {
    return (
      <div className="details__instrument" aria-busy="true">
        <span className="visually-hidden">Loading company details</span>
        <Skeleton width={180} height={12} />
      </div>
    );
  }
  if (view.status === 'error') {
    return (
      <div className="details__instrument is-error">
        <span title={view.message}>Company details unavailable</span>
        <IconButton size="sm" label="Retry loading company details" icon={<RotateCw />} onClick={onRetry} />
      </div>
    );
  }
  if (view.instrument === null) {
    return <p className="details__instrument">Unknown symbol</p>;
  }
  return (
    <p className="details__instrument">
      <span className="details__name">{view.instrument.name}</span>
      <span className="details__exchange">{view.instrument.exchange}</span>
    </p>
  );
}
