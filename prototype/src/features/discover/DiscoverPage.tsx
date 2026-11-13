import { CircleAlert, RefreshCw, Search, SearchX } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Redirect, useLocation, useParams } from 'wouter';
import { decodeParam, DISCOVER_TAB_LABELS, isDiscoverTab, paths, type DiscoverTab } from '../../app/routes';
import { Button } from '../../components/ui/Button';
import { EmptyState } from '../../components/ui/EmptyState';
import { PageHeader } from '../../components/ui/PageHeader';
import { Skeleton } from '../../components/ui/Skeleton';
import { Tabs } from '../../components/ui/Tabs';
import { TextInput } from '../../components/ui/TextInput';
import type { AssetClass } from '../../domain/types';
import { formatClock } from '../../lib/format';
import { DEFAULT_SORT, filterInstruments, nextSort, sortRows, type SortState } from './discoverModel';
import { DiscoverTable } from './DiscoverTable';
import { instrumentCatalog } from './instrumentCatalog';
import { SimulatedBadge } from './SimulatedBadge';
import { usePolledRequest, type RequestView } from './usePolledRequest';
import { useSnapshots, type Snapshots } from './useSnapshots';
import './discover.css';

const ASSET_CLASS: Readonly<Record<DiscoverTab, AssetClass>> = {
  stocks: 'stock',
  etfs: 'etf',
  crypto: 'crypto',
};
const NOUN: Readonly<Record<DiscoverTab, [one: string, many: string]>> = {
  stocks: ['stock', 'stocks'],
  etfs: ['ETF', 'ETFs'],
  crypto: ['coin', 'coins'],
};
const TABS = (Object.keys(DISCOVER_TAB_LABELS) as DiscoverTab[]).map((value) => ({
  value,
  label: DISCOVER_TAB_LABELS[value],
}));
const SIMULATED_PRICES = 'Prices come from a simulated feed. They are not real market data.';
const SKELETON_ROWS = 10;
const NO_SYMBOLS: readonly string[] = [];

/** Browse every stock, ETF or coin with polled prices. The tab lives in the URL. */
export function DiscoverPage() {
  const params = useParams<{ tab?: string }>();
  const [, navigate] = useLocation();
  const tab = decodeParam(params.tab);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<SortState>(DEFAULT_SORT);

  // ** A missing or unknown tab gets the canonical address, so the URL always names the visible tab.
  if (!isDiscoverTab(tab)) return <Redirect to={paths.discover()} replace />;

  return (
    <div className="page discover-page">
      <PageHeader
        title="Discover"
        description="Browse stocks, ETFs and crypto. Star a symbol to add it to your watchlist."
        meta={<SimulatedBadge title={SIMULATED_PRICES} />}
      />
      <section className="discover-card" aria-label="Instruments">
        <Tabs
          aria-label="Asset class"
          tabs={TABS}
          value={tab}
          onChange={(next) => {
            navigate(paths.discover(next));
          }}
        />
        <div role="tabpanel" aria-label={DISCOVER_TAB_LABELS[tab]} className="discover-card__panel">
          {/* Keyed by tab so a slow answer for the previous tab never lands in this one. */}
          <InstrumentBrowser
            key={tab}
            tab={tab}
            query={query}
            onQueryChange={setQuery}
            sort={sort}
            onSortChange={setSort}
          />
        </div>
      </section>
    </div>
  );
}

interface InstrumentBrowserProps {
  tab: DiscoverTab;
  query: string;
  onQueryChange: (query: string) => void;
  sort: SortState;
  onSortChange: (sort: SortState) => void;
}

/** One tab's toolbar and table: the instrument list (loaded once) joined with polled snapshots. */
function InstrumentBrowser({ tab, query, onQueryChange, sort, onSortChange }: InstrumentBrowserProps) {
  const assetClass = ASSET_CLASS[tab];
  const instruments = usePolledRequest(assetClass, () => instrumentCatalog.load(assetClass), {
    refreshMs: null,
    peek: () => instrumentCatalog.peek(assetClass),
  });
  const list = instruments.view.status === 'ready' ? instruments.view.data : null;
  const symbols = useMemo(() => list?.map((i) => i.symbol) ?? NO_SYMBOLS, [list]);
  const snapshots = useSnapshots(symbols);
  const prices = snapshots.view;
  const quotes: Snapshots | null = prices.status === 'ready' ? prices.data : null;

  const rows = useMemo(() => {
    if (list === null) return [];
    const visible = filterInstruments(list, query).map((instrument) => ({
      instrument,
      quote: quotes?.get(instrument.symbol),
    }));
    return sortRows(visible, sort);
  }, [list, query, quotes, sort]);

  const [one, many] = NOUN[tab];
  const trimmed = query.trim();
  let count: string | null = null;
  if (list !== null) {
    count =
      trimmed !== ''
        ? `${rows.length} of ${list.length} ${many}`
        : `${list.length} ${list.length === 1 ? one : many}`;
  }

  return (
    <>
      <div className="discover-toolbar">
        <TextInput
          className="discover-toolbar__filter"
          type="search"
          aria-label="Filter by symbol or name"
          placeholder="Filter by symbol or name"
          leadingIcon={<Search />}
          value={query}
          onChange={(event) => {
            onQueryChange(event.target.value);
          }}
        />
        <span className="discover-toolbar__count num">{count}</span>
        <span className="discover-toolbar__spacer" />
        {tab === 'crypto' && (
          <span className="discover-toolbar__note">Crypto trades 24/7. Volume is in coins.</span>
        )}
        <AsOf view={prices} />
      </div>
      {prices.status === 'error' && list !== null && (
        <Notice message={`Couldn't load prices. ${prices.message}`} onRetry={snapshots.retry} />
      )}
      {prices.status === 'ready' && prices.refreshError !== null && (
        <Notice message={`Couldn't refresh prices. ${prices.refreshError}`} onRetry={snapshots.retry} />
      )}
      <div className="discover-card__body">
        {instruments.view.status === 'loading' && <TableSkeleton />}
        {instruments.view.status === 'error' && (
          <div role="alert">
            <EmptyState
              icon={<CircleAlert />}
              title={`Couldn't load ${many}`}
              description={instruments.view.message}
              action={
                <Button icon={<RefreshCw />} onClick={instruments.retry}>
                  Retry
                </Button>
              }
            />
          </div>
        )}
        {list?.length === 0 && (
          <EmptyState
            icon={<SearchX />}
            title={`No ${many} available`}
            description="The data provider listed none."
          />
        )}
        {list !== null && list.length > 0 && rows.length === 0 && (
          <EmptyState
            icon={<SearchX />}
            title={`No ${many} match “${trimmed}”`}
            description="Try a different symbol or name."
            action={
              <Button
                onClick={() => {
                  onQueryChange('');
                }}
              >
                Clear filter
              </Button>
            }
          />
        )}
        {rows.length > 0 && (
          <DiscoverTable
            rows={rows}
            sort={sort}
            onSort={(column) => {
              onSortChange(nextSort(sort, column));
            }}
            pricesLoading={prices.status === 'loading'}
            volumeUnit={tab === 'crypto' ? 'coins' : 'shares'}
            caption={`${DISCOVER_TAB_LABELS[tab]}: ${count ?? ''}`}
          />
        )}
      </div>
    </>
  );
}

/** "Simulated · as of 14:05:09 ET" once the first prices arrive. */
function AsOf({ view }: { view: RequestView<Snapshots> }) {
  if (view.status !== 'ready' || view.receivedAt === null) return null;
  return (
    <span className="discover-toolbar__asof num">
      <SimulatedBadge title={SIMULATED_PRICES} />{' '}
      <span>as of {formatClock(view.receivedAt)} ET</span>
    </span>
  );
}

function Notice({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="discover-notice" role="alert">
      <CircleAlert aria-hidden="true" />
      <span className="discover-notice__text">{message}</span>
      <Button size="sm" variant="ghost" icon={<RefreshCw />} onClick={onRetry}>
        Retry
      </Button>
    </div>
  );
}

function TableSkeleton() {
  return (
    <div className="discover-skeleton" aria-hidden="true">
      {Array.from({ length: SKELETON_ROWS }, (_, i) => (
        <div key={i} className="discover-skeleton__row">
          <Skeleton width={56} height={12} />
          <Skeleton width="30%" height={10} />
          <span className="discover-toolbar__spacer" />
          <Skeleton width={64} height={12} />
          <Skeleton width={48} height={12} />
          <Skeleton width={72} height={16} />
        </div>
      ))}
    </div>
  );
}
