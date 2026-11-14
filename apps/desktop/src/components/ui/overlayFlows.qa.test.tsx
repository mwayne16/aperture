/*
 * QA for overlay flows feature screens will use, run under <StrictMode> like the app: a row
 * actions menu whose items open a dialog or a confirmation, a confirmation rendered beside its
 * dialog instead of inside it, a menu action that closes its own dialog, moving between two open
 * menus with the mouse, and toasts that arrive or are clicked while overlays are open.
 */
import { act, render, screen, within } from '@testing-library/react';
import userEvent, { PointerEventsCheckLevel } from '@testing-library/user-event';
import { StrictMode, useState, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Button } from './Button';
import { ConfirmDialog } from './ConfirmDialog';
import { Dialog } from './Dialog';
import { IconButton } from './IconButton';
import { Menu } from './Menu';
import { TextInput } from './TextInput';
import { dismissAllToasts, showToast } from './toastStore';
import { ToastViewport } from './ToastViewport';

afterEach(() => {
  act(() => {
    dismissAllToasts();
  });
});

interface RowProps {
  onRenameClose?: () => void;
  onDelete?: () => void;
}

/** A watchlist row: an icon-button actions menu whose items open a rename dialog or a delete confirmation. */
function WatchlistRow({ onRenameClose, onDelete }: RowProps) {
  const [renameOpen, setRenameOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  return (
    <>
      <Button>Before row</Button>
      <Menu
        align="end"
        trigger={(p) => <IconButton {...p} label="Row actions" icon={<span />} variant="secondary" />}
        items={[
          {
            id: 'rename',
            label: 'Rename…',
            onSelect: () => {
              setRenameOpen(true);
            },
          },
          {
            id: 'delete',
            label: 'Delete…',
            danger: true,
            onSelect: () => {
              setDeleteOpen(true);
            },
          },
        ]}
      />
      <Dialog
        open={renameOpen}
        onClose={() => {
          onRenameClose?.();
          setRenameOpen(false);
        }}
        title="Rename watchlist"
      >
        <TextInput label="Name" defaultValue="Tech" />
      </Dialog>
      <ConfirmDialog
        open={deleteOpen}
        title="Delete watchlist?"
        message="Its symbols and alerts are removed."
        confirmLabel="Delete"
        tone="danger"
        onConfirm={() => {
          onDelete?.();
          setDeleteOpen(false);
        }}
        onCancel={() => {
          setDeleteOpen(false);
        }}
      />
    </>
  );
}

/**
 * Settings dialog whose confirmation is rendered next to it rather than inside it, and whose
 * actions menu has an item that closes the dialog directly.
 */
function SettingsWithSiblingConfirm({ onArchive }: { onArchive?: () => void }) {
  const [open, setOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  return (
    <>
      <Button
        onClick={() => {
          setOpen(true);
        }}
      >
        Open settings
      </Button>
      <Dialog
        open={open}
        onClose={() => {
          setOpen(false);
        }}
        title="Watchlist settings"
        description="Applies to the sidebar list."
        footer={<Button variant="primary">Save</Button>}
      >
        <TextInput label="Name" defaultValue="Tech" />
        <Button
          onClick={() => {
            setConfirmOpen(true);
          }}
        >
          Reset columns…
        </Button>
        <Menu
          trigger={(p) => <Button {...p}>List actions</Button>}
          items={[
            { id: 'dup', label: 'Duplicate', onSelect: () => undefined },
            {
              id: 'archive',
              label: 'Archive list',
              onSelect: () => {
                onArchive?.();
                setOpen(false);
              },
            },
          ]}
        />
      </Dialog>
      <ConfirmDialog
        open={confirmOpen}
        title="Reset columns?"
        message="Column order and widths go back to the defaults."
        confirmLabel="Reset"
        onConfirm={() => {
          setConfirmOpen(false);
        }}
        onCancel={() => {
          setConfirmOpen(false);
        }}
      />
      <ToastViewport />
    </>
  );
}

function renderStrict(ui: ReactNode, options?: Parameters<typeof userEvent.setup>[0]) {
  const user = userEvent.setup(options);
  render(<StrictMode>{ui}</StrictMode>);
  return user;
}

describe('a top-level actions menu that opens dialogs (QA)', () => {
  it('keyboard: a menu item opens a dialog with focus inside, and Escape returns focus to the menu trigger', async () => {
    const onRenameClose = vi.fn();
    const user = renderStrict(<WatchlistRow onRenameClose={onRenameClose} />);
    await user.click(screen.getByRole('button', { name: 'Before row' }));
    await user.tab();
    const trigger = screen.getByRole('button', { name: 'Row actions' });
    expect(trigger).toHaveFocus();

    await user.keyboard('{Enter}');
    expect(screen.getByRole('menuitem', { name: 'Rename…' })).toHaveFocus();
    await user.keyboard('{Enter}');

    const dialog = screen.getByRole('dialog', { name: 'Rename watchlist' });
    expect(within(dialog).getByRole('textbox', { name: 'Name' })).toHaveFocus();
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(onRenameClose).toHaveBeenCalledTimes(1);
    expect(trigger).toHaveFocus();
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('mouse: a confirmation opened from a menu item confirms once and hands focus back to the trigger', async () => {
    const onDelete = vi.fn();
    const user = renderStrict(<WatchlistRow onDelete={onDelete} />);
    const trigger = screen.getByRole('button', { name: 'Row actions' });

    await user.click(trigger);
    await user.click(screen.getByRole('menuitem', { name: 'Delete…' }));
    const confirm = screen.getByRole('dialog', { name: 'Delete watchlist?' });
    expect(confirm).toHaveAccessibleDescription('Its symbols and alerts are removed.');
    expect(within(confirm).getByRole('button', { name: 'Cancel' })).toHaveFocus();

    await user.click(within(confirm).getByRole('button', { name: 'Delete' }));
    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    expect(document.body.style.pointerEvents).toBe('');

    // The menu still opens normally afterwards.
    await user.click(trigger);
    expect(screen.getByRole('menu')).toBeInTheDocument();
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
  });

  it('an icon-button trigger shows its tooltip on hover, and clicking it opens the menu without leaving the tooltip up', async () => {
    const user = renderStrict(<WatchlistRow />);
    const trigger = screen.getByRole('button', { name: 'Row actions' });

    await user.hover(trigger);
    expect(await screen.findByRole('tooltip', {}, { timeout: 1500 })).toHaveTextContent('Row actions');

    await user.click(trigger);
    expect(screen.getByRole('menu')).toBeInTheDocument();
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Rename…' })).toHaveFocus();
  });

  it('mouse: a backdrop click closes a dialog opened from a menu, once, and focus returns to the trigger', async () => {
    const onRenameClose = vi.fn();
    const user = renderStrict(<WatchlistRow onRenameClose={onRenameClose} />);
    const trigger = screen.getByRole('button', { name: 'Row actions' });

    await user.click(trigger);
    await user.click(screen.getByRole('menuitem', { name: 'Rename…' }));
    const dialog = screen.getByRole('dialog', { name: 'Rename watchlist' });

    await user.click(dialog.parentElement!);
    expect(onRenameClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });
});

describe('a confirmation rendered beside its dialog (QA)', () => {
  async function openConfirm(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByRole('button', { name: 'Open settings' }));
    const reset = screen.getByRole('button', { name: 'Reset columns…' });
    reset.focus();
    await user.keyboard('{Enter}');
    return { reset, confirm: screen.getByRole('dialog', { name: 'Reset columns?' }) };
  }

  it('traps focus in the confirmation; Escape closes it first, then the dialog, restoring focus each time', async () => {
    const user = renderStrict(<SettingsWithSiblingConfirm />);
    const { reset, confirm } = await openConfirm(user);
    expect(within(confirm).getByRole('button', { name: 'Cancel' })).toHaveFocus();

    for (let i = 0; i < 4; i++) {
      await user.tab();
      expect(confirm.contains(document.activeElement)).toBe(true);
    }
    await user.tab({ shift: true });
    expect(confirm.contains(document.activeElement)).toBe(true);

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Reset columns?' })).not.toBeInTheDocument();
    // ** getByRole skips aria-hidden content, so this also proves the dialog is exposed again.
    expect(screen.getByRole('dialog', { name: 'Watchlist settings' })).toBeInTheDocument();
    expect(reset).toHaveFocus();

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open settings' })).toHaveFocus();
  });

  it('a click on the confirmation backdrop closes only the confirmation', async () => {
    const user = renderStrict(<SettingsWithSiblingConfirm />);
    const { reset, confirm } = await openConfirm(user);

    await user.click(confirm.parentElement!);
    expect(screen.queryByRole('dialog', { name: 'Reset columns?' })).not.toBeInTheDocument();
    const settings = screen.getByRole('dialog', { name: 'Watchlist settings' });
    expect(reset).toHaveFocus();

    await user.tab();
    expect(settings.contains(document.activeElement)).toBe(true);
  });
});

describe('menus inside and beside dialogs (QA)', () => {
  it('a menu item that closes its dialog leaves the page focused on the opener and usable', async () => {
    const onArchive = vi.fn();
    const user = renderStrict(<SettingsWithSiblingConfirm onArchive={onArchive} />);
    const opener = screen.getByRole('button', { name: 'Open settings' });
    await user.click(opener);

    const trigger = screen.getByRole('button', { name: 'List actions' });
    trigger.focus();
    await user.keyboard('{Enter}{End}{Enter}');

    expect(onArchive).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
    expect(opener.closest('[aria-hidden="true"]')).toBeNull();
    expect(document.body.style.pointerEvents).toBe('');

    // The page stays usable from the keyboard: Enter on the opener brings the dialog back.
    await user.keyboard('{Enter}');
    expect(screen.getByRole('textbox', { name: 'Name' })).toHaveFocus();
  });

  it('clicking a second menu trigger while one menu is open swaps to the second menu', async () => {
    const user = renderStrict(
      <>
        <Menu
          trigger={(p) => <Button {...p}>Sort</Button>}
          items={[
            { id: 'sym', label: 'By symbol', onSelect: () => undefined },
            { id: 'chg', label: 'By change', onSelect: () => undefined },
          ]}
        />
        <Menu
          trigger={(p) => <Button {...p}>View</Button>}
          items={[
            { id: 'compact', label: 'Compact rows', onSelect: () => undefined },
            { id: 'spark', label: 'Sparklines', onSelect: () => undefined },
          ]}
        />
      </>,
    );
    const sort = screen.getByRole('button', { name: 'Sort' });
    const view = screen.getByRole('button', { name: 'View' });

    await user.click(sort);
    expect(screen.getByRole('menuitem', { name: 'By symbol' })).toHaveFocus();

    await user.click(view);
    expect(screen.getAllByRole('menu')).toHaveLength(1);
    expect(screen.queryByRole('menuitem', { name: 'By symbol' })).not.toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Compact rows' })).toHaveFocus();
    expect(sort).toHaveAttribute('aria-expanded', 'false');
    expect(view).toHaveAttribute('aria-expanded', 'true');

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(view).toHaveFocus();
  });

  it('clicking plain dialog content while a menu is open closes only the menu', async () => {
    const user = renderStrict(<SettingsWithSiblingConfirm />);
    await user.click(screen.getByRole('button', { name: 'Open settings' }));
    await user.click(screen.getByRole('button', { name: 'List actions' }));
    expect(screen.getByRole('menu')).toBeInTheDocument();

    await user.click(screen.getByText('Applies to the sidebar list.'));
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Watchlist settings' })).toBeInTheDocument();
  });
});

describe('Escape and an opener tooltip (QA)', () => {
  it('a keyboard tooltip on the opener does not cost an extra Escape: one Escape closes the dialog', async () => {
    const onClose = vi.fn();
    function ChartToolbar() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <Button>Before toolbar</Button>
          <IconButton
            label="Indicators"
            icon={<span />}
            onClick={() => {
              setOpen(true);
            }}
          />
          <Dialog
            open={open}
            onClose={() => {
              onClose();
              setOpen(false);
            }}
            title="Indicators"
          >
            <TextInput label="Period" defaultValue="14" />
          </Dialog>
        </>
      );
    }
    const user = renderStrict(<ChartToolbar />);
    await user.click(screen.getByRole('button', { name: 'Before toolbar' }));
    await user.tab();
    const opener = screen.getByRole('button', { name: 'Indicators' });
    expect(opener).toHaveFocus();
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Indicators');

    await user.keyboard('{Enter}');
    expect(screen.getByRole('textbox', { name: 'Period' })).toHaveFocus();
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();

    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });
});

describe('toasts and open overlays (QA)', () => {
  it('a toast shown by a nested confirmation is announced after both dialogs close and focus returns to the opener', async () => {
    function RenameWithDelete() {
      const [open, setOpen] = useState(false);
      const [confirmOpen, setConfirmOpen] = useState(false);
      return (
        <>
          <Button
            onClick={() => {
              setOpen(true);
            }}
          >
            Rename watchlist
          </Button>
          <Dialog
            open={open}
            onClose={() => {
              setOpen(false);
            }}
            title="Rename watchlist"
          >
            <TextInput label="Name" defaultValue="Tech" />
            <Button
              onClick={() => {
                setConfirmOpen(true);
              }}
            >
              Delete watchlist…
            </Button>
            <ConfirmDialog
              open={confirmOpen}
              title="Delete watchlist?"
              message="This can’t be undone."
              confirmLabel="Delete watchlist"
              tone="danger"
              onConfirm={() => {
                setConfirmOpen(false);
                setOpen(false);
                showToast({ tone: 'warning', title: 'Watchlist deleted' });
              }}
              onCancel={() => {
                setConfirmOpen(false);
              }}
            />
          </Dialog>
          <ToastViewport />
        </>
      );
    }
    const user = renderStrict(<RenameWithDelete />);
    const opener = screen.getByRole('button', { name: 'Rename watchlist' });
    await user.click(opener);
    await user.click(screen.getByRole('button', { name: 'Delete watchlist…' }));
    const confirm = screen.getByRole('dialog', { name: 'Delete watchlist?' });
    await user.click(within(confirm).getByRole('button', { name: 'Delete watchlist' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
    const region = screen.getByRole('region', { name: 'Notifications' });
    expect(region).toHaveTextContent('Watchlist deleted');
    expect(opener.closest('[aria-hidden="true"]')).toBeNull();
    expect(region.closest('[aria-hidden="true"]')).toBeNull();
  });

  it('a toast arriving while a menu is open in a dialog does not close the menu or move focus', async () => {
    const user = renderStrict(<SettingsWithSiblingConfirm />);
    await user.click(screen.getByRole('button', { name: 'Open settings' }));
    const trigger = screen.getByRole('button', { name: 'List actions' });
    trigger.focus();
    await user.keyboard('{Enter}');
    const first = screen.getByRole('menuitem', { name: 'Duplicate' });
    expect(first).toHaveFocus();

    act(() => {
      showToast({ tone: 'warning', title: 'NVDA crossed above 140.00', durationMs: 0 });
    });
    expect(screen.getByRole('menu')).toBeInTheDocument();
    expect(first).toHaveFocus();
    expect(screen.getByRole('region', { name: 'Notifications' })).toHaveTextContent(
      'NVDA crossed above 140.00',
    );

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    expect(screen.getByRole('dialog', { name: 'Watchlist settings' })).toBeInTheDocument();
    expect(screen.getByText('NVDA crossed above 140.00')).toBeInTheDocument();
  });

  it('clicking a toast’s text while a dialog is open keeps the dialog, and Escape still closes it to the opener', async () => {
    // ** Toasts sit above the backdrop with pointer-events: auto. jsdom loads no CSS, so the
    // pointer-events check is skipped to match what a browser lets the user click.
    const user = renderStrict(<SettingsWithSiblingConfirm />, {
      pointerEventsCheck: PointerEventsCheckLevel.Never,
    });
    const opener = screen.getByRole('button', { name: 'Open settings' });
    await user.click(opener);
    act(() => {
      showToast({
        tone: 'info',
        title: 'Feed reconnected',
        description: 'Quotes are streaming.',
        durationMs: 0,
      });
    });

    await user.click(screen.getByText('Quotes are streaming.'));
    expect(screen.getByRole('dialog', { name: 'Watchlist settings' })).toBeInTheDocument();
    expect(screen.getByText('Feed reconnected')).toBeInTheDocument();

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });
});
