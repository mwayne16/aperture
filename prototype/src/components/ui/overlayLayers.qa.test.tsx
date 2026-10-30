/*
 * QA for the overlay contract after the move to Radix. The app mounts under <StrictMode>, so the
 * nested cases run there: a menu and a confirmation inside a settings dialog, Escape closing one
 * layer at a time, focus returning to whoever opened each layer, and toasts that arrive while a
 * dialog is open.
 */
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent, { PointerEventsCheckLevel } from '@testing-library/user-event';
import { StrictMode, useState } from 'react';
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

interface SettingsProps {
  onClose?: () => void;
  onRemove?: () => void;
  /** Keeps the nested confirmation busy after Remove is confirmed. */
  holdBusy?: boolean;
}

/** A settings dialog with a name field, an actions menu and a nested "Remove?" confirmation. */
function WatchlistSettings({ onClose, onRemove, holdBusy = false }: SettingsProps) {
  const [open, setOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
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
          onClose?.();
          setOpen(false);
        }}
        title="Watchlist settings"
        description="Applies to the sidebar list."
        footer={<Button variant="primary">Save</Button>}
      >
        <TextInput label="Name" defaultValue="Tech" />
        <Menu
          trigger={(p) => <Button {...p}>List actions</Button>}
          items={[
            { id: 'dup', label: 'Duplicate', onSelect: () => undefined },
            {
              id: 'remove',
              label: 'Remove list',
              danger: true,
              onSelect: () => {
                setConfirmOpen(true);
              },
            },
          ]}
        />
        <ConfirmDialog
          open={confirmOpen}
          title="Remove watchlist?"
          message="Its alerts stop evaluating."
          confirmLabel="Remove"
          tone="danger"
          busy={busy}
          onConfirm={() => {
            onRemove?.();
            if (holdBusy) {
              setBusy(true);
              return;
            }
            setConfirmOpen(false);
            setOpen(false);
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

function renderStrict(props: SettingsProps = {}) {
  const user = userEvent.setup();
  render(
    <StrictMode>
      <WatchlistSettings {...props} />
    </StrictMode>,
  );
  return user;
}

async function openRemoveConfirmation(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Open settings' }));
  await user.click(screen.getByRole('button', { name: 'List actions' }));
  await user.keyboard('{End}{Enter}');
  return screen.getByRole('dialog', { name: 'Remove watchlist?' });
}

describe('nested overlays under StrictMode (QA)', () => {
  it('Escape closes the menu inside a dialog first, then the dialog, restoring focus at each step', async () => {
    const user = renderStrict();
    await user.click(screen.getByRole('button', { name: 'Open settings' }));
    const trigger = screen.getByRole('button', { name: 'List actions' });
    trigger.focus();
    await user.keyboard('{Enter}');
    expect(screen.getByRole('menuitem', { name: 'Duplicate' })).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('menuitem', { name: 'Remove list' })).toHaveFocus();

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Watchlist settings' })).toBeInTheDocument();
    expect(trigger).toHaveFocus();

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open settings' })).toHaveFocus();
  });

  it('a confirmation opened from a menu item in a dialog traps focus and hands it back to the menu trigger', async () => {
    const user = renderStrict();
    const confirm = await openRemoveConfirmation(user);
    expect(within(confirm).getByRole('button', { name: 'Cancel' })).toHaveFocus();
    expect(confirm).toHaveAccessibleDescription('Its alerts stop evaluating.');

    for (let i = 0; i < 4; i++) {
      await user.tab();
      expect(confirm.contains(document.activeElement)).toBe(true);
    }

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Remove watchlist?' })).not.toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Watchlist settings' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'List actions' })).toHaveFocus();

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open settings' })).toHaveFocus();
  });

  it('confirming closes both dialogs at once and leaves the page focused, clickable and exposed to assistive tech', async () => {
    const onRemove = vi.fn();
    const user = renderStrict({ onRemove });
    const confirm = await openRemoveConfirmation(user);
    await user.click(within(confirm).getByRole('button', { name: 'Remove' }));

    expect(onRemove).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    const opener = screen.getByRole('button', { name: 'Open settings' });
    expect(opener).toHaveFocus();
    expect(opener.closest('[aria-hidden="true"]')).toBeNull();
    expect(document.body.style.pointerEvents).toBe('');
  });

  it('a busy nested confirmation ignores Escape and its backdrop without closing the dialog behind it', async () => {
    const onClose = vi.fn();
    const user = renderStrict({ holdBusy: true, onClose });
    const confirm = await openRemoveConfirmation(user);
    await user.click(within(confirm).getByRole('button', { name: 'Remove' }));
    expect(within(confirm).getByRole('button', { name: 'Remove' })).toHaveAttribute('aria-busy', 'true');

    await user.keyboard('{Escape}');
    expect(confirm.contains(document.activeElement)).toBe(true);
    await user.click(confirm.parentElement!);
    expect(screen.getByRole('dialog', { name: 'Remove watchlist?' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'Watchlist settings', hidden: true })).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('calls onClose exactly once for Escape, the Close button and a backdrop click', async () => {
    const onClose = vi.fn();
    const user = renderStrict({ onClose });
    const opener = screen.getByRole('button', { name: 'Open settings' });

    await user.click(opener);
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);

    await user.click(opener);
    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(2);
    expect(opener).toHaveFocus();

    await user.click(opener);
    await user.click(screen.getByRole('dialog').parentElement!);
    expect(onClose).toHaveBeenCalledTimes(3);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });

  it('Escape dismisses a keyboard tooltip inside a dialog before it closes the dialog', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(
      <StrictMode>
        <Dialog open onClose={onClose} title="Chart options">
          <IconButton label="Zoom in" icon={<span />} />
          <IconButton label="Reset zoom" icon={<span />} />
        </Dialog>
      </StrictMode>,
    );
    expect(screen.getByRole('button', { name: 'Zoom in' })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Reset zoom' })).toHaveFocus();
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Reset zoom');

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('toasts while a dialog is open (QA)', () => {
  it('keeps the notification live region exposed to screen readers behind a modal dialog', async () => {
    const user = renderStrict();
    await user.click(screen.getByRole('button', { name: 'Open settings' }));
    act(() => {
      showToast({ tone: 'warning', title: 'AAPL crossed above 230.00', durationMs: 0 });
    });
    const region = screen.getByRole('region', { name: 'Notifications' });
    expect(region).toHaveAttribute('aria-live', 'polite');
    expect(region.closest('[aria-hidden="true"]')).toBeNull();
    expect(within(region).getByText('AAPL crossed above 230.00')).toBeInTheDocument();
  });

  it('dismissing a toast with the mouse does not close the dialog the user is working in', async () => {
    // ** Radix sets pointer-events: none on <body> behind a modal, but .ui-toast sets
    // pointer-events: auto and sits above the backdrop (z-index), so a real click lands on the
    // toast. jsdom loads no CSS, so the pointer-events check is skipped to match the browser.
    const user = userEvent.setup({ pointerEventsCheck: PointerEventsCheckLevel.Never });
    const onClose = vi.fn();
    render(
      <StrictMode>
        <WatchlistSettings onClose={onClose} />
      </StrictMode>,
    );
    await user.click(screen.getByRole('button', { name: 'Open settings' }));
    const name = screen.getByRole('textbox', { name: 'Name' });
    await user.clear(name);
    await user.type(name, 'Semis');
    act(() => {
      showToast({ tone: 'warning', title: 'AAPL crossed above 230.00', durationMs: 0 });
    });

    const region = screen.getByRole('region', { name: 'Notifications' });
    await user.click(within(region).getByRole('button', { name: 'Dismiss notification' }));

    expect(within(region).queryByText('AAPL crossed above 230.00')).not.toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog', { name: 'Watchlist settings' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Name' })).toHaveValue('Semis');
  });

  it('hovering the toast stack behind a dialog pauses auto-dismiss and leaving resumes it', () => {
    vi.useFakeTimers();
    try {
      render(
        <StrictMode>
          <Dialog open onClose={vi.fn()} title="Edit alert">
            <TextInput label="Price" />
          </Dialog>
          <ToastViewport />
        </StrictMode>,
      );
      act(() => {
        showToast({ tone: 'info', title: 'Feed reconnected', durationMs: 1000 });
      });
      const region = screen.getByRole('region', { name: 'Notifications' });
      fireEvent.mouseEnter(region);
      act(() => {
        vi.advanceTimersByTime(5000);
      });
      expect(within(region).getByText('Feed reconnected')).toBeInTheDocument();
      fireEvent.mouseLeave(region);
      act(() => {
        vi.advanceTimersByTime(1000);
      });
      expect(within(region).queryByText('Feed reconnected')).not.toBeInTheDocument();
      expect(screen.getByRole('dialog', { name: 'Edit alert' })).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });
});
