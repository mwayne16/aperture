import { Star } from 'lucide-react';
import { useState } from 'react';
import { cx } from '../../components/ui/cx';
import { showToast } from '../../components/ui/toastStore';
import { Tooltip } from '../../components/ui/Tooltip';
import { isApiError } from '../../data/api';
import { useActiveWatchlist, useWatchlistStore } from '../watchlists/watchlistStore';
import { watchToggleView } from './discoverModel';

/**
 * Star that adds `symbol` to the active watchlist or removes it. When it can't act (no list, list
 * full) it stays focusable with aria-disabled, so the tooltip can still say why.
 */
export function WatchToggle({ symbol }: { symbol: string }) {
  const watchlist = useActiveWatchlist();
  const status = useWatchlistStore((s) => s.status);
  const [adding, setAdding] = useState(false);
  const load = status === 'ready' ? 'ready' : status === 'error' ? 'error' : 'loading';
  const view = watchToggleView(watchlist, symbol, load);
  // ** Adds wait for the server before the list changes, so the star fills while the add is in flight.
  const watching = view.watching || adding;

  const toggle = () => {
    if (view.disabled || watchlist === null || adding) return;
    const store = useWatchlistStore.getState();
    if (view.watching) {
      void store.removeSymbol(watchlist.id, symbol);
      return;
    }
    setAdding(true);
    store
      .addSymbol(watchlist.id, symbol)
      .catch((error: unknown) => {
        showToast({
          tone: 'error',
          title: `Couldn't add ${symbol} to “${watchlist.name}”`,
          description: isApiError(error) ? error.message : 'Something went wrong. Try again.',
        });
      })
      .finally(() => {
        setAdding(false);
      });
  };

  return (
    <Tooltip content={view.hint}>
      <button
        type="button"
        className={cx('discover-star', watching && 'is-on')}
        aria-label={`Watch ${symbol}`}
        aria-pressed={watching}
        aria-disabled={view.disabled || undefined}
        aria-busy={adding || undefined}
        onClick={toggle}
      >
        <Star aria-hidden="true" />
      </button>
    </Tooltip>
  );
}
