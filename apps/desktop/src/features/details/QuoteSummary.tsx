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
import { awaitingQuote, connectionNotice, describeStatus, quoteTime } from './quoteView';
import { useNow } from './useNow';
import './details.css';

function directionClass(value: number | null): string | false {
  const direction = changeDirection(value);
  return direction !== 0 && (direction > 0 ? 'is-gain' : 'is-loss');
}

type QuoteSize = 'md' | 'lg';

/**
 * Last price with change, data status and age, plus a notice while the feed is down. `lg` is the
 * stock page's large headline.
 */
export function LiveQuote({ symbol, size = 'md' }: { symbol: string; size?: QuoteSize }) {
  const quote = useQuote(symbol);
  const { state } = useConnection();
  const notice = connectionNotice(state, quote !== undefined);
  return (
    <>
      {notice && (
        <p className="details-quote__notice" role="status">
          <WifiOff aria-hidden="true" />
          {notice}
        </p>
      )}
      {quote ? (
        <QuoteHeadline quote={quote} size={size} />
      ) : (
        <QuotePlaceholder loading={awaitingQuote(state)} size={size} />
      )}
    </>
  );
}

function QuoteHeadline({ quote, size }: { quote: Quote; size: QuoteSize }) {
  const now = useNow();
  const status = describeStatus(quote.status);
  const time = quoteTime(quote);
  const dimmed = quote.status === 'stale' || quote.status === 'unavailable';

  return (
    <div className={cx('details-quote__headline', size === 'lg' && 'details-quote__headline--lg')}>
      <div className="details-quote__price-row">
        <span className={cx('details-quote__last num', dimmed && 'is-dimmed')}>
          <span className="visually-hidden">Last price </span>
          {formatPrice(quote.last)}
        </span>
        <span className={cx('details-quote__change num', directionClass(quote.change))}>
          <span className="visually-hidden">Change </span>
          {formatChange(quote.change, quote.last)} ({formatPercent(quote.changePct)})
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
function QuotePlaceholder({ loading, size }: { loading: boolean; size: QuoteSize }) {
  const className = cx('details-quote__headline', size === 'lg' && 'details-quote__headline--lg');
  if (!loading) {
    return (
      <div className={className}>
        <span className="details-quote__last num is-dimmed">
          <span className="visually-hidden">Last price </span>
          {EMPTY_VALUE}
        </span>
      </div>
    );
  }
  const large = size === 'lg';
  return (
    <div className={className} aria-hidden="true">
      <div className="details-quote__price-row">
        <Skeleton width={large ? 180 : 120} height={large ? 40 : 28} />
        <Skeleton width={large ? 140 : 96} height={large ? 20 : 14} />
      </div>
      <Skeleton width={160} height={12} />
    </div>
  );
}
