import { CircleAlert, List, ListPlus, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useUiStore } from '../../app/uiStore';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { EmptyState } from '../../components/ui/EmptyState';
import { Skeleton } from '../../components/ui/Skeleton';
import { useConnectionStore } from '../../data/connectionStore';
import type { Watchlist } from '../../domain/types';
import { useActiveWatchlist, useWatchlistStore } from '../watchlists/watchlistStore';
import { ConnectionNotice } from './ConnectionNotice';
import { moveSymbol, navigationTarget, neighborAfterRemoval } from './marketModel';
import { MarketRow, type MarketRowActions } from './MarketRow';
import { SymbolSearch } from './SymbolSearch';
import './market.css';

const SKELETON_ROWS = 8;

function reloadWatchlists(): void {
  void useWatchlistStore.getState().load();
}

/**
 * Quotes for the active watchlist, with loading, error and empty states. Rows are keyed by symbol
 * and each reads its own quote, so a tick re-renders only the row it belongs to.
 */
export function MarketTable() {
  const status = useWatchlistStore((s) => s.status);
  const error = useWatchlistStore((s) => s.error);
  const hasWatchlists = useWatchlistStore((s) => s.watchlists.length > 0);
  const watchlist = useActiveWatchlist();

  if (watchlist) {
    return <WatchlistQuotes key={watchlist.id} watchlist={watchlist} refreshError={status === 'error' ? error : null} />;
  }
  if (status === 'idle' || status === 'loading') return <LoadingQuotes />;

  return (
    <div className="market">
      <MarketHeader title="Market" />
      <div className="market__body market__body--center">
        {status === 'error' ? (
          <div role="alert">
            <EmptyState
              icon={<CircleAlert />}
              title="Couldn't load watchlists"
              description={error ?? 'Something went wrong.'}
              action={
                <Button icon={<RefreshCw />} onClick={reloadWatchlists}>
                  Retry
                </Button>
              }
            />
          </div>
        ) : (
          <EmptyState
            icon={<List />}
            title={hasWatchlists ? 'No watchlist selected' : 'No watchlists yet'}
            description={
              hasWatchlists
                ? 'Choose a watchlist in the sidebar to see its quotes.'
                : 'Create a watchlist in the sidebar to start monitoring symbols.'
            }
          />
        )}
      </div>
    </div>
  );
}

interface MarketHeaderProps {
  title: ReactNode;
  meta?: string;
  children?: ReactNode;
}

function MarketHeader({ title, meta, children }: MarketHeaderProps) {
  const simulated = useConnectionStore((s) => s.connection.simulated);
  return (
    <div className="market__header">
      <div className="market__heading">
        <h2 className="market__title">{title}</h2>
        {meta !== undefined && <span className="market__meta">{meta}</span>}
        {simulated && (
          <Badge tone="warning" size="sm" title="Prices come from a simulated feed. They are not real market data.">
            Simulated
          </Badge>
        )}
      </div>
      {children}
    </div>
  );
}

function QuoteTableHead() {
  return (
    <thead>
      <tr>
        <th scope="col">Symbol</th>
        <th scope="col" className="is-num market-col--last">
          Last
        </th>
        <th scope="col" className="is-num market-col--change">
          Change
        </th>
        <th scope="col" className="is-num market-col--pct">
          Change %
        </th>
        <th scope="col" className="is-num market-col--bid">
          Bid
        </th>
        <th scope="col" className="is-num market-col--ask">
          Ask
        </th>
        <th scope="col" className="is-num market-col--volume">
          Volume
        </th>
        <th scope="col" className="market-col--status">
          Status
        </th>
        <th scope="col" className="is-num market-col--updated">
          Updated
        </th>
        <th scope="col" className="market-col--actions">
          <span className="visually-hidden">Actions</span>
        </th>
      </tr>
    </thead>
  );
}

const SKELETON_CELLS: readonly { className?: string; width: number | string }[] = [
  { width: '60%' },
  { className: 'is-num', width: 52 },
  { className: 'is-num', width: 44 },
  { className: 'is-num', width: 52 },
  { className: 'is-num market-col--bid', width: 48 },
  { className: 'is-num market-col--ask', width: 48 },
  { className: 'is-num market-col--volume', width: 40 },
  { width: 56 },
  { className: 'is-num market-col--updated', width: 40 },
  { width: 0 },
];

function LoadingQuotes() {
  return (
    <div className="market">
      <MarketHeader
        title={
          <>
            <span className="visually-hidden">Loading watchlist</span>
            <Skeleton width={120} height={14} />
          </>
        }
      />
      <div className="market__body">
        <span role="status" className="visually-hidden">
          Loading watchlists…
        </span>
        <table className="ui-table market-table" aria-label="Quotes" aria-busy="true">
          <QuoteTableHead />
          <tbody>
            {Array.from({ length: SKELETON_ROWS }, (_, row) => (
              <tr key={row} className="market-skeleton-row">
                {SKELETON_CELLS.map((cell, column) => (
                  <td key={column} className={cell.className}>
                    {cell.width !== 0 && <Skeleton width={cell.width} height={10} />}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

interface WatchlistQuotesProps {
  watchlist: Watchlist;
  /** Set when a reload failed but the previously loaded watchlists are still shown. */
  refreshError: string | null;
}

function WatchlistQuotes({ watchlist, refreshError }: WatchlistQuotesProps) {
  const { id: watchlistId, name, symbols } = watchlist;
  const selectedSymbol = useUiStore((s) => s.selectedSymbol);
  const rootRef = useRef<HTMLDivElement>(null);
  // Bumped to move focus to the add box once the next render has placed it (header or empty state).
  const [addFocusRequest, setAddFocusRequest] = useState(0);

  useEffect(() => {
    if (addFocusRequest === 0) return;
    rootRef.current?.querySelector<HTMLInputElement>('[data-market-add] input')?.focus();
  }, [addFocusRequest]);

  const focusRow = useCallback((symbol: string) => {
    rootRef.current?.querySelector<HTMLElement>(`tr[data-symbol="${symbol}"]`)?.focus();
  }, []);

  const actions = useMemo<MarketRowActions>(() => {
    // ** Read the symbols when an action runs, so the callbacks stay stable while the list changes.
    const currentSymbols = () =>
      useWatchlistStore.getState().watchlists.find((w) => w.id === watchlistId)?.symbols ?? [];
    return {
      select: (symbol) => {
        useUiStore.getState().selectSymbol(symbol);
      },
      navigate: (from, key, fromIsSelected) => {
        const target = navigationTarget(currentSymbols(), from, key, fromIsSelected);
        if (target === null) return;
        useUiStore.getState().selectSymbol(target);
        focusRow(target);
      },
      move: (symbol, delta) => {
        const next = moveSymbol(currentSymbols(), symbol, delta);
        if (next) void useWatchlistStore.getState().reorder(watchlistId, next);
      },
      remove: (symbol) => {
        const neighbor = neighborAfterRemoval(currentSymbols(), symbol);
        void useWatchlistStore.getState().removeSymbol(watchlistId, symbol);
        // Keep keyboard focus in the table instead of losing it with the removed row.
        if (neighbor !== null) focusRow(neighbor);
        else setAddFocusRequest((n) => n + 1);
      },
      createAlert: (symbol) => {
        useUiStore.getState().openCreateAlert(symbol);
      },
    };
  }, [watchlistId, focusRow]);

  const isEmpty = symbols.length === 0;
  const tabbableSymbol = selectedSymbol !== null && symbols.includes(selectedSymbol) ? selectedSymbol : symbols[0];

  return (
    <div className="market" ref={rootRef}>
      <MarketHeader title={name} meta={`${symbols.length} ${symbols.length === 1 ? 'symbol' : 'symbols'}`}>
        {/* ** One add box for every state, so text typed while the first symbol saves survives. */}
        <div className="market__add" data-market-add="">
          <SymbolSearch variant="add" watchlistId={watchlistId} />
        </div>
      </MarketHeader>
      {refreshError !== null && (
        <div className="market-notice market-notice--error" role="alert">
          <CircleAlert aria-hidden="true" />
          <span className="market-notice__title">Couldn't refresh watchlists.</span>
          <span className="market-notice__detail">{refreshError}</span>
          <Button size="sm" variant="ghost" className="market-notice__action" onClick={reloadWatchlists}>
            Retry
          </Button>
        </div>
      )}
      {!isEmpty && <ConnectionNotice />}
      {isEmpty ? (
        <div className="market__body market__body--center">
          <EmptyState
            icon={<ListPlus />}
            title={`${name} is empty`}
            description="Use the add box above to start monitoring a symbol's simulated quotes."
            action={
              <Button
                variant="secondary"
                onClick={() => {
                  setAddFocusRequest((n) => n + 1);
                }}
              >
                Add a symbol
              </Button>
            }
          />
        </div>
      ) : (
        <div className="market__body">
          <table className="ui-table market-table" role="grid" aria-label={`Quotes in ${name}`} aria-readonly="true">
            <QuoteTableHead />
            <tbody>
              {symbols.map((symbol, index) => (
                <MarketRow
                  key={symbol}
                  symbol={symbol}
                  selected={symbol === selectedSymbol}
                  tabbable={symbol === tabbableSymbol}
                  canMoveUp={index > 0}
                  canMoveDown={index < symbols.length - 1}
                  actions={actions}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
