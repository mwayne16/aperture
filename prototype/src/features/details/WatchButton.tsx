import { Star } from 'lucide-react';
import { useState } from 'react';
import { Button } from '../../components/ui/Button';
import { cx } from '../../components/ui/cx';
import { showToast } from '../../components/ui/toastStore';
import { Tooltip } from '../../components/ui/Tooltip';
import { useWatchlistStore } from '../watchlists/watchlistStore';
import { watchView } from './watchToggle';
import './stockPage.css';

function messageOf(error: unknown): string {
  return error instanceof Error && error.message !== '' ? error.message : 'Something went wrong. Try again.';
}

/**
 * Star toggle that adds the symbol to the watchlist or removes it. While the list is loading, or when
 * it is full, the button stays focusable but inert and the tooltip says why.
 */
export function WatchButton({ symbol }: { symbol: string }) {
  const status = useWatchlistStore((s) => s.status);
  const list = useWatchlistStore((s) => s.watchlist);
  const [adding, setAdding] = useState(false);
  const view = watchView(status, list, symbol);
  const unavailable = view.action === null;

  const toggle = async () => {
    if (!list || unavailable || adding) return;
    if (view.action === 'remove') {
      // Removal is optimistic; the store restores the symbol and reports a failure itself.
      void useWatchlistStore.getState().removeSymbol(symbol);
      return;
    }
    setAdding(true);
    try {
      await useWatchlistStore.getState().addSymbol(symbol);
    } catch (error) {
      showToast({ tone: 'error', title: `Couldn't add ${symbol} to your watchlist`, description: messageOf(error) });
    } finally {
      setAdding(false);
    }
  };

  return (
    <Tooltip content={view.hint}>
      <Button
        icon={<Star fill={view.watching ? 'currentColor' : 'none'} />}
        loading={adding}
        // ** aria-disabled rather than disabled keeps the button focusable, so the tooltip can explain why.
        aria-disabled={unavailable || undefined}
        className={cx('stock-watch', view.watching && 'is-watching', unavailable && 'is-unavailable')}
        onClick={() => {
          void toggle();
        }}
      >
        {view.label}
      </Button>
    </Tooltip>
  );
}
