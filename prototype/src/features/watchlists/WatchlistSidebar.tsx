import { AlertTriangle, Ellipsis, ListPlus, Pencil, Plus, RotateCw, Trash2 } from 'lucide-react';
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { cx } from '../../components/ui/cx';
import { EmptyState } from '../../components/ui/EmptyState';
import { IconButton } from '../../components/ui/IconButton';
import { Menu } from '../../components/ui/Menu';
import { Skeleton } from '../../components/ui/Skeleton';
import { Spinner } from '../../components/ui/Spinner';
import type { Watchlist } from '../../domain/types';
import { nextListIndex } from './listNavigation';
import { WatchlistNameDialog } from './WatchlistNameDialog';
import { useWatchlistStore } from './watchlistStore';
import './watchlists.css';

/** Marks the control that takes focus when the focused one disappears (an item, Retry, Create). */
const FOCUS_TARGET = '[aria-current="true"], [data-focus-target]';
const ITEM_BUTTON = '[data-watchlist-item]';
const SKELETON_WIDTHS = ['72%', '54%', '64%', '46%'];

function symbolCount(count: number): string {
  return count === 1 ? '1 symbol' : `${count} symbols`;
}

function deleteMessage(watchlist: Watchlist): string {
  const count = watchlist.symbols.length;
  const what = count === 0 ? `“${watchlist.name}”` : `“${watchlist.name}” and its ${symbolCount(count)}`;
  return `${what} will be deleted. Alerts are kept.`;
}

/** A pending focus check. `opener` is the control a closing dialog hands focus back to, if any. */
interface FocusRecovery {
  opener: HTMLElement | null;
}

interface NameDialogState {
  open: boolean;
  /** The list being renamed, as it was when the dialog opened. Null when creating. */
  watchlist: Watchlist | null;
  /** Changes on every opening so the dialog starts from a clean form. */
  session: number;
}

/**
 * Watchlist picker for the side area: lists every watchlist with its symbol count, marks the
 * active one, and creates, renames and deletes lists. Up/Down/Home/End move between lists,
 * Enter activates, F2 renames and Delete asks to delete.
 */
export function WatchlistSidebar() {
  const status = useWatchlistStore((s) => s.status);
  const error = useWatchlistStore((s) => s.error);
  const watchlists = useWatchlistStore((s) => s.watchlists);
  const activeId = useWatchlistStore((s) => s.activeId);
  const titleId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const recovery = useRef<FocusRecovery | null>(null);
  const nameDialogOpener = useRef<HTMLElement | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [nameDialog, setNameDialog] = useState<NameDialogState>({ open: false, watchlist: null, session: 0 });
  const [deleteTarget, setDeleteTarget] = useState<Watchlist | null>(null);

  const hasLists = watchlists.length > 0;
  const canCreate = status === 'ready' || hasLists;
  const tabStopId =
    [focusId, activeId].find((id) => watchlists.some((w) => w.id === id)) ?? watchlists[0]?.id;

  const openNameDialog = (watchlist: Watchlist | null) => {
    nameDialogOpener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setNameDialog((d) => ({ open: true, watchlist, session: d.session + 1 }));
  };

  const closeNameDialog = () => {
    // ** Creating the first list replaces the empty state, which held the button that opened the dialog.
    recovery.current = { opener: nameDialogOpener.current };
    setNameDialog((d) => ({ ...d, open: false }));
  };

  const retry = () => {
    recovery.current = { opener: null };
    void useWatchlistStore.getState().load();
  };

  const confirmDelete = () => {
    if (!deleteTarget) return;
    recovery.current = { opener: null };
    void useWatchlistStore.getState().remove(deleteTarget.id);
    setDeleteTarget(null);
  };

  // Keep the active list in view, e.g. after a reload restores a list far down.
  useEffect(() => {
    const button = [...(listRef.current?.querySelectorAll<HTMLElement>(ITEM_BUTTON) ?? [])].find(
      (el) => el.dataset.watchlistItem === activeId,
    );
    // ** jsdom has no layout, so scrollIntoView may be missing there.
    if (typeof button?.scrollIntoView === 'function') button.scrollIntoView({ block: 'nearest' });
  }, [activeId, hasLists]);

  // After a delete, a retry or a dialog removes the focused control (or the control that opened the
  // dialog), put focus on the active list or the state's main action instead of the page body.
  useEffect(() => {
    if (recovery.current === null || deleteTarget !== null || nameDialog.open || status === 'loading') return;
    // ** Wait one task: the closing dialog unmounts in a follow-up render and drops focus after this effect.
    const timer = setTimeout(() => {
      const opener = recovery.current?.opener;
      recovery.current = null;
      const focused = document.activeElement;
      if (focused !== null && focused !== document.body) return;
      // ** The dialog returns focus to its opener itself, a task later, while the opener still exists.
      if (opener?.isConnected === true) return;
      rootRef.current?.querySelector<HTMLElement>(FOCUS_TARGET)?.focus();
    }, 0);
    return () => {
      clearTimeout(timer);
    };
  }, [deleteTarget, nameDialog.open, status, watchlists, activeId]);

  const onListKeyDown = (event: KeyboardEvent<HTMLUListElement>) => {
    if (!(event.target instanceof HTMLElement) || !event.target.matches(ITEM_BUTTON)) return;
    const buttons = [...event.currentTarget.querySelectorAll<HTMLElement>(ITEM_BUTTON)];
    const next = nextListIndex(event.key, buttons.indexOf(event.target), buttons.length);
    if (next === null) return;
    event.preventDefault();
    buttons[next]?.focus();
  };

  let body;
  if (hasLists) {
    body = (
      <>
        {status === 'error' && (
          <div className="wl-banner" role="alert">
            <AlertTriangle aria-hidden="true" />
            <span className="wl-banner__text">Couldn&apos;t refresh watchlists.</span>
            <Button size="sm" variant="ghost" onClick={retry}>
              Retry
            </Button>
          </div>
        )}
        <ul ref={listRef} className="wl-list" aria-labelledby={titleId} onKeyDown={onListKeyDown}>
          {watchlists.map((watchlist) => (
            <WatchlistItem
              key={watchlist.id}
              watchlist={watchlist}
              active={watchlist.id === activeId}
              tabbable={watchlist.id === tabStopId}
              onFocusWithin={setFocusId}
              onRename={openNameDialog}
              onDelete={setDeleteTarget}
            />
          ))}
        </ul>
      </>
    );
  } else if (status === 'error') {
    body = (
      <div role="alert">
        <EmptyState
          compact
          icon={<AlertTriangle />}
          title="Couldn't load watchlists"
          description={error ?? undefined}
          action={
            <Button size="sm" icon={<RotateCw />} onClick={retry} data-focus-target="">
              Retry
            </Button>
          }
        />
      </div>
    );
  } else if (status === 'ready') {
    body = (
      <EmptyState
        compact
        icon={<ListPlus />}
        title="No watchlists"
        description="Create a watchlist to follow a set of symbols."
        action={
          <Button
            size="sm"
            variant="primary"
            icon={<Plus />}
            data-focus-target=""
            onClick={() => {
              openNameDialog(null);
            }}
          >
            New watchlist
          </Button>
        }
      />
    );
  } else {
    body = (
      <div aria-busy="true">
        <span className="visually-hidden" role="status">
          Loading watchlists
        </span>
        {SKELETON_WIDTHS.map((width) => (
          <div key={width} className="wl-skeleton-row">
            <Skeleton width={width} />
            <Skeleton width={14} />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div ref={rootRef} className="wl-sidebar">
      <div className="wl-sidebar__header">
        <h2 id={titleId} className="wl-sidebar__title">
          Watchlists
        </h2>
        {status === 'loading' && hasLists && <Spinner size={12} label="Refreshing watchlists" />}
        <IconButton
          label="New watchlist"
          icon={<Plus />}
          size="sm"
          disabled={!canCreate}
          onClick={() => {
            openNameDialog(null);
          }}
        />
      </div>
      <div className="wl-sidebar__body">{body}</div>
      <div className="wl-sidebar__footer">
        <Badge tone="warning" size="sm">
          Simulated
        </Badge>
        <span>Saved in this browser</span>
      </div>

      <WatchlistNameDialog
        key={nameDialog.session}
        open={nameDialog.open}
        watchlist={nameDialog.watchlist}
        onClose={closeNameDialog}
      />
      <ConfirmDialog
        open={deleteTarget !== null}
        title="Delete watchlist?"
        message={deleteTarget ? deleteMessage(deleteTarget) : null}
        confirmLabel="Delete"
        tone="danger"
        onConfirm={confirmDelete}
        onCancel={() => {
          setDeleteTarget(null);
        }}
      />
    </div>
  );
}

interface WatchlistItemProps {
  watchlist: Watchlist;
  active: boolean;
  /** Whether this item holds the list's single Tab stop. */
  tabbable: boolean;
  onFocusWithin: (id: string) => void;
  onRename: (watchlist: Watchlist) => void;
  onDelete: (watchlist: Watchlist) => void;
}

function WatchlistItem({
  watchlist,
  active,
  tabbable,
  onFocusWithin,
  onRename,
  onDelete,
}: WatchlistItemProps) {
  const count = watchlist.symbols.length;

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'F2') {
      event.preventDefault();
      onRename(watchlist);
    } else if (event.key === 'Delete') {
      event.preventDefault();
      onDelete(watchlist);
    }
  };

  return (
    <li
      className={cx('wl-item', active && 'is-active')}
      onFocus={() => {
        onFocusWithin(watchlist.id);
      }}
    >
      <button
        type="button"
        className="wl-item__select"
        data-watchlist-item={watchlist.id}
        // ** An explicit name, because the name and count spans would otherwise run together ("Ideas0").
        aria-label={`${watchlist.name}, ${symbolCount(count)}`}
        aria-current={active ? 'true' : undefined}
        aria-keyshortcuts="F2 Delete"
        tabIndex={tabbable ? 0 : -1}
        onClick={() => {
          useWatchlistStore.getState().setActive(watchlist.id);
        }}
        onKeyDown={onKeyDown}
      >
        <span className="wl-item__name" title={watchlist.name}>
          {watchlist.name}
        </span>
        <span className="wl-item__count num" aria-hidden="true">
          {count}
        </span>
      </button>
      <Menu
        align="end"
        trigger={(props) => (
          <IconButton
            {...props}
            label={`Actions for ${watchlist.name}`}
            icon={<Ellipsis />}
            size="sm"
            tabIndex={tabbable ? 0 : -1}
            className="wl-item__menu"
          />
        )}
        items={[
          {
            id: 'rename',
            label: 'Rename',
            icon: <Pencil />,
            onSelect: () => {
              onRename(watchlist);
            },
          },
          {
            id: 'delete',
            label: 'Delete',
            icon: <Trash2 />,
            danger: true,
            onSelect: () => {
              onDelete(watchlist);
            },
          },
        ]}
      />
    </li>
  );
}
