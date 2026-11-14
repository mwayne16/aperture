import { closestCenter, DndContext, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { arrayMove, SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { ChevronDown, Plus, RotateCw, X } from 'lucide-react';
import { useId, useRef, useState, type KeyboardEvent } from 'react';
import { Link, useLocation } from 'wouter';
import { decodeParam, paths } from '../../app/routes';
import { Button } from '../../components/ui/Button';
import { cx } from '../../components/ui/cx';
import { Dialog } from '../../components/ui/Dialog';
import { IconButton } from '../../components/ui/IconButton';
import { Skeleton } from '../../components/ui/Skeleton';
import { useQuote } from '../../data/quoteStore';
import { changeDirection, formatPercent } from '../../lib/format';
import { SymbolSearch } from '../market/SymbolSearch';
import { nextListIndex } from './listNavigation';
import { useDragClickGuard } from './useDragClickGuard';
import { useWatchlistStore, useWatchlistSymbols } from './watchlistStore';
import './watchlists.css';

const SYMBOL_PATH = /^\/symbol\/([^/]+)$/;

/** Pointer travel before a press becomes a drag, so a plain click still opens the symbol. */
const DRAG_THRESHOLD_PX = 4;

/**
 * The sidebar's watchlist: every watched symbol with its live change, linking to its page. Rows can
 * be dragged to reorder them. Up/Down, Home and End move between symbols, Alt+Up/Down moves the
 * focused symbol, and Delete removes one. The + button adds a symbol.
 */
export function WatchlistSection() {
  const status = useWatchlistStore((s) => s.status);
  const loaded = useWatchlistStore((s) => s.watchlist !== null);
  const symbols = useWatchlistSymbols();
  const [open, setOpen] = useState(true);
  const [adding, setAdding] = useState(false);
  const [focusSymbol, setFocusSymbol] = useState<string | null>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const dragClickGuard = useDragClickGuard();
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: DRAG_THRESHOLD_PX } }));
  const headingId = useId();
  const listId = useId();
  const [location] = useLocation();
  const currentSymbol = decodeParam(SYMBOL_PATH.exec(location)?.[1]);

  // ** One row holds the list's Tab stop: the last one focused while it is still listed, else the first.
  const tabStop = focusSymbol !== null && symbols.includes(focusSymbol) ? focusSymbol : symbols[0];

  const focusRow = (symbol: string | undefined) => {
    if (symbol === undefined) return;
    listRef.current?.querySelector<HTMLElement>(`[data-watch-symbol="${CSS.escape(symbol)}"]`)?.focus();
  };

  const remove = (symbol: string) => {
    const index = symbols.indexOf(symbol);
    const neighbor = symbols[index + 1] ?? symbols[index - 1];
    void useWatchlistStore.getState().removeSymbol(symbol);
    // Keep keyboard focus in the list instead of losing it with the removed row.
    if (neighbor !== undefined) {
      setFocusSymbol(neighbor);
      focusRow(neighbor);
    }
  };

  /** Moves `symbol` to position `to`, ignoring moves past either end. */
  const move = (symbol: string, to: number) => {
    const from = symbols.indexOf(symbol);
    if (from === -1 || to < 0 || to >= symbols.length || from === to) return;
    void useWatchlistStore.getState().reorder(arrayMove([...symbols], from, to));
  };

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    dragClickGuard.onDragEnd();
    if (over && active.id !== over.id) move(String(active.id), symbols.indexOf(String(over.id)));
  };

  const onListKeyDown = (event: KeyboardEvent<HTMLUListElement>) => {
    const symbol = (event.target as HTMLElement).dataset.watchSymbol;
    if (symbol === undefined) return;
    if (event.altKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
      event.preventDefault();
      // ** Rows are keyed by symbol, so the focused link moves with its row and keeps focus.
      move(symbol, symbols.indexOf(symbol) + (event.key === 'ArrowUp' ? -1 : 1));
      return;
    }
    if (event.key === 'Delete') {
      event.preventDefault();
      remove(symbol);
      return;
    }
    const next = nextListIndex(event.key, symbols.indexOf(symbol), symbols.length);
    if (next === null) return;
    event.preventDefault();
    focusRow(symbols[next]);
  };

  let body;
  if (!loaded && status === 'error') {
    body = (
      <div className="watch-section__message" role="alert">
        <p>Couldn&apos;t load your watchlist.</p>
        <Button
          size="sm"
          variant="ghost"
          icon={<RotateCw />}
          onClick={() => {
            void useWatchlistStore.getState().load({ force: true });
          }}
        >
          Retry
        </Button>
      </div>
    );
  } else if (!loaded) {
    body = (
      <div className="watch-section__skeleton" aria-hidden="true">
        {[64, 52, 70, 58].map((width) => (
          <Skeleton key={width} width={`${width}%`} height={12} />
        ))}
      </div>
    );
  } else if (symbols.length === 0) {
    body = (
      <div className="watch-section__message">
        <p>No symbols yet. Add one here or star symbols on Discover.</p>
      </div>
    );
  } else {
    body = (
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={onDragEnd}
        onDragCancel={dragClickGuard.onDragCancel}
      >
        <SortableContext items={[...symbols]} strategy={verticalListSortingStrategy}>
          <ul id={listId} ref={listRef} className="watch-list" aria-labelledby={headingId} onKeyDown={onListKeyDown}>
            {symbols.map((symbol) => (
              <WatchRow
                key={symbol}
                symbol={symbol}
                current={symbol === currentSymbol}
                tabbable={symbol === tabStop}
                onFocus={setFocusSymbol}
                onRemove={remove}
              />
            ))}
          </ul>
        </SortableContext>
      </DndContext>
    );
  }

  return (
    <div className="watch-section">
      <div className="watch-section__header">
        <button
          type="button"
          className="watch-section__toggle"
          aria-expanded={open}
          aria-controls={listId}
          onClick={() => {
            setOpen((value) => !value);
          }}
        >
          <ChevronDown className={cx('watch-section__chevron', !open && 'is-collapsed')} aria-hidden="true" />
          <h2 id={headingId} className="watch-section__title">
            Watchlist
          </h2>
        </button>
        <IconButton
          label="Add a symbol to your watchlist"
          icon={<Plus />}
          size="sm"
          variant="ghost"
          disabled={!loaded}
          onClick={() => {
            setAdding(true);
          }}
        />
      </div>
      {open && <div className="watch-section__body">{body}</div>}
      <Dialog
        open={adding}
        onClose={() => {
          setAdding(false);
        }}
        title="Add to watchlist"
        description="Search by symbol or company name."
        width={420}
      >
        <SymbolSearch
          variant="add"
          autoFocus
          onDone={() => {
            setAdding(false);
          }}
        />
      </Dialog>
    </div>
  );
}

interface WatchRowProps {
  symbol: string;
  /** The symbol's page is open. */
  current: boolean;
  /** Whether this row holds the list's single Tab stop. */
  tabbable: boolean;
  onFocus: (symbol: string) => void;
  onRemove: (symbol: string) => void;
}

/** One watched symbol, draggable to reorder. It reads its own quote, so a tick re-renders only this row. */
function WatchRow({ symbol, current, tabbable, onFocus, onRemove }: WatchRowProps) {
  const { setNodeRef, listeners, transform, transition, isDragging } = useSortable({ id: symbol });
  const quote = useQuote(symbol);
  const live = quote?.status === 'live' || quote?.status === 'delayed';
  const direction = live ? changeDirection(quote.changePct) : 0;
  const tone = direction > 0 ? 'gain' : direction < 0 ? 'loss' : 'muted';
  return (
    <li
      ref={setNodeRef}
      className={cx('watch-row', current && 'is-current', isDragging && 'is-dragging')}
      // ** Only the vertical offset applies, so a dragged row stays inside the sidebar.
      style={{ transform: transform ? `translate3d(0, ${Math.round(transform.y)}px, 0)` : undefined, transition }}
      {...listeners}
    >
      <Link
        href={paths.symbol(symbol)}
        className="watch-row__link"
        data-watch-symbol={symbol}
        aria-current={current ? 'page' : undefined}
        aria-keyshortcuts="Delete Alt+ArrowUp Alt+ArrowDown"
        tabIndex={tabbable ? 0 : -1}
        onFocus={() => {
          onFocus(symbol);
        }}
      >
        <span className="watch-row__badge" aria-hidden="true">
          {symbol.charAt(0)}
        </span>
        <span className="watch-row__symbol">{symbol}</span>
        <span className={cx('watch-row__change num', `is-${tone}`)}>{formatPercent(quote?.changePct)}</span>
      </Link>
      <IconButton
        className="watch-row__remove"
        label={`Remove ${symbol} from your watchlist`}
        icon={<X />}
        size="sm"
        variant="ghost"
        tabIndex={-1}
        onClick={() => {
          onRemove(symbol);
        }}
      />
    </li>
  );
}
