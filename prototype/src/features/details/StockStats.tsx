import { RotateCw } from 'lucide-react';
import { useId, useMemo, useRef, type ReactNode } from 'react';
import { IconButton } from '../../components/ui/IconButton';
import { Skeleton } from '../../components/ui/Skeleton';
import { useQuote } from '../../data/quoteStore';
import type { Quote } from '../../domain/types';
import { formatPrice, formatVolume } from '../../lib/format';
import { quoteStats } from './quoteView';
import { averageDailyVolume, priceRange, rangePosition, type PriceRange } from './historyStats';
import { useHistory, type HistoryView } from './useHistory';
import { useNow } from './useNow';
import './stockPage.css';

const MINUTE_MS = 60_000;

/**
 * Key statistics from data the provider has: the live quote's session values, the average daily
 * volume over 3 months and the 52-week range. Never fundamentals such as market cap or P/E.
 */
export function StockStats({ symbol }: { symbol: string }) {
  const quote = useQuote(symbol);
  const headingId = useId();
  return (
    <section className="stock-stats" aria-labelledby={headingId}>
      <h2 id={headingId} className="visually-hidden">
        Key statistics
      </h2>
      <dl className="stock-stats__grid">
        {quoteStats(quote).map((stat) => (
          <div key={stat.label} className="stock-stat">
            <dt>{stat.label}</dt>
            <dd className="num">{stat.value}</dd>
          </div>
        ))}
        <AverageVolume symbol={symbol} />
        <YearRange symbol={symbol} quote={quote} />
      </dl>
      <p className="stock-stats__note">
        Prices and volume are simulated. With the Alpaca IEX feed, volume will count IEX trades only.
      </p>
    </section>
  );
}

interface HistoryValueProps {
  view: HistoryView;
  onRetry: () => void;
  /** Names what Retry reloads, e.g. "Retry loading 3-month history". */
  retryLabel: string;
  children: ReactNode;
}

/** A value that depends on history: a skeleton while it loads, a short note and Retry if it can't. */
function HistoryValue({ view, onRetry, retryLabel, children }: HistoryValueProps) {
  const valueRef = useRef<HTMLSpanElement>(null);
  let content: ReactNode = children;
  if (view.status === 'loading') {
    content = (
      <>
        <span className="visually-hidden">Loading</span>
        <Skeleton width={72} height={14} />
      </>
    );
  } else if (view.status === 'error') {
    content = (
      <>
        <span className="stock-stat__missing" title={view.message}>
          Unavailable
        </span>
        <IconButton
          size="sm"
          label={retryLabel}
          icon={<RotateCw />}
          onClick={() => {
            // ** The button unmounts while the history reloads, so focus stays on the value.
            valueRef.current?.focus();
            onRetry();
          }}
        />
      </>
    );
  }
  return (
    <span ref={valueRef} className="stock-stat__value" tabIndex={-1}>
      {content}
    </span>
  );
}

function AverageVolume({ symbol }: { symbol: string }) {
  const { view, retry } = useHistory(symbol, '3M');
  const now = useNow(MINUTE_MS);
  const bars = view.status === 'ready' ? view.result.bars : null;
  const average = useMemo(() => (bars ? averageDailyVolume(bars, now) : null), [bars, now]);
  return (
    <div className="stock-stat">
      <dt title="Average daily volume over the last 3 months, not counting today">Avg volume (3M)</dt>
      <dd className="num">
        <HistoryValue view={view} onRetry={retry} retryLabel="Retry loading 3-month history">
          {formatVolume(average)}
        </HistoryValue>
      </dd>
    </div>
  );
}

function YearRange({ symbol, quote }: { symbol: string; quote: Quote | undefined }) {
  const { view, retry } = useHistory(symbol, '1Y');
  const bars = view.status === 'ready' ? view.result.bars : null;
  const high = quote?.high;
  const low = quote?.low;
  const last = quote?.last;
  // ** Today's live values widen the range, so the marker never sits outside a range that excludes today.
  const range = useMemo(() => (bars ? priceRange(bars, [high, low, last]) : null), [bars, high, low, last]);
  return (
    <div className="stock-stat stock-stat--wide">
      <dt>52-week range</dt>
      <dd>
        <HistoryValue view={view} onRetry={retry} retryLabel="Retry loading 1-year history">
          <RangeBar range={range} price={last} />
        </HistoryValue>
      </dd>
    </div>
  );
}

function RangeBar({ range, price }: { range: PriceRange | null; price: number | null | undefined }) {
  if (!range) return <span className="num">{formatPrice(null)}</span>;
  const position = rangePosition(price, range);
  const description =
    position === null
      ? `From ${formatPrice(range.low)} to ${formatPrice(range.high)}.`
      : `From ${formatPrice(range.low)} to ${formatPrice(range.high)}. The current price, ${formatPrice(price)}, is ${Math.round(position * 100)}% of the way up.`;
  return (
    <div className="range-bar">
      <span className="range-bar__end num">{formatPrice(range.low)}</span>
      <span className="range-bar__track" role="img" aria-label={description}>
        {position !== null && <span className="range-bar__marker" style={{ left: `${position * 100}%` }} />}
      </span>
      <span className="range-bar__end num">{formatPrice(range.high)}</span>
    </div>
  );
}
