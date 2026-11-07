import { WifiOff } from 'lucide-react';
import { cx } from '../../components/ui/cx';
import { Skeleton } from '../../components/ui/Skeleton';
import { StatusDot } from '../../components/ui/StatusDot';
import { Tooltip } from '../../components/ui/Tooltip';
import { useConnection } from '../../data/connectionStore';
import { useQuote } from '../../data/quoteStore';
import type { Quote } from '../../domain/types';
import {
  EMPTY_VALUE,
  changeDirection,
  formatAge,
  formatChange,
  formatClock,
  formatPercent,
  formatPrice,
} from '../../lib/format';
import { awaitingQuote, connectionNotice, describeStatus, quoteStats, quoteTime } from './quoteView';
import { useNow } from './useNow';
import './details.css';

function directionClass(value: number | null): string | false {
  const direction = changeDirection(value);
  return direction !== 0 && (direction > 0 ? 'is-gain' : 'is-loss');
}

/** Live quote for one symbol: last price, change, data status and age, then the stats grid. */
export function QuoteSummary({ symbol }: { symbol: string }) {
  const quote = useQuote(symbol);
  const { state } = useConnection();
  const notice = connectionNotice(state, quote !== undefined);

  return (
    <div className="details-quote">
      <h3 className="visually-hidden">Quote</h3>
      {notice && (
        <p className="details-quote__notice" role="status">
          <WifiOff aria-hidden="true" />
          {notice}
        </p>
      )}
      {quote ? <QuoteHeadline quote={quote} /> : <QuotePlaceholder loading={awaitingQuote(state)} />}
      <dl className="details-stats">
        {quoteStats(quote).map((stat) => (
          <div key={stat.label} className="details-stats__item">
            <dt>{stat.label}</dt>
            <dd className="num">{stat.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function QuoteHeadline({ quote }: { quote: Quote }) {
  const now = useNow();
  const status = describeStatus(quote.status);
  const time = quoteTime(quote);
  const dimmed = quote.status === 'stale' || quote.status === 'unavailable';

  return (
    <div className="details-quote__headline">
      <div className="details-quote__price-row">
        <span className={cx('details-quote__last num', dimmed && 'is-dimmed')}>
          <span className="visually-hidden">Last price </span>
          {formatPrice(quote.last)}
        </span>
        <span className={cx('details-quote__change num', directionClass(quote.change))}>
          <span className="visually-hidden">Change </span>
          {formatChange(quote.change)} ({formatPercent(quote.changePct)})
        </span>
      </div>
      <div className="details-quote__status">
        <Tooltip content={status.description}>
          <span className="details-quote__status-label">
            <StatusDot tone={status.tone} pulse={status.pulse} label={status.label} />
          </span>
        </Tooltip>
        <span className="visually-hidden">{status.description}</span>
        {time !== null && (
          <span className="details-quote__time num">
            {formatClock(time)} ET · {formatAge(time, now)}
          </span>
        )}
      </div>
    </div>
  );
}

/** Skeletons while the first quote is on its way; a plain dash once the feed is down and none can arrive. */
function QuotePlaceholder({ loading }: { loading: boolean }) {
  if (!loading) {
    return (
      <div className="details-quote__headline">
        <span className="details-quote__last num is-dimmed">
          <span className="visually-hidden">Last price </span>
          {EMPTY_VALUE}
        </span>
      </div>
    );
  }
  return (
    <div className="details-quote__headline" aria-hidden="true">
      <div className="details-quote__price-row">
        <Skeleton width={120} height={28} />
        <Skeleton width={96} height={14} />
      </div>
      <Skeleton width={160} height={12} />
    </div>
  );
}
