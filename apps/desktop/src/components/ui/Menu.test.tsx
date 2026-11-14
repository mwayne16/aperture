import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { Dialog } from './Dialog';
import { Menu, type MenuItem } from './Menu';

function makeItems() {
  const select = {
    watch: vi.fn(),
    alert: vi.fn(),
    export: vi.fn(),
    copy: vi.fn(),
    remove: vi.fn(),
  };
  const items: MenuItem[] = [
    { id: 'watch', label: 'Add to watchlist', onSelect: select.watch },
    { id: 'alert', label: 'Create alert', onSelect: select.alert },
    { id: 'export', label: 'Export CSV', onSelect: select.export, disabled: true },
    { id: 'copy', label: 'Copy symbol', onSelect: select.copy },
    { id: 'remove', label: 'Remove', onSelect: select.remove, danger: true },
  ];
  return { items, select };
}

function setup(itemsOverride?: MenuItem[]) {
  const { items, select } = makeItems();
  const user = userEvent.setup();
  render(
    <>
      <Menu
        items={itemsOverride ?? items}
        trigger={(props) => (
          <button type="button" {...props}>
            Actions
          </button>
        )}
      />
      <button type="button">Elsewhere</button>
    </>,
  );
  const trigger = screen.getByRole('button', { name: 'Actions' });
  return { user, trigger, select };
}

const item = (name: string) => screen.getByRole('menuitem', { name });

describe('Menu', () => {
  it('wires the trigger with aria-haspopup and aria-expanded', async () => {
    const { user, trigger } = setup();
    expect(trigger).toHaveAttribute('aria-haspopup', 'menu');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();

    await user.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('menu')).toBeInTheDocument();
    expect(screen.getAllByRole('menuitem')).toHaveLength(5);
  });

  it('focuses the first enabled item on open, also when opened from the keyboard', async () => {
    const { user, trigger } = setup();
    trigger.focus();
    await user.keyboard('{Enter}');
    expect(item('Add to watchlist')).toHaveFocus();
  });

  it('skips a leading disabled item when focusing on open', async () => {
    const { items } = makeItems();
    const reordered = [items[2]!, ...items.filter((_, i) => i !== 2)];
    const { user, trigger } = setup(reordered);
    await user.click(trigger);
    expect(item('Add to watchlist')).toHaveFocus();
  });

  it('moves with arrows, skipping disabled items and wrapping at both ends', async () => {
    const { user, trigger } = setup();
    await user.click(trigger);
    await user.keyboard('{ArrowDown}');
    expect(item('Create alert')).toHaveFocus();
    await user.keyboard('{ArrowDown}'); // skips "Export CSV"
    expect(item('Copy symbol')).toHaveFocus();
    await user.keyboard('{ArrowDown}{ArrowDown}'); // Remove, then wrap
    expect(item('Add to watchlist')).toHaveFocus();
    await user.keyboard('{ArrowUp}'); // wrap backwards
    expect(item('Remove')).toHaveFocus();
    await user.keyboard('{ArrowUp}{ArrowUp}'); // Copy, skip Export, Create
    expect(item('Create alert')).toHaveFocus();
  });

  it('jumps with Home and End', async () => {
    const { user, trigger } = setup();
    await user.click(trigger);
    await user.keyboard('{End}');
    expect(item('Remove')).toHaveFocus();
    await user.keyboard('{Home}');
    expect(item('Add to watchlist')).toHaveFocus();
  });

  it('jumps to the next item starting with a typed letter, skipping disabled ones', async () => {
    const { user, trigger } = setup();
    await user.click(trigger);
    await user.keyboard('c');
    expect(item('Create alert')).toHaveFocus();
    await user.keyboard('c');
    expect(item('Copy symbol')).toHaveFocus();
    await user.keyboard('e'); // only "Export CSV" matches, and it is disabled
    expect(item('Copy symbol')).toHaveFocus();
  });

  it('selects with Enter, closes, and returns focus to the trigger', async () => {
    const { user, trigger, select } = setup();
    await user.click(trigger);
    await user.keyboard('{ArrowDown}{Enter}');
    expect(select.alert).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(trigger).toHaveFocus();
  });

  it('selects with Space and with a click', async () => {
    const { user, trigger, select } = setup();
    await user.click(trigger);
    await user.keyboard(' ');
    expect(select.watch).toHaveBeenCalledTimes(1);

    await user.click(trigger);
    await user.click(item('Remove'));
    expect(select.remove).toHaveBeenCalledTimes(1);
  });

  it('does not select disabled items', async () => {
    const { user, trigger, select } = setup();
    await user.click(trigger);
    expect(item('Export CSV')).toBeDisabled();
    await user.click(item('Export CSV'));
    expect(select.export).not.toHaveBeenCalled();
    expect(screen.getByRole('menu')).toBeInTheDocument();
  });

  it('closes on Escape and restores focus to the trigger', async () => {
    const { user, trigger, select } = setup();
    await user.click(trigger);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    expect(Object.values(select).every((fn) => fn.mock.calls.length === 0)).toBe(true);
  });

  it('closes on Tab and keeps focus on the trigger', async () => {
    const { user, trigger } = setup();
    await user.click(trigger);
    await user.tab();
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('closes on an outside click without stealing focus', async () => {
    const { user, trigger } = setup();
    await user.click(trigger);
    await user.click(screen.getByRole('button', { name: 'Elsewhere' }));
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Elsewhere' })).toHaveFocus();
  });

  it('toggles closed when the trigger is clicked again', async () => {
    const { user, trigger } = setup();
    await user.click(trigger);
    await user.click(trigger);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    await user.click(trigger);
    expect(screen.getByRole('menu')).toBeInTheDocument();
  });

  it('marks danger items', async () => {
    const { user, trigger } = setup();
    await user.click(trigger);
    expect(item('Remove')).toHaveClass('is-danger');
    expect(item('Copy symbol')).not.toHaveClass('is-danger');
  });

  it('focuses the menu itself when every item is disabled', async () => {
    const { user, trigger } = setup([{ id: 'a', label: 'Nope', onSelect: vi.fn(), disabled: true }]);
    await user.click(trigger);
    expect(screen.getByRole('menu')).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('menu')).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(trigger).toHaveFocus();
  });

  it('closes only itself on Escape inside a dialog', async () => {
    function InDialog() {
      const [open, setOpen] = useState(true);
      return (
        <Dialog
          open={open}
          onClose={() => {
            setOpen(false);
          }}
          title="Edit"
        >
          <Menu
            items={[{ id: 'a', label: 'Alpha', onSelect: vi.fn() }]}
            trigger={(props) => (
              <button type="button" {...props}>
                More
              </button>
            )}
          />
        </Dialog>
      );
    }
    const user = userEvent.setup();
    render(<InDialog />);
    await user.click(screen.getByRole('button', { name: 'More' }));
    expect(screen.getByRole('menuitem', { name: 'Alpha' })).toHaveFocus();

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'More' })).toHaveFocus();
  });

  it('selecting an item inside a dialog does not close the dialog', async () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(
      <Dialog open onClose={onClose} title="Edit">
        <Menu
          items={[{ id: 'a', label: 'Alpha', onSelect }]}
          trigger={(props) => (
            <button type="button" {...props}>
              More
            </button>
          )}
        />
      </Dialog>,
    );
    await user.click(screen.getByRole('button', { name: 'More' }));
    await user.click(screen.getByRole('menuitem', { name: 'Alpha' }));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
  });
});
