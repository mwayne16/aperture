import { useEffect } from 'react';
import { Redirect, useParams } from 'wouter';
import { decodeParam, paths } from '../../app/routes';
import { StockDetail } from '../details/StockDetail';
import { MarketTable } from '../market/MarketTable';
import { useWatchlistStore } from './watchlistStore';
import './watchlists.css';

/**
 * One watchlist's quote table beside a quick view of the selected symbol. The list in the URL
 * becomes the active one; a missing or deleted id redirects to the active list.
 */
export function WatchlistPage() {
  const params = useParams<{ id?: string }>();
  const id = decodeParam(params.id);
  const status = useWatchlistStore((s) => s.status);
  const exists = useWatchlistStore((s) => id !== null && s.watchlists.some((w) => w.id === id));
  const activeId = useWatchlistStore((s) => s.activeId);

  useEffect(() => {
    if (exists && id !== null) useWatchlistStore.getState().setActive(id);
  }, [exists, id]);

  if (status === 'ready' && !exists && activeId !== null) {
    return <Redirect to={paths.watchlist(activeId)} replace />;
  }

  return (
    <div className="watchlist-page">
      <section className="watchlist-page__market" aria-label="Market">
        <MarketTable />
      </section>
      <section className="watchlist-page__detail" aria-label="Stock details">
        <StockDetail expandable />
      </section>
    </div>
  );
}
