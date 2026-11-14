import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Button } from './Button';
import { Dialog } from './Dialog';

// The spec requires a focus trap. Tab must never move focus out of an open dialog, whatever
// legitimate content the dialog holds: programmatically focusable regions (tabindex="-1"),
// collapsible <details> sections, and controls hidden with CSS.

function isInside(dialog: HTMLElement): boolean {
  return dialog.contains(document.activeElement);
}

describe('Dialog focus trap with non-button content (adversarial)', () => {
  it('Tab from a focused tabindex="-1" region after the last control stays in the dialog', async () => {
    const user = userEvent.setup();
    render(
      <>
        <button>page behind</button>
        <Dialog open onClose={vi.fn()} title="Order log">
          <Button>Refresh</Button>
          {/* A scroll region focused by a click so arrow keys scroll it. */}
          <div tabIndex={-1} data-testid="log">
            09:30 AAPL 189.12
          </div>
        </Dialog>
      </>,
    );
    const dialog = screen.getByRole('dialog');
    await user.click(screen.getByTestId('log'));
    expect(screen.getByTestId('log')).toHaveFocus();

    await user.tab();
    // Radix wraps only from the last tab stop, so focus returns to the region, inside the dialog.
    expect(isInside(dialog)).toBe(true);
  });

  it('a <details> summary at the end is a real tab stop: Tab reaches it and wraps from it', async () => {
    const user = userEvent.setup();
    render(
      <>
        <button>page behind</button>
        <Dialog open onClose={vi.fn()} title="Alert settings">
          <input aria-label="Threshold" />
          <details>
            <summary>Advanced</summary>
            <p>Cooldown and repeat options.</p>
          </details>
        </Dialog>
      </>,
    );
    const dialog = screen.getByRole('dialog');
    screen.getByRole('textbox', { name: 'Threshold' }).focus();

    await user.tab();
    expect(screen.getByText('Advanced')).toHaveFocus();

    await user.tab();
    expect(isInside(dialog)).toBe(true);
    expect(within(dialog).getByRole('button', { name: 'Close' })).toHaveFocus();
  });

  it('Tab from the last visible control wraps even when a CSS-hidden control follows it', async () => {
    const user = userEvent.setup();
    render(
      <>
        <button>page behind</button>
        <Dialog open onClose={vi.fn()} title="Columns">
          <Button>Apply</Button>
          <div style={{ display: 'none' }}>
            <Button>Reset widths</Button>
          </div>
        </Dialog>
      </>,
    );
    const dialog = screen.getByRole('dialog');
    screen.getByRole('button', { name: 'Apply' }).focus();

    await user.tab();
    expect(isInside(dialog)).toBe(true);
    expect(within(dialog).getByRole('button', { name: 'Close' })).toHaveFocus();
  });

  it('Shift+Tab from the first control wraps to the last visible control, not a hidden one', async () => {
    const user = userEvent.setup();
    render(
      <>
        <button>page behind</button>
        <Dialog open onClose={vi.fn()} title="Columns">
          <Button>Apply</Button>
          <div style={{ visibility: 'hidden' }}>
            <Button>Reset widths</Button>
          </div>
        </Dialog>
      </>,
    );
    const dialog = screen.getByRole('dialog');
    within(dialog).getByRole('button', { name: 'Close' }).focus();

    await user.tab({ shift: true });
    expect(screen.getByRole('button', { name: 'Apply' })).toHaveFocus();
  });

  it('moves focus into the dialog on open even when the first control is hidden with CSS', async () => {
    const user = userEvent.setup();
    function Harness() {
      return (
        <Dialog open onClose={vi.fn()} title="Columns">
          <div style={{ display: 'none' }}>
            <Button>Reset widths</Button>
          </div>
          <Button>Apply</Button>
        </Dialog>
      );
    }
    const { rerender } = render(<button>Open columns</button>);
    await user.click(screen.getByRole('button', { name: 'Open columns' }));
    rerender(
      <>
        <button>Open columns</button>
        <Harness />
      </>,
    );
    const dialog = screen.getByRole('dialog');
    expect(isInside(dialog)).toBe(true);
    expect(screen.getByRole('button', { name: 'Apply' })).toHaveFocus();
  });
});
