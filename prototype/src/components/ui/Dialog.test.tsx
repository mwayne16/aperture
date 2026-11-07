import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState, type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { ConfirmDialog } from './ConfirmDialog';
import { Dialog } from './Dialog';
import { Tooltip } from './Tooltip';

function Harness({
  children,
  footer,
  description,
  onClose,
}: {
  children?: ReactNode;
  footer?: ReactNode;
  description?: string;
  onClose?: () => void;
}) {
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
      <button>Outside</button>
      <Dialog
        open={open}
        onClose={() => {
          onClose?.();
          setOpen(false);
        }}
        title="Rename watchlist"
        description={description}
        footer={footer}
      >
        {children}
      </Dialog>
    </>
  );
}

const fields = (
  <>
    <input aria-label="Name" />
    <input aria-label="Disabled" disabled />
    <button>Middle</button>
  </>
);
const footer = (
  <>
    <button>Cancel</button>
    <button>Save</button>
  </>
);

async function openDialog(ui: ReactNode = <Harness footer={footer}>{fields}</Harness>) {
  const user = userEvent.setup();
  render(ui);
  await user.click(screen.getByRole('button', { name: 'Open' }));
  return { user, dialog: screen.getByRole('dialog') };
}

describe('Dialog', () => {
  it('renders nothing while closed', () => {
    render(<Dialog open={false} onClose={vi.fn()} title="Hidden" />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('adds no banner or contentinfo landmark of its own', async () => {
    const { dialog } = await openDialog();
    expect(within(dialog).queryByRole('banner')).not.toBeInTheDocument();
    expect(within(dialog).queryByRole('contentinfo')).not.toBeInTheDocument();
    expect(dialog.querySelector('.ui-dialog__header')).toHaveTextContent('Rename watchlist');
    expect(
      within(dialog.querySelector<HTMLElement>('.ui-dialog__footer')!).getAllByRole('button'),
    ).toHaveLength(2);
  });

  it('is a labelled modal portaled to document.body', async () => {
    const { dialog } = await openDialog(
      <Harness description="Shown in the sidebar." footer={footer}>
        {fields}
      </Harness>,
    );
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAccessibleName('Rename watchlist');
    expect(dialog).toHaveAccessibleDescription('Shown in the sidebar.');
    expect(dialog.closest('#root')).toBeNull();
    expect(dialog.parentElement?.parentElement).toBe(document.body);
  });

  it('omits aria-describedby without a description', async () => {
    const { dialog } = await openDialog();
    expect(dialog).not.toHaveAttribute('aria-describedby');
  });

  it('adds caller-supplied aria-describedby ids after the description', () => {
    render(
      <Dialog open onClose={vi.fn()} title="Export" description="CSV, UTF-8." aria-describedby="extra">
        <p id="extra">Includes 40 rows.</p>
      </Dialog>,
    );
    expect(screen.getByRole('dialog')).toHaveAccessibleDescription('CSV, UTF-8. Includes 40 rows.');
  });

  it('uses caller-supplied aria-describedby on its own', () => {
    render(
      <Dialog open onClose={vi.fn()} title="Export" aria-describedby="extra">
        <p id="extra">Includes 40 rows.</p>
      </Dialog>,
    );
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-describedby', 'extra');
    expect(screen.getByRole('dialog')).toHaveAccessibleDescription('Includes 40 rows.');
  });

  it('moves focus to the first focusable element in the body', async () => {
    await openDialog();
    expect(screen.getByRole('textbox', { name: 'Name' })).toHaveFocus();
  });

  it('prefers an element marked data-autofocus', async () => {
    await openDialog(
      <Harness
        footer={
          <>
            <button>Cancel</button>
            <button data-autofocus>Save</button>
          </>
        }
      >
        {fields}
      </Harness>,
    );
    expect(screen.getByRole('button', { name: 'Save' })).toHaveFocus();
  });

  it('respects autoFocus inside the content and still restores focus to the opener', async () => {
    const { user } = await openDialog(
      <Harness footer={footer}>
        <input aria-label="First" />
        <input aria-label="Second" autoFocus />
      </Harness>,
    );
    expect(screen.getByRole('textbox', { name: 'Second' })).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(screen.getByRole('button', { name: 'Open' })).toHaveFocus();
  });

  it('falls back to the first footer control when the body has nothing focusable', async () => {
    await openDialog(<Harness footer={footer}>Just text</Harness>);
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus();
  });

  it('focuses the dialog container when nothing inside is focusable', async () => {
    const { dialog } = await openDialog(<Harness>Just text</Harness>);
    expect(dialog).toHaveFocus();
  });

  it('traps Tab and Shift+Tab inside the dialog, skipping disabled controls', async () => {
    const { user, dialog } = await openDialog();
    const name = within(dialog).getByRole('textbox', { name: 'Name' });
    const middle = within(dialog).getByRole('button', { name: 'Middle' });
    const save = within(dialog).getByRole('button', { name: 'Save' });
    const close = within(dialog).getByRole('button', { name: 'Close' });

    expect(name).toHaveFocus();
    await user.tab();
    expect(middle).toHaveFocus();
    await user.tab();
    await user.tab();
    expect(save).toHaveFocus();
    await user.tab(); // wraps from last to first (the close button in the header)
    expect(close).toHaveFocus();
    await user.tab({ shift: true }); // and back from first to last
    expect(save).toHaveFocus();
    // The modal hides the page behind it from assistive tech.
    expect(screen.getByRole('button', { name: 'Outside', hidden: true })).not.toHaveFocus();
  });

  it('keeps Tab inside around a trailing radio group with nothing checked', async () => {
    const { user, dialog } = await openDialog(
      <Harness>
        <input aria-label="Name" />
        <input type="radio" name="dir" aria-label="Above" />
        <input type="radio" name="dir" aria-label="Below" />
      </Harness>,
    );
    const close = within(dialog).getByRole('button', { name: 'Close' });
    // Shift+Tab enters an unchecked group at its last radio.
    close.focus();
    await user.tab({ shift: true });
    expect(screen.getByRole('radio', { name: 'Below' })).toHaveFocus();
    // Radix wraps only from the last radio, so Tab from the first one stays where it is, inside.
    screen.getByRole('radio', { name: 'Above' }).focus();
    await user.tab();
    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  it('starts focus on the checked radio of a group, not the first radio', async () => {
    await openDialog(
      <Harness>
        <input type="radio" name="dir" aria-label="Above" />
        <input type="radio" name="dir" aria-label="Below" defaultChecked />
      </Harness>,
    );
    expect(screen.getByRole('radio', { name: 'Below' })).toHaveFocus();
  });

  it('cycles Tab on the close button when it is the only focusable element', async () => {
    const user = userEvent.setup();
    render(<Dialog open onClose={vi.fn()} title="T" />);
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveFocus();
    const close = within(dialog).getByRole('button', { name: 'Close' });
    await user.tab();
    expect(close).toHaveFocus();
    await user.tab();
    expect(close).toHaveFocus();
  });

  it('closes on Escape and restores focus to the opener', async () => {
    const onClose = vi.fn();
    const { user } = await openDialog(
      <Harness footer={footer} onClose={onClose}>
        {fields}
      </Harness>,
    );
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open' })).toHaveFocus();
  });

  it('closes from the header close button', async () => {
    const { user } = await openDialog();
    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open' })).toHaveFocus();
  });

  it('closes on a backdrop click but not on clicks inside the panel', async () => {
    const onClose = vi.fn();
    const { user, dialog } = await openDialog(
      <Harness footer={footer} onClose={onClose}>
        {fields}
      </Harness>,
    );
    await user.click(within(dialog).getByRole('heading', { name: 'Rename watchlist' }));
    await user.click(dialog);
    expect(onClose).not.toHaveBeenCalled();

    const backdrop = dialog.parentElement!;
    await user.click(backdrop);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does not close when a press starts inside and is released on the backdrop', async () => {
    const onClose = vi.fn();
    const { user, dialog } = await openDialog(
      <Harness footer={footer} onClose={onClose}>
        {fields}
      </Harness>,
    );
    const backdrop = dialog.parentElement!;
    await user.pointer([
      { keys: '[MouseLeft>]', target: within(dialog).getByRole('textbox', { name: 'Name' }) },
      { keys: '[/MouseLeft]', target: backdrop },
    ]);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('closes only the innermost dialog on Escape', async () => {
    function Nested() {
      const [outer, setOuter] = useState(true);
      const [inner, setInner] = useState(false);
      return (
        <Dialog
          open={outer}
          onClose={() => {
            setOuter(false);
          }}
          title="Outer"
        >
          <button
            onClick={() => {
              setInner(true);
            }}
          >
            Open inner
          </button>
          <Dialog
            open={inner}
            onClose={() => {
              setInner(false);
            }}
            title="Inner"
          >
            <button>Inner action</button>
          </Dialog>
        </Dialog>
      );
    }
    const user = userEvent.setup();
    render(<Nested />);
    await user.click(screen.getByRole('button', { name: 'Open inner' }));
    // The outer dialog is hidden from assistive tech while the inner one is open.
    expect(screen.getAllByRole('dialog', { hidden: true })).toHaveLength(2);

    await user.keyboard('{Escape}');
    expect(screen.getByRole('dialog')).toHaveAccessibleName('Outer');
    expect(screen.getByRole('button', { name: 'Open inner' })).toHaveFocus();
  });

  it('restores focus when the parent unmounts it via open=false', async () => {
    function Controlled() {
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
            footer={
              <button
                onClick={() => {
                  setOpen(false);
                }}
              >
                Done
              </button>
            }
          />
        </>
      );
    }
    const user = userEvent.setup();
    render(<Controlled />);
    await user.click(screen.getByRole('button', { name: 'Open' }));
    await user.click(screen.getByRole('button', { name: 'Done' }));
    expect(screen.getByRole('button', { name: 'Open' })).toHaveFocus();
  });

  it('leaves focus where the close handler moved it once the dialog closed', async () => {
    const user = userEvent.setup();
    render(
      <Harness
        onClose={() => {
          // The focus trap holds until the dialog unmounts, so focus moves after the close renders.
          setTimeout(() => {
            screen.getByRole('button', { name: 'Outside' }).focus();
          });
        }}
      >
        {fields}
      </Harness>,
    );
    await user.click(screen.getByRole('button', { name: 'Open' }));
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Outside' })).toHaveFocus();
  });
});

describe('Dialog keyboard ownership', () => {
  function NestedOpen({
    onOuterClose,
    onInnerClose,
  }: {
    onOuterClose: () => void;
    onInnerClose: () => void;
  }) {
    const [outer, setOuter] = useState(true);
    const [inner, setInner] = useState(true);
    return (
      <Dialog
        open={outer}
        onClose={() => {
          onOuterClose();
          setOuter(false);
        }}
        title="Outer"
        footer={<button>Outer save</button>}
      >
        <button>Outer field</button>
        <Dialog
          open={inner}
          onClose={() => {
            onInnerClose();
            setInner(false);
          }}
          title="Inner"
          footer={<button>Inner ok</button>}
        >
          <button>Inner field</button>
        </Dialog>
      </Dialog>
    );
  }

  function blurActive() {
    (document.activeElement as HTMLElement | null)?.blur();
    expect(document.activeElement).toBe(document.body);
  }

  it('gives focus to the inner dialog when both open in the same render', () => {
    render(<NestedOpen onOuterClose={vi.fn()} onInnerClose={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Inner field' })).toHaveFocus();
  });

  it('keeps Tab cycling inside the inner dialog when both open in the same render', async () => {
    const user = userEvent.setup();
    render(<NestedOpen onOuterClose={vi.fn()} onInnerClose={vi.fn()} />);
    const inner = screen.getByRole('dialog', { name: 'Inner' });
    for (let i = 0; i < 5; i++) {
      await user.tab();
      expect(inner.contains(document.activeElement)).toBe(true);
    }
    for (let i = 0; i < 5; i++) {
      await user.tab({ shift: true });
      expect(inner.contains(document.activeElement)).toBe(true);
    }
  });

  it('closes the inner dialog, then the outer one, on Escape with focus on <body>', async () => {
    const onOuterClose = vi.fn();
    const onInnerClose = vi.fn();
    const user = userEvent.setup();
    render(<NestedOpen onOuterClose={onOuterClose} onInnerClose={onInnerClose} />);
    blurActive();
    await user.keyboard('{Escape}');
    expect(onInnerClose).toHaveBeenCalledTimes(1);
    expect(onOuterClose).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toHaveAccessibleName('Outer');

    blurActive();
    await user.keyboard('{Escape}');
    expect(onOuterClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('moves focus from <body> into the top dialog on Tab and Shift+Tab', async () => {
    const user = userEvent.setup();
    render(<NestedOpen onOuterClose={vi.fn()} onInnerClose={vi.fn()} />);
    const inner = screen.getByRole('dialog', { name: 'Inner' });
    // Radix returns focus to the element that last had it inside the top dialog.
    blurActive();
    await user.tab();
    expect(inner.contains(document.activeElement)).toBe(true);
    blurActive();
    await user.tab({ shift: true });
    expect(inner.contains(document.activeElement)).toBe(true);
  });

  it('ignores an Escape that a layer inside the dialog already handled', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(
      <Dialog open onClose={onClose} title="Search">
        <Tooltip content="Clears the query">
          <button>Clear</button>
        </Tooltip>
      </Dialog>,
    );
    // Tab wraps to the close button and back, and keyboard focus shows the tooltip on top.
    await user.tab();
    await user.tab();
    expect(screen.getByRole('tooltip')).toHaveTextContent('Clears the query');
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('stops responding to keys once closed', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    const { rerender } = render(<Dialog open onClose={onClose} title="Once" />);
    rerender(<Dialog open={false} onClose={onClose} title="Once" />);
    blurActive();
    await user.keyboard('{Escape}');
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe('ConfirmDialog', () => {
  function renderConfirm(props: Partial<Parameters<typeof ConfirmDialog>[0]> = {}) {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    const user = userEvent.setup();
    const utils = render(
      <ConfirmDialog
        open
        title="Delete alert?"
        message="This can't be undone."
        onConfirm={onConfirm}
        onCancel={onCancel}
        {...props}
      />,
    );
    return { ...utils, user, onConfirm, onCancel };
  }

  it('starts focus on Cancel so Enter does not confirm by accident', async () => {
    const { user, onConfirm, onCancel } = renderConfirm({ tone: 'danger', confirmLabel: 'Delete' });
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('confirms with the confirm button and uses the default label', async () => {
    const { user, onConfirm } = renderConfirm();
    await user.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('renders the message and a danger button for the danger tone', () => {
    renderConfirm({ tone: 'danger', confirmLabel: 'Delete' });
    expect(screen.getByText("This can't be undone.")).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete' })).toHaveClass('ui-btn--danger');
  });

  it('cancels on Escape', async () => {
    const { user, onCancel } = renderConfirm();
    await user.keyboard('{Escape}');
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('ignores cancel, Escape and repeated confirms while busy', async () => {
    const { user, onCancel, onConfirm } = renderConfirm({ busy: true });
    const confirm = screen.getByRole('button', { name: 'Confirm' });
    expect(confirm).toBeDisabled();
    expect(confirm).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();

    await user.keyboard('{Escape}');
    await user.click(confirm);
    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(onCancel).not.toHaveBeenCalled();
    expect(onConfirm).not.toHaveBeenCalled();
    // With both footer buttons disabled, focus still lands inside the dialog.
    expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(true);
  });

  it('uses the message as the accessible description', () => {
    renderConfirm();
    expect(screen.getByRole('dialog', { name: 'Delete alert?' })).toHaveAccessibleDescription(
      "This can't be undone.",
    );
  });

  it('keeps focus inside the dialog while busy and returns it to Cancel afterwards', async () => {
    const { user, rerender, onConfirm, onCancel } = renderConfirm();
    const props = {
      open: true,
      title: 'Delete alert?',
      message: "This can't be undone.",
      onConfirm,
      onCancel,
    };
    await user.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(screen.getByRole('button', { name: 'Confirm' })).toHaveFocus();

    rerender(<ConfirmDialog {...props} busy />);
    // The focused Confirm button is now disabled; focus moves to the dialog, not <body>.
    expect(screen.getByRole('dialog')).toHaveFocus();

    rerender(<ConfirmDialog {...props} busy={false} />);
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus();
  });

  it('recovers focus that a browser dropped to <body> when busy disabled the buttons', () => {
    const { rerender, onConfirm, onCancel } = renderConfirm();
    const props = {
      open: true,
      title: 'Delete alert?',
      message: "This can't be undone.",
      onConfirm,
      onCancel,
    };
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus();
    // jsdom keeps focus on a button that becomes disabled; browsers blur it to <body>.
    screen.getByRole('button', { name: 'Cancel' }).blur();
    expect(document.body).toHaveFocus();

    rerender(<ConfirmDialog {...props} busy />);
    expect(screen.getByRole('dialog')).toHaveFocus();
  });

  it('leaves focus alone when busy toggles while an enabled control is focused', () => {
    const { rerender, onConfirm, onCancel } = renderConfirm();
    const props = {
      open: true,
      title: 'Delete alert?',
      message: "This can't be undone.",
      onConfirm,
      onCancel,
    };
    screen.getByRole('button', { name: 'Close' }).focus();
    rerender(<ConfirmDialog {...props} busy />);
    expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus();
    rerender(<ConfirmDialog {...props} busy={false} />);
    expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus();
  });
});
