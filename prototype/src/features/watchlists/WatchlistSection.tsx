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
import { useWatchlistStore, useWatchlistSymbols } from './watchlistStore';
import './watchlists.css';

const SYMBOL_PATH = /^\/symbol\/([^/]+)$/;

/**
 * The sidebar's watchlist: every watched symbol with its live change, linking to its page. Up/Down,
 * Home and End move between symbols and Delete removes one. The + button adds a symbol.
 */
export function WatchlistSection() {
  const status = useWatchlistStore((s) => s.status);
  const loaded = useWatchlistStore((s) => s.watchlist !== null);
  const symbols = useWatchlistSymbols();
  const [open, setOpen] = useState(true);
  const [adding, setAdding] = useState(false);
  const [focusSymbol, setFocusSymbol] = useState<string | null>(null);
  const listRef = useRef<HTMLUListElement>(null);
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

  const onListKeyDown = (event: KeyboardEvent<HTMLUListElement>) => {
    const symbol = (event.target as HTMLElement).dataset.watchSymbol;
    if (symbol === undefined) return;
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

/** One watched symbol. It reads its own quote, so a tick re-renders only this row. */
function WatchRow({ symbol, current, tabbable, onFocus, onRemove }: WatchRowProps) {
  const quote = useQuote(symbol);
  const live = quote?.status === 'live' || quote?.status === 'delayed';
  const direction = live ? changeDirection(quote.changePct) : 0;
  const tone = direction > 0 ? 'gain' : direction < 0 ? 'loss' : 'muted';
  return (
    <li className={cx('watch-row', current && 'is-current')}>
      <Link
        href={paths.symbol(symbol)}
        className="watch-row__link"
        data-watch-symbol={symbol}
        aria-current={current ? 'page' : undefined}
        aria-keyshortcuts="Delete"
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
