import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { Button } from './Button';
import { ConfirmDialog } from './ConfirmDialog';
import { Dialog } from './Dialog';
import { Menu } from './Menu';
import { TextInput } from './TextInput';

/*
 * Spec: Dialog is a modal with a focus trap, Esc + backdrop click close, and focus restore.
 * A confirmation opened from inside another dialog (e.g. "Delete watchlist?" from a settings
 * dialog) and a Menu inside a dialog are everyday compositions. The innermost overlay must own
 * the keyboard: Tab must stay inside it and Esc must only close it.
 */

function SettingsWithConfirm({ onDelete = () => undefined }: { onDelete?: () => void }) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => {
          setSettingsOpen(true);
        }}
      >
        Open settings
      </button>
      <Dialog
        open={settingsOpen}
        onClose={() => {
          setSettingsOpen(false);
        }}
        title="Watchlist settings"
        footer={<Button variant="primary">Save</Button>}
      >
        <TextInput label="Name" defaultValue="Tech" />
        <Button
          variant="danger"
          onClick={() => {
            setConfirmOpen(true);
          }}
        >
          Delete watchlist
        </Button>
        <ConfirmDialog
          open={confirmOpen}
          title="Delete watchlist?"
          message="This cannot be undone."
          confirmLabel="Delete"
          tone="danger"
          onConfirm={() => {
            onDelete();
            setConfirmOpen(false);
          }}
          onCancel={() => {
            setConfirmOpen(false);
          }}
        />
      </Dialog>
    </>
  );
}

async function openConfirm() {
  const user = userEvent.setup();
  render(<SettingsWithConfirm />);
  await user.click(screen.getByRole('button', { name: 'Open settings' }));
  await user.click(screen.getByRole('button', { name: 'Delete watchlist' }));
  const confirm = screen.getByRole('dialog', { name: 'Delete watchlist?' });
  return { user, confirm };
}

describe('Dialog nested inside Dialog (adversarial)', () => {
  it('starts the inner confirmation on Cancel', async () => {
    const { confirm } = await openConfirm();
    expect(within(confirm).getByRole('button', { name: 'Cancel' })).toHaveFocus();
  });

  it('Tab from Cancel moves to Delete inside the confirmation, not back into the outer dialog', async () => {
    const { user, confirm } = await openConfirm();
    await user.tab();
    expect(within(confirm).getByRole('button', { name: 'Delete' })).toHaveFocus();
  });

  it('Shift+Tab from Delete moves back to Cancel inside the confirmation', async () => {
    const { user, confirm } = await openConfirm();
    within(confirm).getByRole('button', { name: 'Delete' }).focus();
    await user.tab({ shift: true });
    expect(within(confirm).getByRole('button', { name: 'Cancel' })).toHaveFocus();
  });

  it('Tab and Shift+Tab never leave the innermost dialog', async () => {
    const { user, confirm } = await openConfirm();
    for (let i = 0; i < 7; i++) {
      await user.tab();
      expect(confirm.contains(document.activeElement)).toBe(true);
    }
    for (let i = 0; i < 7; i++) {
      await user.tab({ shift: true });
      expect(confirm.contains(document.activeElement)).toBe(true);
    }
  });

  it('Escape closes only the inner dialog, restores focus to its opener, and a second Escape closes the outer one', async () => {
    const { user } = await openConfirm();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Delete watchlist?' })).not.toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Watchlist settings' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete watchlist' })).toHaveFocus();

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open settings' })).toHaveFocus();
  });

  it('a click on the inner backdrop closes only the inner dialog', async () => {
    const { user, confirm } = await openConfirm();
    const backdrop = confirm.parentElement!;
    await user.click(backdrop);
    expect(screen.queryByRole('dialog', { name: 'Delete watchlist?' })).not.toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Watchlist settings' })).toBeInTheDocument();
  });

  it('after the inner dialog closes, Tab is trapped in the outer dialog again', async () => {
    const { user } = await openConfirm();
    await user.keyboard('{Escape}');
    const outer = screen.getByRole('dialog', { name: 'Watchlist settings' });
    for (let i = 0; i < 6; i++) {
      await user.tab();
      expect(outer.contains(document.activeElement)).toBe(true);
    }
  });
});

function DialogWithMenu({ onExport }: { onExport: () => void }) {
  const [open, setOpen] = useState(true);
  return (
    <Dialog
      open={open}
      onClose={() => {
        setOpen(false);
      }}
      title="Layout"
      footer={<Button variant="primary">Done</Button>}
    >
      <Menu
        trigger={(p) => <Button {...p}>More</Button>}
        items={[
          { id: 'export', label: 'Export', onSelect: onExport },
          { id: 'reset', label: 'Reset', onSelect: () => undefined },
        ]}
      />
    </Dialog>
  );
}

describe('Menu inside a Dialog (adversarial)', () => {
  it('Escape closes only the menu and returns focus to its trigger inside the dialog', async () => {
    const user = userEvent.setup();
    render(<DialogWithMenu onExport={() => undefined} />);
    const trigger = screen.getByRole('button', { name: 'More' });
    await user.click(trigger);
    expect(screen.getByRole('menu')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Layout' })).toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('Tab inside the open menu closes it without letting focus leave the dialog', async () => {
    const user = userEvent.setup();
    render(<DialogWithMenu onExport={() => undefined} />);
    await user.click(screen.getByRole('button', { name: 'More' }));
    await user.tab();
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    const dialog = screen.getByRole('dialog', { name: 'Layout' });
    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  it('selecting an item with Enter or a click runs it once and keeps the dialog open', async () => {
    const onExport = vi.fn();
    const user = userEvent.setup();
    render(<DialogWithMenu onExport={onExport} />);
    await user.click(screen.getByRole('button', { name: 'More' }));
    await user.keyboard('{Enter}');
    expect(onExport).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('dialog', { name: 'Layout' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'More' }));
    await user.click(screen.getByRole('menuitem', { name: 'Export' }));
    expect(onExport).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('dialog', { name: 'Layout' })).toBeInTheDocument();
  });
});

function DialogWithSelfRemovingButton({ onClose }: { onClose: () => void }) {
  const [showTip, setShowTip] = useState(true);
  return (
    <Dialog open onClose={onClose} title="Alerts" footer={<Button>Close alerts</Button>}>
      <TextInput label="Threshold" />
      {showTip && (
        <Button
          onClick={() => {
            setShowTip(false);
          }}
        >
          Dismiss tip
        </Button>
      )}
    </Dialog>
  );
}

describe('Dialog after the focused element disappears (adversarial)', () => {
  it('Escape still closes the dialog when the focused control removed itself', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(
      <>
        <button type="button">Behind</button>
        <DialogWithSelfRemovingButton onClose={onClose} />
      </>,
    );
    await user.click(screen.getByRole('button', { name: 'Dismiss tip' }));
    expect(screen.queryByRole('button', { name: 'Dismiss tip' })).not.toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
