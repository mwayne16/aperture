import { TrendingUp } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'wouter';
import { paths } from '../../app/routes';
import { Badge } from '../../components/ui/Badge';
import { EmptyState } from '../../components/ui/EmptyState';
import { SegmentedControl, type SegmentedOption } from '../../components/ui/SegmentedControl';
import { api } from '../../data/dataLayer';
import type { Instrument, MarketMovers, Quote } from '../../domain/types';
import { changeDirection, formatPercent, formatPrice, formatVolume } from '../../lib/format';
import { useInstrumentDirectory } from '../discover/instrumentCatalog';
import { SimulatedBadge } from '../discover/SimulatedBadge';
import { usePolledRequest } from '../discover/usePolledRequest';
import { CardError, DashboardCard, Freshness, SkeletonRows } from './DashboardCard';

type MoverKind = 'gainers' | 'losers' | 'mostActive';

const MOVERS_LIMIT = 5;
const MOVERS_REFRESH_MS = 15_000;
const KINDS: SegmentedOption<MoverKind>[] = [
  { value: 'gainers', label: 'Gainers' },
  { value: 'losers', label: 'Losers' },
  { value: 'mostActive', label: 'Most active' },
];
const EMPTY_TITLE: Readonly<Record<MoverKind, string>> = {
  gainers: 'No stocks are up today',
  losers: 'No stocks are down today',
  mostActive: 'No trading yet today',
};

/** Today's biggest stock gainers and losers and the most traded stocks, refreshed every 15 s. */
export function MoversCard() {
  const [kind, setKind] = useState<MoverKind>('gainers');
  const { view, retry } = usePolledRequest<MarketMovers>('movers', () => api.getMovers(MOVERS_LIMIT), {
    refreshMs: MOVERS_REFRESH_MS,
  });
  const directory = useInstrumentDirectory();

  let body;
  if (view.status === 'loading') {
    body = <SkeletonRows count={MOVERS_LIMIT} />;
  } else if (view.status === 'error') {
    body = <CardError title="Couldn't load top movers" message={view.message} onRetry={retry} />;
  } else {
    const quotes = view.data[kind];
    body =
      quotes.length === 0 ? (
        <EmptyState compact icon={<TrendingUp />} title={EMPTY_TITLE[kind]} />
      ) : (
        <ul className="dash-list">
          {quotes.map((quote) => (
            <li key={quote.symbol}>
              <MoverRow quote={quote} kind={kind} instrument={directory.get(quote.symbol)} />
            </li>
          ))}
        </ul>
      );
  }

  return (
    <DashboardCard
      title="Top movers"
      className="dash-movers"
      meta={
        <>
          {view.status === 'ready' && view.data.simulated && (
            <SimulatedBadge title="Rankings come from a simulated feed. They are not real market data." />
          )}
          {view.status === 'ready' && (
            <Freshness asOf={view.data.asOf} refreshError={view.refreshError} onRetry={retry} />
          )}
        </>
      }
      actions={
        <SegmentedControl size="sm" aria-label="Movers" options={KINDS} value={kind} onChange={setKind} />
      }
    >
      {body}
    </DashboardCard>
  );
}

function MoverRow({
  quote,
  kind,
  instrument,
}: {
  quote: Quote;
  kind: MoverKind;
  instrument: Instrument | undefined;
}) {
  const direction = changeDirection(quote.change);
  const tone = direction > 0 ? 'gain' : direction < 0 ? 'loss' : 'muted';
  return (
    <Link href={paths.symbol(quote.symbol)} className="dash-row dash-row--mover">
      <span className="dash-row__label">
        <span className="dash-row__symbol">{quote.symbol}</span>{' '}
        <span className="dash-row__name">{instrument?.name}</span>
      </span>{' '}
      <span className="dash-row__value num">
        {kind === 'mostActive' ? (
          <>
            {formatVolume(quote.volume)}
            <span className="visually-hidden"> shares</span>
          </>
        ) : (
          formatPrice(quote.last)
        )}
      </span>{' '}
      <span className="dash-row__badge">
        <Badge tone={tone} size="sm">
          {formatPercent(quote.changePct)}
        </Badge>
      </span>
    </Link>
  );
}
