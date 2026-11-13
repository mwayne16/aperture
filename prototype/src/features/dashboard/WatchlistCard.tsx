import { ChevronRight, List, Star } from 'lucide-react';
import { Link } from 'wouter';
import { paths } from '../../app/routes';
import { Badge } from '../../components/ui/Badge';
import { cx } from '../../components/ui/cx';
import { EmptyState } from '../../components/ui/EmptyState';
import { useQuote } from '../../data/quoteStore';
import type { Instrument } from '../../domain/types';
import { changeDirection, formatPercent, formatPrice } from '../../lib/format';
import { useInstrumentDirectory } from '../discover/instrumentCatalog';
import { SimulatedBadge } from '../discover/SimulatedBadge';
import { Sparkline } from '../discover/Sparkline';
import { useActiveWatchlist, useWatchlistStore } from '../watchlists/watchlistStore';
import { CardError, DashboardCard, SkeletonRows } from './DashboardCard';

/** Rows shown before the card links to the full watchlist instead. */
const MAX_ROWS = 8;

function reloadWatchlists(): void {
  void useWatchlistStore.getState().load({ force: true });
}

/** The active watchlist with live prices, linking to its page. */
export function WatchlistCard() {
  const status = useWatchlistStore((s) => s.status);
  const error = useWatchlistStore((s) => s.error);
  const hasLists = useWatchlistStore((s) => s.watchlists.length > 0);
  const watchlist = useActiveWatchlist();
  const directory = useInstrumentDirectory();

  let body;
  if (watchlist !== null && watchlist.symbols.length > 0) {
    const hidden = watchlist.symbols.length - MAX_ROWS;
    body = (
      <>
        <ul className="dash-list">
          {watchlist.symbols.slice(0, MAX_ROWS).map((symbol) => (
            <li key={symbol}>
              <WatchlistRow symbol={symbol} instrument={directory.get(symbol)} />
            </li>
          ))}
        </ul>
        {hidden > 0 && (
          <Link href={paths.watchlist(watchlist.id)} className="dash-card__more">
            {hidden} more in “{watchlist.name}”
          </Link>
        )}
      </>
    );
  } else if (watchlist !== null) {
    body = (
      <EmptyState
        compact
        icon={<Star />}
        title={`“${watchlist.name}” is empty`}
        description={
          <>
            Star symbols on the{' '}
            <Link href={paths.discover()} className="page-link">
              Discover
            </Link>{' '}
            page to follow them here.
          </>
        }
      />
    );
  } else if (status === 'error') {
    body = (
      <CardError
        title="Couldn't load watchlists"
        message={error ?? 'Something went wrong.'}
        onRetry={reloadWatchlists}
      />
    );
  } else if (status === 'idle' || status === 'loading' || hasLists) {
    body = <SkeletonRows count={5} />;
  } else {
    body = (
      <EmptyState
        compact
        icon={<List />}
        title="No watchlists yet"
        description="Create a watchlist in the sidebar to follow symbols here."
      />
    );
  }

  return (
    <DashboardCard
      title="Your watchlist"
      className="dash-watchlist"
      meta={
        <>
          {watchlist !== null && (
            <Badge tone="muted" size="sm">
              {watchlist.name}
            </Badge>
          )}
          <SimulatedBadge title="Prices come from a simulated feed. They are not real market data." />
        </>
      }
      actions={
        watchlist !== null && (
          <Link href={paths.watchlist(watchlist.id)} className="dash-card__link">
            Open watchlist
            <ChevronRight aria-hidden="true" />
          </Link>
        )
      }
    >
      {body}
    </DashboardCard>
  );
}

/** One watched symbol with its live price. Reads its own quote, so a tick re-renders only this row. */
function WatchlistRow({ symbol, instrument }: { symbol: string; instrument: Instrument | undefined }) {
  const quote = useQuote(symbol);
  const dimmed = quote?.status === 'stale' || quote?.status === 'unavailable';
  const direction = dimmed ? 0 : changeDirection(quote?.change);
  const tone = direction > 0 ? 'gain' : direction < 0 ? 'loss' : 'muted';
  return (
    <Link href={paths.symbol(symbol)} className={cx('dash-row dash-row--watch', dimmed && 'is-dimmed')}>
      {/* Spaces between the parts keep the link's accessible name readable ("AAPL Apple Inc. 235.59"). */}
      <span className="dash-row__label">
        <span className="dash-row__symbol">{symbol}</span>{' '}
        <span className="dash-row__name">{instrument?.name}</span>
      </span>{' '}
      <Sparkline symbol={symbol} width={72} height={24} direction={direction} />
      <span className="dash-row__value num">{formatPrice(quote?.last)}</span>{' '}
      <span className="dash-row__badge">
        <Badge tone={tone} size="sm">
          {formatPercent(quote?.changePct)}
        </Badge>
      </span>
    </Link>
  );
}
