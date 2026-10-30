import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { Tabs } from './Tabs';

type Section = 'overview' | 'alerts' | 'notes';

function Controlled({ onChange = vi.fn() }: { onChange?: (v: Section) => void }) {
  const [value, setValue] = useState<Section>('overview');
  return (
    <Tabs<Section>
      aria-label="Detail sections"
      value={value}
      onChange={(v) => {
        onChange(v);
        setValue(v);
      }}
      tabs={[
        { value: 'overview', label: 'Overview' },
        { value: 'alerts', label: 'Alerts', badge: 3 },
        { value: 'notes', label: 'Notes' },
      ]}
    />
  );
}

const tab = (name: RegExp | string) => screen.getByRole('tab', { name });

describe('Tabs', () => {
  it('exposes tablist semantics with one selected tab', async () => {
    const user = userEvent.setup();
    render(<Controlled />);
    expect(screen.getByRole('tablist', { name: 'Detail sections' })).toBeInTheDocument();
    expect(tab('Overview')).toHaveAttribute('aria-selected', 'true');
    expect(tab(/Alerts/)).toHaveAttribute('aria-selected', 'false');
    // The tablist holds the tab stop until a tab has focus, and Tab hands it to the selected one.
    await user.tab();
    expect(tab('Overview')).toHaveFocus();
    expect(screen.getAllByRole('tab').map((t) => t.tabIndex)).toEqual([0, -1, -1]);
  });

  it('renders the badge inside the tab', () => {
    render(<Controlled />);
    expect(tab(/Alerts/)).toHaveTextContent('Alerts3');
  });

  it('moves and selects with Left/Right, wrapping at the ends', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<Controlled onChange={onChange} />);
    tab('Overview').focus();
    await user.keyboard('{ArrowRight}');
    expect(tab(/Alerts/)).toHaveFocus();
    expect(tab(/Alerts/)).toHaveAttribute('aria-selected', 'true');
    await user.keyboard('{ArrowRight}{ArrowRight}');
    expect(tab('Overview')).toHaveAttribute('aria-selected', 'true');
    await user.keyboard('{ArrowLeft}');
    expect(tab('Notes')).toHaveFocus();
    expect(onChange.mock.calls.map((c) => c[0] as Section)).toEqual(['alerts', 'notes', 'overview', 'notes']);
  });

  it('jumps with Home and End', async () => {
    const user = userEvent.setup();
    render(<Controlled />);
    tab('Overview').focus();
    await user.keyboard('{End}');
    expect(tab('Notes')).toHaveAttribute('aria-selected', 'true');
    await user.keyboard('{Home}');
    expect(tab('Overview')).toHaveFocus();
  });

  it('ignores Up/Down on a horizontal tablist', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<Controlled onChange={onChange} />);
    tab('Overview').focus();
    await user.keyboard('{ArrowDown}{ArrowUp}');
    expect(onChange).not.toHaveBeenCalled();
    expect(tab('Overview')).toHaveFocus();
  });

  it('selects on click and does not re-fire for the selected tab', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<Controlled onChange={onChange} />);
    await user.click(tab('Overview'));
    expect(onChange).not.toHaveBeenCalled();
    await user.click(tab('Notes'));
    expect(onChange).toHaveBeenCalledWith('notes');
    expect(screen.getAllByRole('tab').map((t) => t.tabIndex)).toEqual([-1, -1, 0]);
  });
});
