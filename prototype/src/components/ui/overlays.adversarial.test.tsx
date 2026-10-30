import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Button } from './Button';
import { ConfirmDialog } from './ConfirmDialog';
import { Dialog } from './Dialog';
import { IconButton } from './IconButton';
import { Menu } from './Menu';
import { TextInput } from './TextInput';
import { Tooltip } from './Tooltip';

afterEach(() => {
  vi.useRealTimers();
});

function MenuOpensDialog() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Menu
        trigger={(p) => <Button {...p}>Actions</Button>}
        items={[
          {
            id: 'rename',
            label: 'Rename',
            onSelect: () => {
              setOpen(true);
            },
          },
          { id: 'delete', label: 'Delete', onSelect: () => undefined, danger: true },
        ]}
      />
      <Dialog
        open={open}
        onClose={() => {
          setOpen(false);
        }}
        title="Rename"
      >
        <TextInput label="Name" />
      </Dialog>
    </>
  );
}

describe('Dialog (adversarial)', () => {
  it('restores focus to the menu trigger when a dialog opened from a menu item closes', async () => {
    const user = userEvent.setup();
    render(<MenuOpensDialog />);
    const trigger = screen.getByRole('button', { name: 'Actions' });
    await user.click(trigger);
    await user.keyboard('{Enter}');
    expect(screen.getByRole('dialog', { name: 'Rename' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Name' })).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('restores focus correctly across repeated open/close cycles', async () => {
    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button
            onClick={() => {
              setOpen(true);
            }}
          >
            Open
          </button>
          <Dialog
            open={open}
            onClose={() => {
              setOpen(false);
            }}
            title="T"
            footer={<button>OK</button>}
          />
        </>
      );
    }
    const user = userEvent.setup();
    render(<Harness />);
    const opener = screen.getByRole('button', { name: 'Open' });
    for (let i = 0; i < 3; i++) {
      await user.click(opener);
      expect(screen.getByRole('button', { name: 'OK' })).toHaveFocus();
      await user.keyboard('{Escape}');
      expect(opener).toHaveFocus();
    }
  });

  it('never lets Tab or Shift+Tab escape to the page behind', async () => {
    function Harness() {
      return (
        <>
          <button>Behind</button>
          <Dialog open onClose={() => undefined} title="Trap" footer={<button>Done</button>}>
            <TextInput label="A" />
            <TextInput label="B" disabled />
            <a href="#x">Link</a>
          </Dialog>
        </>
      );
    }
    const user = userEvent.setup();
    render(<Harness />);
    const dialog = screen.getByRole('dialog');
    for (let i = 0; i < 9; i++) {
      await user.tab();
      expect(dialog.contains(document.activeElement)).toBe(true);
    }
    for (let i = 0; i < 9; i++) {
      await user.tab({ shift: true });
      expect(dialog.contains(document.activeElement)).toBe(true);
    }
  });

  it('closes on Escape even when nothing inside is focusable but the container', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<Dialog open onClose={onClose} title="Bare" />);
    // The header close button is focusable; move focus to the container explicitly.
    act(() => {
      screen.getByRole('dialog').focus();
    });
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('applies the width prop and defaults it', () => {
    const { rerender } = render(<Dialog open onClose={() => undefined} title="W" width={600} />);
    expect(screen.getByRole('dialog').style.width).toBe('600px');
    rerender(<Dialog open onClose={() => undefined} title="W" />);
    expect(screen.getByRole('dialog').style.width).not.toBe('');
  });
});

describe('ConfirmDialog (adversarial)', () => {
  it('exposes its message as the dialog accessible description', () => {
    render(
      <ConfirmDialog
        open
        title="Delete watchlist?"
        message="This removes 12 symbols. This cannot be undone."
        onConfirm={() => undefined}
        onCancel={() => undefined}
      />,
    );
    expect(screen.getByRole('dialog', { name: 'Delete watchlist?' })).toHaveAccessibleDescription(
      'This removes 12 symbols. This cannot be undone.',
    );
  });

  it('re-enables cancel once busy clears and then cancels on Escape', async () => {
    const onCancel = vi.fn();
    const props = {
      open: true,
      title: 'Delete?',
      message: 'Sure?',
      tone: 'danger' as const,
      onConfirm: () => undefined,
      onCancel,
    };
    const user = userEvent.setup();
    const { rerender } = render(<ConfirmDialog {...props} busy />);
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Confirm/ })).toHaveAttribute('aria-busy', 'true');
    rerender(<ConfirmDialog {...props} busy={false} />);
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeEnabled();
    screen.getByRole('button', { name: 'Cancel' }).focus();
    await user.keyboard('{Escape}');
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});

describe('Menu (adversarial)', () => {
  const items = (onSelect = vi.fn()) => [
    { id: 'a', label: 'Alpha', onSelect },
    { id: 'b', label: 'Bravo', onSelect },
    { id: 'c', label: 'Charlie', onSelect, disabled: true },
  ];

  it('opens from the keyboard with Enter on the trigger and wraps ArrowUp past a trailing disabled item', async () => {
    const user = userEvent.setup();
    render(<Menu trigger={(p) => <Button {...p}>Open</Button>} items={items()} />);
    screen.getByRole('button', { name: 'Open' }).focus();
    await user.keyboard('{Enter}');
    expect(screen.getByRole('menuitem', { name: 'Alpha' })).toHaveFocus();
    await user.keyboard('{ArrowUp}');
    expect(screen.getByRole('menuitem', { name: 'Bravo' })).toHaveFocus();
  });

  it('closes on outside click and reports aria-expanded=false', async () => {
    const user = userEvent.setup();
    render(
      <>
        <p>outside</p>
        <Menu trigger={(p) => <Button {...p}>Open</Button>} items={items()} />
      </>,
    );
    const trigger = screen.getByRole('button', { name: 'Open' });
    await user.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    await user.click(screen.getByText('outside'));
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });

  it('works with an IconButton trigger (ref + handlers pass through the tooltip wrapper)', async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(
      <Menu trigger={(p) => <IconButton {...p} label="More" icon={<span />} />} items={items(onSelect)} />,
    );
    const trigger = screen.getByRole('button', { name: 'More' });
    await user.click(trigger);
    await user.keyboard('{ArrowDown}{Enter}');
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('only one of two menus is open at a time', async () => {
    const user = userEvent.setup();
    render(
      <>
        <Menu trigger={(p) => <Button {...p}>One</Button>} items={items()} />
        <Menu trigger={(p) => <Button {...p}>Two</Button>} items={items()} />
      </>,
    );
    await user.click(screen.getByRole('button', { name: 'One' }));
    await user.click(screen.getByRole('button', { name: 'Two' }));
    expect(screen.getAllByRole('menu')).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'One' })).toHaveAttribute('aria-expanded', 'false');
  });
});

describe('Tooltip (adversarial)', () => {
  it('shows on keyboard focus with its content linked by aria-describedby', async () => {
    const user = userEvent.setup();
    render(
      <Tooltip content="Refresh quotes">
        <button>Refresh</button>
      </Tooltip>,
    );
    await user.tab();
    const tip = screen.getByRole('tooltip');
    expect(tip).toHaveTextContent('Refresh quotes');
    expect(screen.getByRole('button', { name: 'Refresh' })).toHaveAccessibleDescription('Refresh quotes');
  });

  it('honours the default 400ms hover delay at the boundary', () => {
    vi.useFakeTimers();
    render(
      <Tooltip content="Hint">
        <button>Target</button>
      </Tooltip>,
    );
    fireEvent.pointerMove(screen.getByRole('button'));
    act(() => {
      vi.advanceTimersByTime(399);
    });
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.getByRole('tooltip')).toHaveTextContent('Hint');
  });

  it('does not leak a pending timer or update after unmounting mid-delay', () => {
    vi.useFakeTimers();
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { unmount } = render(
      <Tooltip content="Hint" delayMs={300}>
        <button>Target</button>
      </Tooltip>,
    );
    fireEvent.pointerMove(screen.getByRole('button'));
    unmount();
    expect(vi.getTimerCount()).toBe(0);
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(errors).not.toHaveBeenCalled();
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('IconButton shows its label as a tooltip on hover after the delay', () => {
    vi.useFakeTimers();
    render(<IconButton label="Settings" icon={<span />} />);
    fireEvent.pointerMove(screen.getByRole('button', { name: 'Settings' }));
    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(screen.getByRole('tooltip')).toHaveTextContent('Settings');
  });
});
