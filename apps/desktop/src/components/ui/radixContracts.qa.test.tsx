/*
 * QA for the public props and keyboard contracts of the primitives that now sit on Radix. Each
 * test drives one component the way a feature screen would, under <StrictMode> like the app.
 */
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode, useState, type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { Button } from './Button';
import { ConfirmDialog } from './ConfirmDialog';
import { Dialog } from './Dialog';
import { IconButton } from './IconButton';
import { Menu, type MenuItem } from './Menu';
import { SegmentedControl, type SegmentedOption } from './SegmentedControl';
import { Switch } from './Switch';
import { Tabs } from './Tabs';
import { Tooltip } from './Tooltip';

function strict(node: ReactNode) {
  return render(<StrictMode>{node}</StrictMode>);
}

describe('Dialog and ConfirmDialog props (QA)', () => {
  it('names the dialog by its title and describes it by description plus aria-describedby, in order', () => {
    strict(
      <Dialog
        open
        onClose={vi.fn()}
        title="Edit alert"
        description="NVDA above 140.00."
        aria-describedby="alert-rule"
        width={520}
        footer={<Button>Save</Button>}
      >
        <p id="alert-rule">Evaluated on the last trade.</p>
      </Dialog>,
    );
    const dialog = screen.getByRole('dialog', { name: 'Edit alert' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAccessibleDescription('NVDA above 140.00. Evaluated on the last trade.');
    for (const id of (dialog.getAttribute('aria-describedby') ?? '').split(' ')) {
      expect(document.getElementById(id)).not.toBeNull();
    }
    expect(dialog).toHaveStyle({ width: '520px' });
    expect(within(dialog).getByRole('button', { name: 'Save' })).toBeInTheDocument();
  });

  it('ConfirmDialog applies confirmLabel and tone, and Enter right after opening cancels', async () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    const user = userEvent.setup();
    const { rerender } = strict(
      <ConfirmDialog
        open
        title="Reset layout?"
        message="Panels go back to default."
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );
    expect(screen.getByRole('button', { name: 'Confirm' })).toHaveClass('ui-btn--primary');

    rerender(
      <StrictMode>
        <ConfirmDialog
          open
          title="Reset layout?"
          message="Panels go back to default."
          confirmLabel="Reset"
          tone="danger"
          onConfirm={onConfirm}
          onCancel={onCancel}
        />
      </StrictMode>,
    );
    const dialog = screen.getByRole('dialog', { name: 'Reset layout?' });
    expect(dialog).toHaveAccessibleDescription('Panels go back to default.');
    expect(within(dialog).getByRole('button', { name: 'Reset' })).toHaveClass('ui-btn--danger');
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toHaveFocus();

    await user.keyboard('{Enter}');
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });
});

const MENU_ITEMS = (onSelect: (id: string) => void): MenuItem[] => [
  {
    id: 'export',
    label: 'Export CSV',
    disabled: true,
    onSelect: () => {
      onSelect('export');
    },
  },
  {
    id: 'add',
    label: 'Add to watchlist',
    icon: <svg data-testid="add-icon" />,
    onSelect: () => {
      onSelect('add');
    },
  },
  {
    id: 'alert',
    label: 'Create alert',
    onSelect: () => {
      onSelect('alert');
    },
  },
  {
    id: 'copy',
    label: 'Copy symbol',
    onSelect: () => {
      onSelect('copy');
    },
  },
  {
    id: 'remove',
    label: 'Remove',
    danger: true,
    onSelect: () => {
      onSelect('remove');
    },
  },
];

describe('Menu contract (QA)', () => {
  it('keyboard: opens on the first enabled item, wraps, Home/End, typeahead, Space selects once and refocuses the trigger', async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    strict(<Menu trigger={(p) => <Button {...p}>Actions</Button>} items={MENU_ITEMS(onSelect)} />);
    const trigger = screen.getByRole('button', { name: 'Actions' });
    trigger.focus();

    await user.keyboard('{Enter}');
    const item = (name: string) => screen.getByRole('menuitem', { name });
    expect(item('Add to watchlist')).toHaveFocus();
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    await user.keyboard('{ArrowUp}');
    expect(item('Remove')).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(item('Add to watchlist')).toHaveFocus();
    await user.keyboard('{End}');
    expect(item('Remove')).toHaveFocus();
    await user.keyboard('{Home}');
    expect(item('Add to watchlist')).toHaveFocus();
    await user.keyboard('c');
    expect(item('Create alert')).toHaveFocus();
    await user.keyboard('c');
    expect(item('Copy symbol')).toHaveFocus();

    await user.keyboard('{Home}');
    // ** Typeahead treats a Space typed right after a letter as part of the search, so wait out
    // the search buffer before selecting with Space.
    await new Promise((resolve) => setTimeout(resolve, 1100));
    await user.keyboard(' ');
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith('add');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });

  it('mouse and assistive tech: click opens, a disabled item does nothing, a scripted click (detail 0) toggles', async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    strict(
      <Menu
        align="end"
        trigger={(p) => <IconButton {...p} label="More actions" icon={<span />} />}
        items={MENU_ITEMS(onSelect)}
      />,
    );
    const trigger = screen.getByRole('button', { name: 'More actions' });
    expect(trigger).toHaveAttribute('aria-haspopup', 'menu');

    await user.click(trigger);
    const menu = screen.getByRole('menu');
    expect(menu).toHaveAttribute('data-align', 'end');
    expect(screen.getByRole('menuitem', { name: 'Remove' })).toHaveClass('is-danger');
    expect(screen.getByTestId('add-icon').closest('[aria-hidden="true"]')).not.toBeNull();

    fireEvent.click(screen.getByRole('menuitem', { name: 'Export CSV' }));
    expect(onSelect).not.toHaveBeenCalled();
    expect(screen.getByRole('menu')).toBeInTheDocument();

    await user.click(screen.getByRole('menuitem', { name: 'Create alert' }));
    expect(onSelect).toHaveBeenCalledExactlyOnceWith('alert');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();

    act(() => {
      trigger.click();
    });
    expect(screen.getByRole('menu')).toBeInTheDocument();
    act(() => {
      trigger.click();
    });
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('Space on the trigger opens the menu and leaves it open', async () => {
    const user = userEvent.setup();
    strict(<Menu trigger={(p) => <Button {...p}>Actions</Button>} items={MENU_ITEMS(vi.fn())} />);
    screen.getByRole('button', { name: 'Actions' }).focus();
    await user.keyboard(' ');
    expect(screen.getByRole('menu')).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Add to watchlist' })).toHaveFocus();
  });
});

describe('Tooltip props (QA)', () => {
  it('honours delayMs and side, hides on leave, and Escape dismisses a hover tooltip', () => {
    vi.useFakeTimers();
    try {
      strict(
        <Tooltip content="Refresh quotes" side="bottom" delayMs={1000}>
          <button type="button">Refresh</button>
        </Tooltip>,
      );
      const button = screen.getByRole('button', { name: 'Refresh' });
      fireEvent.pointerMove(button);
      act(() => {
        vi.advanceTimersByTime(999);
      });
      expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
      act(() => {
        vi.advanceTimersByTime(1);
      });
      expect(screen.getByRole('tooltip')).toHaveTextContent('Refresh quotes');
      expect(document.querySelector('.ui-tooltip')).toHaveAttribute('data-side', 'bottom');
      expect(button).toHaveAccessibleDescription('Refresh quotes');

      fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
      expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();

      fireEvent.pointerLeave(button);
      fireEvent.pointerMove(button);
      act(() => {
        vi.advanceTimersByTime(1000);
      });
      expect(screen.getByRole('tooltip')).toBeInTheDocument();
      fireEvent.pointerLeave(button);
      expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('empty content never shows a tooltip or describes the trigger', async () => {
    const user = userEvent.setup();
    strict(
      <Tooltip content="">
        <button type="button">Plain</button>
      </Tooltip>,
    );
    await user.tab();
    expect(screen.getByRole('button', { name: 'Plain' })).toHaveFocus();
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Plain' })).not.toHaveAttribute('aria-describedby');
  });
});

type Range = '1D' | '1W' | '1M' | '1Y';
const RANGES: SegmentedOption<Range>[] = [
  { value: '1D', label: '1D' },
  { value: '1W', label: '1W', title: 'One week' },
  { value: '1M', label: '1M' },
  { value: '1Y', label: '1Y' },
];

function RangePicker({ onChange, disabled = false }: { onChange: (v: Range) => void; disabled?: boolean }) {
  const [value, setValue] = useState<Range>('1W');
  return (
    <SegmentedControl
      options={RANGES}
      value={value}
      size="sm"
      disabled={disabled}
      aria-label="Chart range"
      onChange={(next) => {
        onChange(next);
        setValue(next);
      }}
    />
  );
}

type DetailTab = 'overview' | 'alerts' | 'notes';

function SymbolTabs({ onChange }: { onChange: (v: DetailTab) => void }) {
  const [tab, setTab] = useState<DetailTab>('overview');
  return (
    <Tabs
      aria-label="Symbol details"
      value={tab}
      onChange={(next) => {
        onChange(next);
        setTab(next);
      }}
      tabs={[
        { value: 'overview', label: 'Overview' },
        { value: 'alerts', label: 'Alerts', badge: 3 },
        { value: 'notes', label: 'Notes' },
      ]}
    />
  );
}

describe('SegmentedControl, Tabs and Switch (QA)', () => {
  it('SegmentedControl: arrows on both axes wrap, Home/End jump, clicks select, re-pressing keeps the choice', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    strict(<RangePicker onChange={onChange} />);
    const group = screen.getByRole('radiogroup', { name: 'Chart range' });
    expect(group).toHaveClass('ui-segmented--sm');
    const radio = (name: string) => screen.getByRole('radio', { name });

    await user.tab();
    expect(radio('1W')).toHaveFocus();
    await user.keyboard('{ArrowRight}');
    await user.keyboard('{ArrowDown}');
    await user.keyboard('{ArrowRight}');
    expect(radio('1D')).toBeChecked();
    expect(radio('1D')).toHaveFocus();
    await user.keyboard('{ArrowUp}');
    expect(radio('1Y')).toBeChecked();
    await user.keyboard('{Home}');
    expect(radio('1D')).toBeChecked();
    await user.keyboard('{End}');
    expect(radio('1Y')).toBeChecked();
    expect(onChange.mock.calls.map(([v]) => v as Range)).toEqual(['1M', '1Y', '1D', '1Y', '1D', '1Y']);

    await user.click(radio('1M'));
    expect(radio('1M')).toBeChecked();
    await user.click(radio('1M'));
    await user.keyboard(' ');
    expect(radio('1M')).toBeChecked();
    expect(onChange).toHaveBeenCalledTimes(7);
  });

  it('SegmentedControl: disabled blocks changes, and a titled option shows its tooltip on keyboard focus', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    const { unmount } = strict(<RangePicker onChange={onChange} disabled />);
    expect(screen.getByRole('radiogroup', { name: 'Chart range' })).toHaveAttribute('aria-disabled', 'true');
    await user.click(screen.getByRole('radio', { name: '1M' }));
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole('radio', { name: '1W' })).toBeChecked();
    unmount();

    strict(<RangePicker onChange={onChange} />);
    await user.tab();
    expect(screen.getByRole('radio', { name: '1W' })).toHaveFocus();
    expect(await screen.findByRole('tooltip')).toHaveTextContent('One week');
    expect(screen.getByRole('radio', { name: '1W' })).toHaveAccessibleDescription('One week');
  });

  it('Tabs: Left/Right select with wrap, Home/End jump, badges render and no dangling aria-controls', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    strict(<SymbolTabs onChange={onChange} />);
    expect(screen.getByRole('tablist', { name: 'Symbol details' })).toBeInTheDocument();
    const tab = (name: string | RegExp) => screen.getByRole('tab', { name });
    expect(tab(/Alerts/)).toHaveTextContent('3');
    for (const t of screen.getAllByRole('tab')) expect(t).not.toHaveAttribute('aria-controls');

    await user.tab();
    expect(tab('Overview')).toHaveFocus();
    await user.keyboard('{ArrowLeft}');
    expect(tab('Notes')).toHaveAttribute('aria-selected', 'true');
    await user.keyboard('{ArrowRight}');
    expect(tab('Overview')).toHaveAttribute('aria-selected', 'true');
    await user.keyboard('{End}');
    expect(tab('Notes')).toHaveFocus();
    await user.keyboard('{Home}');
    expect(tab('Overview')).toHaveFocus();
    expect(onChange.mock.calls.map(([v]) => v as string)).toEqual(['notes', 'overview', 'notes', 'overview']);
  });

  it('Tabs: one mouse click on an unselected tab reports exactly one change', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    strict(<SymbolTabs onChange={onChange} />);
    await user.click(screen.getByRole('tab', { name: /Alerts/ }));
    expect(screen.getByRole('tab', { name: /Alerts/ })).toHaveAttribute('aria-selected', 'true');
    expect(onChange).toHaveBeenCalledExactlyOnceWith('alerts');
  });

  it('Switch: Space and the label toggle, hideLabel keeps an accessible name, disabled ignores input', async () => {
    const user = userEvent.setup();
    function Controlled({ hideLabel = false, disabled = false }) {
      const [on, setOn] = useState(false);
      return (
        <Switch
          label="Extended hours"
          checked={on}
          onChange={setOn}
          hideLabel={hideLabel}
          disabled={disabled}
        />
      );
    }
    const { rerender } = strict(<Controlled />);
    const sw = () => screen.getByRole('switch', { name: 'Extended hours' });
    await user.tab();
    expect(sw()).toHaveFocus();
    await user.keyboard(' ');
    expect(sw()).toBeChecked();
    await user.click(screen.getByText('Extended hours'));
    expect(sw()).not.toBeChecked();

    rerender(
      <StrictMode>
        <Controlled hideLabel />
      </StrictMode>,
    );
    expect(sw()).toHaveAttribute('aria-label', 'Extended hours');
    expect(screen.queryByText('Extended hours')).not.toBeInTheDocument();

    rerender(
      <StrictMode>
        <Controlled disabled />
      </StrictMode>,
    );
    await user.click(sw());
    expect(sw()).not.toBeChecked();
    expect(sw()).toBeDisabled();
  });
});
