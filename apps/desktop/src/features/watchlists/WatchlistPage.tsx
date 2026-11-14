import { useCallback, useEffect, useRef, useState } from 'react';
import { PageHeader } from '../../components/ui/PageHeader';
import { useConnectionStore } from '../../data/connectionStore';
import { SimulatedBadge } from '../discover/SimulatedBadge';
import { MarketTable } from '../market/MarketTable';
import { SymbolSearch } from '../market/SymbolSearch';
import { WatchlistSummary } from './WatchlistSummary';
import { useWatchlistStore } from './watchlistStore';
import './watchlists.css';

const SIMULATED_PRICES = 'Prices come from a simulated feed. They are not real market data.';

/** The watchlist: a header with the add box, a summary strip, and the quote table. */
export function WatchlistPage() {
  const symbols = useWatchlistStore((s) => s.watchlist?.symbols);
  const simulated = useConnectionStore((s) => s.connection.simulated);
  const rootRef = useRef<HTMLDivElement>(null);
  // Bumped to move focus to the add box once the next render has placed it.
  const [addFocusRequest, setAddFocusRequest] = useState(0);

  useEffect(() => {
    if (addFocusRequest === 0) return;
    rootRef.current?.querySelector<HTMLInputElement>('[data-market-add] input')?.focus();
  }, [addFocusRequest]);

  const requestAdd = useCallback(() => {
    setAddFocusRequest((n) => n + 1);
  }, []);

  let description: string | undefined;
  if (symbols !== undefined) {
    const count = `${symbols.length} ${symbols.length === 1 ? 'symbol' : 'symbols'}`;
    description = symbols.length > 1 ? `${count} · drag rows to set your order` : count;
  }

  return (
    <div className="page watchlist-page" ref={rootRef}>
      <PageHeader
        title="Watchlist"
        meta={simulated && <SimulatedBadge title={SIMULATED_PRICES} />}
        description={description}
        actions={
          symbols === undefined ? undefined : (
            // ** One add box for every state, so text typed while the first symbol saves survives.
            <div className="watchlist-page__add" data-market-add="">
              <SymbolSearch variant="add" />
            </div>
          )
        }
      />
      {symbols !== undefined && symbols.length > 0 && <WatchlistSummary symbols={symbols} />}
      <MarketTable onRequestAdd={requestAdd} />
    </div>
  );
}
