import { Check, Plus, Search } from 'lucide-react';
import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
} from 'react';
import { createPortal } from 'react-dom';
import { useUiStore } from '../../app/uiStore';
import { cx } from '../../components/ui/cx';
import { Kbd } from '../../components/ui/Kbd';
import { Spinner } from '../../components/ui/Spinner';
import { TextInput } from '../../components/ui/TextInput';
import { showToast } from '../../components/ui/toastStore';
import { isApiError } from '../../data/api';
import { validateSymbol, validateSymbolForWatchlist } from '../../domain/symbols';
import type { Watchlist } from '../../domain/types';
import { useActiveWatchlist, useWatchlistStore } from '../watchlists/watchlistStore';
import { revealElement } from './reveal';
import {
  buildOptions,
  defaultActiveIndex,
  optionKey,
  stepActiveIndex,
  type SearchOption,
} from './symbolSearchModel';
import { useInstrumentSearch } from './useInstrumentSearch';
import './market.css';

export interface SymbolSearchProps {
  /**
   * 'global': top-bar search; Enter/click selects the symbol for the detail panel, with a secondary
   * action to add it to the active watchlist.
   * 'add': watchlist add box; Enter/click adds the symbol to `watchlistId`, showing validation errors inline.
   */
  variant: 'global' | 'add';
  watchlistId?: string;
  autoFocus?: boolean;
  /** Called after a successful select/add, e.g. to close a popover. */
  onDone?: () => void;
}

type Intent = 'primary' | 'add';

const POPUP_MIN_WIDTH = 320;
const VIEWPORT_MARGIN = 8;

/** The watchlist an add goes to, read at the moment of the add so it is never out of date. */
function addTarget(variant: 'global' | 'add', watchlistId: string | undefined): Watchlist | null {
  const { watchlists, activeId } = useWatchlistStore.getState();
  const id = variant === 'add' ? watchlistId : activeId;
  return watchlists.find((w) => w.id === id) ?? null;
}

function optionLabel(option: SearchOption, listName: string | null, inList: boolean): string {
  if (option.kind === 'typed') return `Add ${option.symbol} as typed, not in the instrument list`;
  const { symbol, name, exchange } = option.instrument;
  return inList && listName !== null ? `${symbol}, ${name}, ${exchange}, in ${listName}` : `${symbol}, ${name}, ${exchange}`;
}

/**
 * Symbol combobox. Typing searches instruments after a short pause; Up/Down move the highlight,
 * Enter picks it, Escape closes the list and a second Escape clears the text. Focus stays in the
 * input throughout, with the highlighted option exposed through aria-activedescendant.
 */
export function SymbolSearch({ variant, watchlistId, autoFocus = false, onDone }: SymbolSearchProps) {
  const id = useId();
  const listboxId = `${id}listbox`;
  const hintId = `${id}hint`;
  const errorId = `${id}error`;
  const optionId = (index: number) => `${id}option-${index}`;

  const inputRef = useRef<HTMLInputElement>(null);
  const anchorRef = useRef<HTMLDivElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const busyRef = useRef(false);
  const enterPendingRef = useRef(false);

  const [query, setQuery] = useState('');
  const [focused, setFocused] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  /** Option the user moved the highlight to. Null follows the default for the current results. */
  const [chosenKey, setChosenKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const activeWatchlist = useActiveWatchlist();
  const namedWatchlist = useWatchlistStore((s) => s.watchlists.find((w) => w.id === watchlistId) ?? null);
  const target = variant === 'add' ? namedWatchlist : activeWatchlist;

  const search = useInstrumentSearch(query);
  const term = query.trim();
  const settled = search.status === 'ready' || search.status === 'error';
  const options = useMemo(
    () => buildOptions(variant, term, search.results, settled),
    [variant, term, search.results, settled],
  );
  const chosenIndex = chosenKey === null ? -1 : options.findIndex((o) => optionKey(o) === chosenKey);
  const activeIndex = chosenIndex >= 0 ? chosenIndex : defaultActiveIndex(options, term);
  const active = options[activeIndex];

  const open = focused && !dismissed && term !== '';
  const listVisible = open && options.length > 0;

  // The global search takes focus when Ctrl+K asks for it, but never just because it mounted.
  const focusRequest = useUiStore((s) => s.searchFocusRequest);
  const seenFocusRequest = useRef(focusRequest);
  useEffect(() => {
    if (variant !== 'global' || focusRequest === seenFocusRequest.current) return;
    seenFocusRequest.current = focusRequest;
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [variant, focusRequest]);

  // ** The list renders in a portal with fixed positioning, because the app areas clip overflow.
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const anchor = anchorRef.current;
      const popup = popupRef.current;
      if (!anchor || !popup) return;
      const rect = anchor.getBoundingClientRect();
      const width = Math.min(Math.max(rect.width, POPUP_MIN_WIDTH), window.innerWidth - 2 * VIEWPORT_MARGIN);
      const left = Math.max(VIEWPORT_MARGIN, Math.min(rect.left, window.innerWidth - width - VIEWPORT_MARGIN));
      const top = rect.bottom + 4;
      popup.style.left = `${left}px`;
      popup.style.top = `${top}px`;
      popup.style.width = `${width}px`;
      popup.style.maxHeight = `${Math.max(120, window.innerHeight - top - VIEWPORT_MARGIN)}px`;
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open]);

  useEffect(() => {
    if (listVisible && activeIndex >= 0) revealElement(document.getElementById(`${id}option-${activeIndex}`));
  }, [listVisible, activeIndex, id]);

  const reset = () => {
    setQuery('');
    setChosenKey(null);
    setError(null);
    setDismissed(false);
  };

  /** Shows a failure where the user is looking: inline for the add box, a toast for the top bar. */
  const report = (message: string) => {
    if (variant === 'add') {
      setError(message);
      setDismissed(true);
    } else {
      showToast({ tone: 'error', title: message });
    }
  };

  const addToWatchlist = async (symbol: string) => {
    if (busyRef.current) return;
    const watchlist = addTarget(variant, watchlistId);
    if (!watchlist) {
      report('Choose a watchlist first.');
      return;
    }
    const check = validateSymbolForWatchlist(symbol, watchlist.symbols);
    if (!check.ok) {
      report(check.reason);
      return;
    }
    busyRef.current = true;
    setBusy(true);
    // ** The add box clears while the symbol saves, so the user can type the next one meanwhile.
    const submitted = variant === 'add' ? (inputRef.current?.value ?? '') : null;
    if (submitted !== null) reset();
    try {
      await useWatchlistStore.getState().addSymbol(watchlist.id, check.value);
      if (variant === 'global') showToast({ tone: 'success', title: `Added ${check.value} to ${watchlist.name}` });
      onDone?.();
    } catch (failure) {
      // Bring the text back to correct it, unless the user has started on the next symbol.
      if (submitted !== null && inputRef.current?.value === '') setQuery(submitted);
      report(isApiError(failure) ? failure.message : `Couldn't add ${check.value}. Try again.`);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const commit = async (option: SearchOption, intent: Intent) => {
    if (variant === 'global' && intent === 'primary') {
      useUiStore.getState().selectSymbol(option.symbol);
      reset();
      onDone?.();
      return;
    }
    await addToWatchlist(option.symbol);
  };

  const noMatchReason = (searchTerm: string) => {
    const typed = validateSymbol(searchTerm);
    return typed.ok ? `No instrument matches ${typed.value}.` : typed.reason;
  };

  /** Enter before the results for the typed text arrive: search now, then pick what Enter would have. */
  const commitWhenSearched = async (searchTerm: string, intent: Intent) => {
    if (enterPendingRef.current) return;
    enterPendingRef.current = true;
    try {
      const results = await search.searchNow(searchTerm);
      // The user kept typing, or the search is gone.
      if (inputRef.current?.value.trim() !== searchTerm) return;
      // ** A failed search still lets the add box take a valid typed symbol.
      const found = buildOptions(variant, searchTerm, results ?? []);
      const option = found[defaultActiveIndex(found, searchTerm)];
      if (option) await commit(option, intent);
      else if (variant === 'add') report(noMatchReason(searchTerm));
    } finally {
      enterPendingRef.current = false;
    }
  };

  const onEnter = (intent: Intent) => {
    // An add is saving; its spinner shows, and the next add can start once it finishes.
    if (busyRef.current && (variant === 'add' || intent === 'add')) return;
    if (term === '') {
      if (variant === 'add') report(noMatchReason(''));
      return;
    }
    if (active && (chosenIndex >= 0 || settled)) void commit(active, intent);
    else if (!settled) void commitWhenSearched(term, intent);
    else if (variant === 'add') report(noMatchReason(term));
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!open) {
        setDismissed(false);
        return;
      }
      const next = options[stepActiveIndex(activeIndex, options.length, event.key === 'ArrowDown' ? 1 : -1)];
      if (next) setChosenKey(optionKey(next));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      onEnter(variant === 'global' && event.shiftKey ? 'add' : 'primary');
    } else if (event.key === 'Escape') {
      if (open) {
        event.preventDefault();
        event.stopPropagation();
        setDismissed(true);
      } else if (query !== '' || error !== null) {
        event.preventDefault();
        event.stopPropagation();
        reset();
      }
    }
  };

  const onOptionAdd = (event: MouseEvent, option: SearchOption) => {
    // The option itself would select the symbol; this button only adds it.
    event.stopPropagation();
    void commit(option, 'add');
  };

  const instrumentCount = options.filter((o) => o.kind === 'instrument').length;
  let popupMessage: string | null = null;
  if (search.status === 'error') popupMessage = `Search failed. ${search.error ?? ''}`.trim();
  else if (search.status === 'loading' && options.length === 0) popupMessage = 'Searching…';
  else if (search.status === 'ready' && options.length === 0) popupMessage = 'No matching symbols';

  let announcement = '';
  if (error !== null) announcement = error;
  else if (open && search.status === 'ready')
    announcement =
      instrumentCount === 0
        ? 'No matching symbols'
        : `${instrumentCount} ${instrumentCount === 1 ? 'result' : 'results'}`;
  else if (open && search.status === 'error') announcement = popupMessage ?? '';

  const showSpinner = busy || (open && search.status === 'loading');
  const listName = target?.name ?? null;
  const label = variant === 'global' ? 'Search symbols' : listName ? `Add symbol to ${listName}` : 'Add symbol';
  const hint =
    variant === 'global'
      ? listName
        ? `Enter opens the symbol's details. Shift+Enter adds it to ${listName}.`
        : "Enter opens the symbol's details."
      : 'Type a symbol or company name, then press Enter to add it.';

  return (
    <div className={cx('symsearch', `symsearch--${variant}`)}>
      <div ref={anchorRef} className="symsearch__anchor">
        <TextInput
          ref={inputRef}
          role="combobox"
          aria-label={label}
          aria-autocomplete="list"
          aria-expanded={listVisible}
          aria-controls={listVisible ? listboxId : undefined}
          aria-activedescendant={listVisible && active ? optionId(activeIndex) : undefined}
          aria-describedby={error !== null ? `${hintId} ${errorId}` : hintId}
          aria-invalid={error !== null ? true : undefined}
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          autoFocus={autoFocus}
          placeholder={variant === 'global' ? 'Search symbols' : 'Add symbol'}
          leadingIcon={variant === 'global' ? <Search /> : <Plus />}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setChosenKey(null);
            setError(null);
            setDismissed(false);
          }}
          onKeyDown={onKeyDown}
          onFocus={() => {
            setFocused(true);
          }}
          onBlur={() => {
            setFocused(false);
            setError(null);
          }}
        />
        <span className="symsearch__trailing" aria-hidden="true">
          {showSpinner ? (
            <Spinner size={12} />
          ) : (
            variant === 'global' &&
            query === '' && (
              <>
                <Kbd>Ctrl</Kbd>
                <Kbd>K</Kbd>
              </>
            )
          )}
        </span>
      </div>
      {error !== null && (
        <p id={errorId} className="symsearch__error">
          {error}
        </p>
      )}
      <span id={hintId} className="visually-hidden">
        {hint}
      </span>
      <span className="visually-hidden" aria-live="polite">
        {announcement}
      </span>
      {open &&
        createPortal(
          <div
            ref={popupRef}
            className="symsearch-popup"
            onMouseDown={(event) => {
              // Keep focus in the input while clicking the list.
              event.preventDefault();
            }}
          >
            {listVisible && (
              <div id={listboxId} role="listbox" aria-label={`Matches for ${term}`} className="symsearch__list">
                {options.map((option, index) => {
                  const inList = target?.symbols.includes(option.symbol) ?? false;
                  const isActive = index === activeIndex;
                  return (
                    <div
                      key={optionKey(option)}
                      id={optionId(index)}
                      role="option"
                      aria-selected={isActive}
                      aria-label={optionLabel(option, listName, inList)}
                      className={cx('symsearch__option', isActive && 'is-active', option.kind === 'typed' && 'is-typed')}
                      onMouseMove={() => {
                        if (!isActive) setChosenKey(optionKey(option));
                      }}
                      onClick={() => {
                        void commit(option, 'primary');
                      }}
                    >
                      {option.kind === 'instrument' ? (
                        <>
                          <span className="symsearch__symbol">{option.symbol}</span>
                          <span className="symsearch__name">{option.instrument.name}</span>
                          <span className="symsearch__exchange">{option.instrument.exchange}</span>
                        </>
                      ) : (
                        <>
                          <span className="symsearch__symbol">{option.symbol}</span>
                          <span className="symsearch__name">Add as typed. Not in the instrument list.</span>
                        </>
                      )}
                      {inList ? (
                        <span className="symsearch__in-list">
                          <Check aria-hidden="true" />
                          {variant === 'add' ? 'Added' : 'In list'}
                        </span>
                      ) : (
                        variant === 'global' &&
                        target !== null && (
                          <button
                            type="button"
                            tabIndex={-1}
                            aria-hidden="true"
                            title={`Add ${option.symbol} to ${target.name}`}
                            className="symsearch__add"
                            onClick={(event) => {
                              onOptionAdd(event, option);
                            }}
                          >
                            <Plus aria-hidden="true" />
                            Add
                          </button>
                        )
                      )}
                    </div>
                  );
                })}
              </div>
            )}
            {popupMessage !== null && <p className="symsearch-popup__message">{popupMessage}</p>}
            {variant === 'global' && listVisible && target !== null && (
              <p className="symsearch-popup__footer" aria-hidden="true">
                <span>
                  <Kbd>Enter</Kbd> Details
                </span>
                <span>
                  <Kbd>Shift</Kbd>
                  <Kbd>Enter</Kbd> Add to {target.name}
                </span>
              </p>
            )}
          </div>,
          document.body,
        )}
    </div>
  );
}
