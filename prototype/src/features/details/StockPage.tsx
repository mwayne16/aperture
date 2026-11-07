import { RotateCw, SearchX } from 'lucide-react';
import { useEffect } from 'react';
import { Link, useParams } from 'wouter';
import { decodeParam, paths } from '../../app/routes';
import { useUiStore } from '../../app/uiStore';
import { Button } from '../../components/ui/Button';
import { EmptyState } from '../../components/ui/EmptyState';
import { Skeleton } from '../../components/ui/Skeleton';
import { validateSymbol } from '../../domain/symbols';
import type { Instrument } from '../../domain/types';
import { AboutCard } from './AboutCard';
import { ChartPanel } from './ChartPanel';
import { useChartRange, useChartStyle } from './chartView';
import { NewsCard } from './NewsCard';
import { StockCard } from './StockCard';
import { StockHeader } from './StockHeader';
import { StockStats } from './StockStats';
import { SymbolAlertsCard } from './SymbolAlertsCard';
import { useInstrument } from './useInstrument';
import './details.css';
import './stockPage.css';

/**
 * Full page for one symbol: header with the live price and actions, the large chart, key statistics,
 * then alerts, news and details. The symbol in the URL becomes the selection, so it stays subscribed.
 */
export function StockPage() {
  const params = useParams<{ symbol?: string }>();
  const raw = decodeParam(params.symbol);
  const checked = validateSymbol(raw ?? '');
  const symbol = checked.ok ? checked.value : null;

  useEffect(() => {
    if (symbol !== null) useUiStore.getState().selectSymbol(symbol);
  }, [symbol]);

  if (!checked.ok) {
    return (
      <div className="page stock-page">
        <header className="stock-header">
          <h1 className="stock-header__symbol stock-header__symbol--invalid">{raw ?? 'Unknown symbol'}</h1>
        </header>
        <NoInstrument title={raw === null ? 'No symbol in this address' : `“${raw}” isn't a valid symbol`}>
          {checked.reason}
        </NoInstrument>
      </div>
    );
  }
  // ** Keyed by symbol so requests and state from the previous symbol never reach the next one.
  return <SymbolPage key={checked.value} symbol={checked.value} />;
}

function SymbolPage({ symbol }: { symbol: string }) {
  const { view, retry } = useInstrument(symbol);
  return (
    <div className="page stock-page">
      <StockHeader symbol={symbol} view={view} onRetry={retry} />
      {view.status === 'loading' && <PageSkeleton />}
      {view.status === 'ready' && view.instrument === null && (
        <NoInstrument title={`No instrument found for ${symbol}`}>
          The data provider doesn't know this symbol. Check the ticker and try again.
        </NoInstrument>
      )}
      {view.status === 'ready' && view.instrument !== null && <PageBody symbol={symbol} instrument={view.instrument} />}
      {view.status === 'error' && <PageBody symbol={symbol} instrument={null} onRetry={retry} />}
    </div>
  );
}

interface PageBodyProps {
  symbol: string;
  /** Null when company details failed to load; the quote, chart and alerts still work. */
  instrument: Instrument | null;
  onRetry?: () => void;
}

function PageBody({ symbol, instrument, onRetry }: PageBodyProps) {
  const [range, setRange] = useChartRange();
  const [chartStyle, setChartStyle] = useChartStyle();
  return (
    <>
      <ChartPanel
        variant="card"
        symbol={symbol}
        range={range}
        onRangeChange={setRange}
        chartStyle={chartStyle}
        onChartStyleChange={setChartStyle}
      />
      <StockStats symbol={symbol} />
      <div className="stock-page__cards">
        <SymbolAlertsCard symbol={symbol} />
        <NewsCard symbol={symbol} />
        {instrument ? (
          <AboutCard instrument={instrument} />
        ) : (
          <StockCard title="About">
            <EmptyState
              compact
              title="Company details unavailable"
              action={
                onRetry && (
                  <Button size="sm" icon={<RotateCw />} onClick={onRetry}>
                    Retry
                  </Button>
                )
              }
            />
          </StockCard>
        )}
      </div>
    </>
  );
}

function PageSkeleton() {
  return (
    <div className="stock-page__skeleton" aria-hidden="true">
      <Skeleton height={460} radius={8} />
      <Skeleton height={120} radius={8} />
    </div>
  );
}

function NoInstrument({ title, children }: { title: string; children: string }) {
  return (
    <div className="stock-page__missing">
      <EmptyState
        icon={<SearchX />}
        title={title}
        description={children}
        action={
          <span className="stock-page__missing-links">
            <Link href={paths.discover()} className="page-link">
              Browse stocks
            </Link>
            <Link href={paths.watchlists} className="page-link">
              Go to your watchlists
            </Link>
          </span>
        }
      />
    </div>
  );
}
