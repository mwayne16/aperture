import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Button } from './Button';
import { Dialog } from './Dialog';

// The spec requires a focus trap. A trap has to follow the browser's real tab stops, which are not
// the same as "every enabled control": only one radio of a native group is a tab stop, and controls
// inside a disabled fieldset are disabled.

function RadioDialog() {
  return (
    <>
      <button>page before</button>
      <Dialog open onClose={vi.fn()} title="Alert condition">
        <input aria-label="Threshold" />
        <fieldset>
          <legend>Trigger when price is</legend>
          <label>
            <input type="radio" name="dir" value="above" defaultChecked /> Above
          </label>
          <label>
            <input type="radio" name="dir" value="below" /> Below
          </label>
        </fieldset>
      </Dialog>
      <button>page after</button>
    </>
  );
}

describe('Dialog focus trap with native tab-stop rules (adversarial)', () => {
  it('Tab from the checked radio (the last tab stop) stays inside the dialog', async () => {
    const user = userEvent.setup();
    render(<RadioDialog />);
    const dialog = screen.getByRole('dialog');
    screen.getByRole('radio', { name: 'Above' }).focus();
    await user.tab();
    // Radix wraps only from its last candidate (the unchecked radio), so focus stays put inside.
    expect(dialog).toContainElement(document.activeElement as HTMLElement);
  });

  it('Shift+Tab from the first control wraps inside the dialog', async () => {
    const user = userEvent.setup();
    render(<RadioDialog />);
    const dialog = screen.getByRole('dialog');
    within(dialog).getByRole('button', { name: 'Close' }).focus();
    await user.tab({ shift: true });
    // Radix wraps to the last radio in DOM order rather than to the checked one.
    expect(dialog).toContainElement(document.activeElement as HTMLElement);
  });

  it('a full Tab cycle never leaves the dialog', async () => {
    const user = userEvent.setup();
    render(<RadioDialog />);
    const dialog = screen.getByRole('dialog');
    for (let i = 0; i < 6; i++) {
      await user.tab();
      expect(dialog).toContainElement(document.activeElement as HTMLElement);
    }
    for (let i = 0; i < 6; i++) {
      await user.tab({ shift: true });
      expect(dialog).toContainElement(document.activeElement as HTMLElement);
    }
  });

  it('ignores controls inside a disabled fieldset when finding the last tab stop', async () => {
    const user = userEvent.setup();
    render(
      <>
        <button>page before</button>
        <Dialog open onClose={vi.fn()} title="Settings" footer={<Button>Save</Button>}>
          <input aria-label="Name" />
          <fieldset disabled>
            <legend>Advanced</legend>
            <input aria-label="Locked" />
          </fieldset>
        </Dialog>
      </>,
    );
    const dialog = screen.getByRole('dialog');
    // The disabled fieldset sits in the middle here, so both directions must still wrap inside.
    within(dialog).getByRole('button', { name: 'Save' }).focus();
    await user.tab();
    expect(dialog).toContainElement(document.activeElement as HTMLElement);
    within(dialog).getByRole('button', { name: 'Close' }).focus();
    await user.tab({ shift: true });
    expect(within(dialog).getByRole('button', { name: 'Save' })).toHaveFocus();
  });

  it('a disabled fieldset at the very end does not let Tab escape', async () => {
    const user = userEvent.setup();
    render(
      <>
        <button>page before</button>
        <Dialog open onClose={vi.fn()} title="Filters">
          <input aria-label="Symbol filter" />
          <fieldset disabled>
            <legend>Pro filters</legend>
            <button type="button">Apply pro filter</button>
          </fieldset>
        </Dialog>
      </>,
    );
    const dialog = screen.getByRole('dialog');
    screen.getByRole('textbox', { name: 'Symbol filter' }).focus();
    await user.tab();
    // Radix counts the fieldset's button as the last candidate, so focus stays put inside.
    expect(dialog).toContainElement(document.activeElement as HTMLElement);
  });
});
