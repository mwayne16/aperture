import { Link } from 'wouter';
import { paths } from '../../app/routes';
import { cx } from '../../components/ui/cx';
import { Skeleton } from '../../components/ui/Skeleton';
import type { Quote } from '../../domain/types';
import { changeDirection, formatChange, formatPercent, formatPrice } from '../../lib/format';
import { SimulatedBadge } from '../discover/SimulatedBadge';
import { Sparkline } from '../discover/Sparkline';
import { useSnapshots } from '../discover/useSnapshots';
import { CardError, DashboardCard, Freshness } from './DashboardCard';

interface MarketTile {
  symbol: string;
  name: string;
  /** What the symbol stands for, since the feed carries no index values. */
  kind: string;
}

const TILES: readonly MarketTile[] = [
  { symbol: 'SPY', name: 'S&P 500', kind: 'ETF' },
  { symbol: 'QQQ', name: 'Nasdaq-100', kind: 'ETF' },
  { symbol: 'DIA', name: 'Dow Jones', kind: 'ETF' },
  { symbol: 'IWM', name: 'Russell 2000', kind: 'ETF' },
  { symbol: 'BTC/USD', name: 'Bitcoin', kind: '24/7' },
];
const SYMBOLS = TILES.map((tile) => tile.symbol);

/**
 * The broad market at a glance: the ETFs that track the major US indexes, plus Bitcoin. They sit
 * outside the live stream, so they poll snapshots and say how fresh they are.
 */
export function IndexStrip() {
  const { view, retry } = useSnapshots(SYMBOLS);

  return (
    <DashboardCard
      title="Markets"
      className="dash-markets"
      meta={
        <>
          <SimulatedBadge title="Prices come from a simulated feed. They are not real market data." />
          <span className="dash-card__note">Index ETFs, since the feed has no index values</span>
        </>
      }
      actions={
        view.status === 'ready' && (
          <Freshness asOf={view.receivedAt} refreshError={view.refreshError} onRetry={retry} />
        )
      }
    >
      {view.status === 'error' ? (
        <CardError title="Couldn't load market prices" message={view.message} onRetry={retry} />
      ) : (
        <ul className="dash-markets__tiles">
          {TILES.map((tile) => (
            <li key={tile.symbol}>
              <MarketTileLink
                tile={tile}
                quote={view.status === 'ready' ? view.data.get(tile.symbol) : undefined}
                loading={view.status === 'loading'}
              />
            </li>
          ))}
        </ul>
      )}
    </DashboardCard>
  );
}

function MarketTileLink({
  tile,
  quote,
  loading,
}: {
  tile: MarketTile;
  quote: Quote | undefined;
  loading: boolean;
}) {
  const direction = changeDirection(quote?.change);
  return (
    <Link href={paths.symbol(tile.symbol)} className="dash-tile">
      <span className="dash-tile__label">
        <span className="dash-tile__name">{tile.name}</span>{' '}
        <span className="dash-tile__symbol">
          {tile.symbol} · {tile.kind}
        </span>
      </span>{' '}
      {loading ? (
        <span className="dash-tile__values" aria-hidden="true">
          <Skeleton width={96} height={20} />
          <Skeleton width={110} height={12} />
        </span>
      ) : (
        <span className="dash-tile__values">
          <span className="dash-tile__last num">{formatPrice(quote?.last)}</span>{' '}
          <span
            className={cx('dash-tile__change num', direction > 0 && 'is-gain', direction < 0 && 'is-loss')}
          >
            <span>{formatChange(quote?.change, quote?.last)}</span>{' '}
            <span>({formatPercent(quote?.changePct)})</span>
          </span>
        </span>
      )}
      <Sparkline
        className="dash-tile__spark"
        symbol={tile.symbol}
        width={160}
        height={32}
        stretch
        direction={direction}
        baseline={quote?.prevClose ?? null}
      />
    </Link>
  );
}
