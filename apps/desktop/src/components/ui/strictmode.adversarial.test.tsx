/*
 * Round 2 adversarial tests: the app mounts under <StrictMode> (src/main.tsx), so React
 * double-invokes effects in development. The overlay contracts (focus moves inside, autoFocus is
 * respected, focus returns to the opener) must hold there too, not only in a plain render.
 */
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode, useState, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Button } from './Button';
import { ConfirmDialog } from './ConfirmDialog';
import { Dialog } from './Dialog';
import { Menu } from './Menu';
import { SegmentedControl } from './SegmentedControl';
import { dismissAllToasts, showToast } from './toastStore';
import { ToastViewport } from './ToastViewport';

afterEach(() => {
  act(() => {
    dismissAllToasts();
  });
});

function strict(node: ReactNode) {
  return render(<StrictMode>{node}</StrictMode>);
}

function DialogWithAutoFocusOnSecondField() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        onClick={() => {
          setOpen(true);
        }}
      >
        Open
      </Button>
      <Dialog
        open={open}
        onClose={() => {
          setOpen(false);
        }}
        title="Edit alert"
      >
        <input aria-label="Symbol" />
        <input aria-label="Price" autoFocus />
      </Dialog>
    </>
  );
}

describe('overlays under StrictMode (adversarial)', () => {
  it('Dialog keeps focus on an autoFocus field that is not the first focusable', async () => {
    const user = userEvent.setup();
    strict(<DialogWithAutoFocusOnSecondField />);
    await user.click(screen.getByRole('button', { name: 'Open' }));
    expect(screen.getByRole('dialog', { name: 'Edit alert' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Price' })).toHaveFocus();
  });

  it('Dialog does not bounce focus back to the opener while it opens', async () => {
    const user = userEvent.setup();
    strict(<DialogWithAutoFocusOnSecondField />);
    const opener = screen.getByRole('button', { name: 'Open' });
    let focusCount = 0;
    opener.addEventListener('focus', () => {
      focusCount += 1;
    });
    await user.click(opener); // the click itself focuses the opener once
    expect(focusCount).toBe(1);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('Dialog still restores focus to the opener on Escape', async () => {
    const user = userEvent.setup();
    strict(<DialogWithAutoFocusOnSecondField />);
    const opener = screen.getByRole('button', { name: 'Open' });
    await user.click(opener);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });

  it('ConfirmDialog starts on Cancel and Escape cancels', async () => {
    const user = userEvent.setup();
    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <Button
            onClick={() => {
              setOpen(true);
            }}
          >
            Remove
          </Button>
          <ConfirmDialog
            open={open}
            title="Remove AAPL?"
            message="It will be removed from the watchlist."
            tone="danger"
            confirmLabel="Remove"
            onConfirm={() => {
              setOpen(false);
            }}
            onCancel={() => {
              setOpen(false);
            }}
          />
        </>
      );
    }
    strict(<Harness />);
    const opener = screen.getByRole('button', { name: 'Remove' });
    await user.click(opener);
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });

  it('Menu opens on the first enabled item, navigates, and Escape returns to the trigger', async () => {
    const user = userEvent.setup();
    strict(
      <Menu
        trigger={(p) => <Button {...p}>Actions</Button>}
        items={[
          { id: 'a', label: 'Alpha', onSelect: () => undefined, disabled: true },
          { id: 'b', label: 'Bravo', onSelect: () => undefined },
          { id: 'c', label: 'Charlie', onSelect: () => undefined },
        ]}
      />,
    );
    const trigger = screen.getByRole('button', { name: 'Actions' });
    await user.click(trigger);
    expect(screen.getByRole('menuitem', { name: 'Bravo' })).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('menuitem', { name: 'Charlie' })).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });

  it('SegmentedControl arrow keys report exactly one change per key press', async () => {
    const user = userEvent.setup();
    const changes: string[] = [];
    function Harness() {
      const [value, setValue] = useState<'1D' | '5D' | '1M'>('1D');
      return (
        <SegmentedControl
          aria-label="Range"
          value={value}
          onChange={(v) => {
            changes.push(v);
            setValue(v);
          }}
          options={[
            { value: '1D', label: '1D' },
            { value: '5D', label: '5D', title: 'Five days' },
            { value: '1M', label: '1M' },
          ]}
        />
      );
    }
    strict(<Harness />);
    await user.tab();
    await user.keyboard('{ArrowRight}{ArrowRight}{ArrowRight}{ArrowLeft}');
    expect(changes).toEqual(['5D', '1M', '1D', '1M']);
    expect(screen.getByRole('radio', { name: '1M' })).toHaveAttribute('aria-checked', 'true');
  });

  it('ToastViewport renders and auto-dismisses toasts under StrictMode', () => {
    vi.useFakeTimers();
    try {
      strict(<ToastViewport />);
      act(() => {
        showToast({ tone: 'success', title: 'Alert saved', durationMs: 50 });
      });
      expect(screen.getByText('Alert saved')).toBeInTheDocument();
      act(() => {
        vi.advanceTimersByTime(49);
      });
      expect(screen.getByText('Alert saved')).toBeInTheDocument();
      act(() => {
        vi.advanceTimersByTime(1);
      });
      expect(screen.queryByText('Alert saved')).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });
});
