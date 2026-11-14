import { closestCenter, DndContext, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { arrayMove, SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CircleAlert, ListPlus, RefreshCw } from 'lucide-react';
import { useCallback, useMemo, useRef, useState } from 'react';
import { useLocation } from 'wouter';
import { paths } from '../../app/routes';
import { useUiStore } from '../../app/uiStore';
import { Button } from '../../components/ui/Button';
import { EmptyState } from '../../components/ui/EmptyState';
import { Skeleton } from '../../components/ui/Skeleton';
import { useConnectionStore } from '../../data/connectionStore';
import { useQuotes } from '../../data/quoteStore';
import type { Watchlist } from '../../domain/types';
import { formatClock } from '../../lib/format';
import { nextListIndex } from '../watchlists/listNavigation';
import { useDragClickGuard } from '../watchlists/useDragClickGuard';
import { newestDataTime } from '../watchlists/summaryModel';
import { useWatchlistStore } from '../watchlists/watchlistStore';
import { ConnectionNotice } from './ConnectionNotice';
import { moveSymbol, neighborAfterRemoval } from './marketModel';
import { MarketRow, type MarketRowActions } from './MarketRow';
import './market.css';

const SKELETON_ROWS = 8;
/** Pointer travel before a press on a handle becomes a drag. */
const DRAG_THRESHOLD_PX = 4;

function reloadWatchlist(): void {
  void useWatchlistStore.getState().load();
}

interface MarketTableProps {
  /** Moves focus to the page's add box, for the empty state and after the last symbol is removed. */
  onRequestAdd: () => void;
}

/**
 * The watchlist's quote table in a card, with loading, error and empty states. Rows are keyed by
 * symbol and each reads its own quote, so a tick re-renders only the row it belongs to.
 */
export function MarketTable({ onRequestAdd }: MarketTableProps) {
  const status = useWatchlistStore((s) => s.status);
  const error = useWatchlistStore((s) => s.error);
  const watchlist = useWatchlistStore((s) => s.watchlist);

  if (watchlist) {
    return (
      <WatchlistQuotes
        watchlist={watchlist}
        refreshError={status === 'error' ? error : null}
        onRequestAdd={onRequestAdd}
      />
    );
  }
  if (status !== 'error') return <LoadingQuotes />;

  return (
    <section className="market-card" aria-label="Watchlist quotes">
      <div className="market-card__center" role="alert">
        <EmptyState
          icon={<CircleAlert />}
          title="Couldn't load your watchlist"
          description={error ?? 'Something went wrong.'}
          action={
            <Button icon={<RefreshCw />} onClick={reloadWatchlist}>
              Retry
            </Button>
          }
        />
      </div>
    </section>
  );
}

function QuoteTableHead() {
  return (
    <thead>
      <tr>
        <th scope="col" className="market-col--grip">
          <span className="visually-hidden">Order</span>
        </th>
        <th scope="col">Symbol</th>
        <th scope="col" className="is-num market-col--last">
          Last
        </th>
        <th scope="col" className="is-num market-col--change">
          Change
        </th>
        <th scope="col" className="is-num market-col--pct">
          Chg %
        </th>
        <th scope="col" className="market-col--range">
          Day range
        </th>
        <th scope="col" className="market-col--trend">
          1D
        </th>
        <th scope="col" className="is-num market-col--volume">
          Volume
        </th>
        <th scope="col" className="market-col--status">
          Status
        </th>
        <th scope="col" className="market-col--actions">
          <span className="visually-hidden">Actions</span>
        </th>
      </tr>
    </thead>
  );
}

const SKELETON_CELLS: readonly { className?: string; width: number | string }[] = [
  { width: 0 },
  { width: '50%' },
  { className: 'is-num', width: 56 },
  { className: 'is-num market-col--change', width: 44 },
  { className: 'is-num', width: 56 },
  { className: 'market-col--range', width: 120 },
  { className: 'market-col--trend', width: 96 },
  { className: 'is-num market-col--volume', width: 40 },
  { className: 'market-col--status', width: 56 },
  { width: 0 },
];

function LoadingQuotes() {
  return (
    <section className="market-card" aria-label="Watchlist quotes">
      <span role="status" className="visually-hidden">
        Loading your watchlist…
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
    </section>
  );
}

interface WatchlistQuotesProps {
  watchlist: Watchlist;
  /** Set when a reload failed but the previously loaded watchlist is still shown. */
  refreshError: string | null;
  onRequestAdd: () => void;
}

function WatchlistQuotes({ watchlist, refreshError, onRequestAdd }: WatchlistQuotesProps) {
  const { symbols } = watchlist;
  const [, navigate] = useLocation();
  const [focusSymbol, setFocusSymbol] = useState<string | null>(null);
  const tbodyRef = useRef<HTMLTableSectionElement>(null);
  const dragClickGuard = useDragClickGuard();
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: DRAG_THRESHOLD_PX } }));

  const focusRow = useCallback((symbol: string) => {
    tbodyRef.current?.querySelector<HTMLElement>(`tr[data-symbol="${CSS.escape(symbol)}"]`)?.focus();
  }, []);

  const actions = useMemo<MarketRowActions>(() => {
    // ** Read the symbols when an action runs, so the callbacks stay stable while the list changes.
    const currentSymbols = () => useWatchlistStore.getState().watchlist?.symbols ?? [];
    return {
      open: (symbol) => {
        navigate(paths.symbol(symbol));
      },
      focus: setFocusSymbol,
      navigate: (from, key) => {
        const list = currentSymbols();
        const next = nextListIndex(key, list.indexOf(from), list.length);
        const target = next === null ? undefined : list[next];
        if (target !== undefined) focusRow(target);
      },
      move: (symbol, delta) => {
        const next = moveSymbol(currentSymbols(), symbol, delta);
        if (next) void useWatchlistStore.getState().reorder(next);
      },
      remove: (symbol) => {
        const neighbor = neighborAfterRemoval(currentSymbols(), symbol);
        void useWatchlistStore.getState().removeSymbol(symbol);
        // Keep keyboard focus in the table instead of losing it with the removed row.
        if (neighbor !== null) focusRow(neighbor);
        else onRequestAdd();
      },
      createAlert: (symbol) => {
        useUiStore.getState().openCreateAlert(symbol);
      },
    };
  }, [navigate, focusRow, onRequestAdd]);

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    dragClickGuard.onDragEnd();
    if (!over || active.id === over.id) return;
    const from = symbols.indexOf(String(active.id));
    const to = symbols.indexOf(String(over.id));
    if (from !== -1 && to !== -1) void useWatchlistStore.getState().reorder(arrayMove([...symbols], from, to));
  };

  if (symbols.length === 0) {
    return (
      <section className="market-card" aria-label="Watchlist quotes">
        {refreshError !== null && <RefreshError error={refreshError} />}
        <div className="market-card__center">
          <EmptyState
            icon={<ListPlus />}
            title="Your watchlist is empty"
            description="Use the add box above, or star symbols on Discover, to start monitoring their simulated quotes."
            action={
              <Button variant="secondary" onClick={onRequestAdd}>
                Add a symbol
              </Button>
            }
          />
        </div>
      </section>
    );
  }

  // ** One row holds the table's Tab stop: the last one focused while it is still listed, else the first.
  const tabStop = focusSymbol !== null && symbols.includes(focusSymbol) ? focusSymbol : symbols[0];

  return (
    <section className="market-card" aria-label="Watchlist quotes">
      {refreshError !== null && <RefreshError error={refreshError} />}
      <ConnectionNotice />
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={onDragEnd}
        onDragCancel={dragClickGuard.onDragCancel}
      >
        <table className="ui-table market-table" role="grid" aria-label="Quotes in your watchlist" aria-readonly="true">
          <QuoteTableHead />
          <SortableContext items={[...symbols]} strategy={verticalListSortingStrategy}>
            <tbody ref={tbodyRef}>
              {symbols.map((symbol, index) => (
                <MarketRow
                  key={symbol}
                  symbol={symbol}
                  tabbable={symbol === tabStop}
                  canMoveUp={index > 0}
                  canMoveDown={index < symbols.length - 1}
                  actions={actions}
                />
              ))}
            </tbody>
          </SortableContext>
        </table>
      </DndContext>
      <div className="market-card__footer">
        <span>Click a row to open its page</span>
        <QuotesAsOf symbols={symbols} />
      </div>
    </section>
  );
}

function RefreshError({ error }: { error: string }) {
  return (
    <div className="market-notice market-notice--error" role="alert">
      <CircleAlert aria-hidden="true" />
      <span className="market-notice__title">Couldn't refresh your watchlist.</span>
      <span className="market-notice__detail">{error}</span>
      <Button size="sm" variant="ghost" className="market-notice__action" onClick={reloadWatchlist}>
        Retry
      </Button>
    </div>
  );
}

/** Where the quotes come from and the time of the newest one. */
function QuotesAsOf({ symbols }: { symbols: readonly string[] }) {
  const simulated = useConnectionStore((s) => s.connection.simulated);
  const asOf = newestDataTime(useQuotes(symbols));
  const source = simulated ? 'Simulated quotes' : 'IEX quotes';
  return (
    <span className="num">
      {asOf === null ? source : `${source} · as of ${formatClock(asOf)} ET`}
    </span>
  );
}
