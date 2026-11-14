import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { Button } from './Button';
import { Panel } from './Panel';
import { SegmentedControl } from './SegmentedControl';
import { Select } from './Select';
import { Switch } from './Switch';
import { Tabs } from './Tabs';
import { TextInput } from './TextInput';

describe('SegmentedControl (adversarial)', () => {
  function Harness({ titled = false }: { titled?: boolean }) {
    const [v, setV] = useState<'1m' | '5m' | '1h'>('5m');
    return (
      <SegmentedControl
        aria-label="Interval"
        value={v}
        onChange={setV}
        options={[
          { value: '1m', label: '1m', title: titled ? 'One minute' : undefined },
          { value: '5m', label: '5m', title: titled ? 'Five minutes' : undefined },
          { value: '1h', label: '1h', title: titled ? 'One hour' : undefined },
        ]}
      />
    );
  }

  it.each([false, true])('arrow keys move selection and focus together (titled=%s)', async (titled) => {
    const user = userEvent.setup();
    render(<Harness titled={titled} />);
    await user.tab();
    expect(screen.getByRole('radio', { name: '5m' })).toHaveFocus();
    await user.keyboard('{ArrowRight}');
    const oneHour = screen.getByRole('radio', { name: '1h' });
    expect(oneHour).toHaveFocus();
    expect(oneHour).toHaveAttribute('aria-checked', 'true');
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('radio', { name: '1m' })).toHaveAttribute('aria-checked', 'true');
    expect(
      screen.getAllByRole('radio').filter((r) => r.getAttribute('aria-checked') === 'true'),
    ).toHaveLength(1);
    // Exactly one tab stop at all times.
    expect(screen.getAllByRole('radio').filter((r) => r.tabIndex === 0)).toHaveLength(1);
  });

  it('is removed from the tab order and announces disabled when disabled', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(
      <>
        <button>before</button>
        <SegmentedControl
          aria-label="Side"
          value="buy"
          onChange={onChange}
          disabled
          options={[
            { value: 'buy', label: 'Buy' },
            { value: 'sell', label: 'Sell' },
          ]}
        />
        <button>after</button>
      </>,
    );
    await user.tab();
    await user.tab();
    expect(screen.getByRole('button', { name: 'after' })).toHaveFocus();
    await user.click(screen.getByRole('radio', { name: 'Sell' }));
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole('radiogroup', { name: 'Side' })).toHaveAttribute('aria-disabled', 'true');
  });
});

describe('Tabs (adversarial)', () => {
  it('Home/End/Arrow keys keep a single tab stop on the selected tab', async () => {
    function Harness() {
      const [v, setV] = useState<'a' | 'b' | 'c'>('b');
      return (
        <Tabs
          aria-label="Detail"
          value={v}
          onChange={setV}
          tabs={[
            { value: 'a', label: 'Overview' },
            { value: 'b', label: 'Alerts', badge: 3 },
            { value: 'c', label: 'News' },
          ]}
        />
      );
    }
    const user = userEvent.setup();
    render(<Harness />);
    await user.tab();
    expect(screen.getByRole('tab', { selected: true })).toHaveFocus();
    await user.keyboard('{End}');
    expect(screen.getByRole('tab', { name: 'News' })).toHaveAttribute('aria-selected', 'true');
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'Overview' })).toHaveFocus();
    expect(screen.getByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-selected', 'true');
    await user.keyboard('{Home}{ArrowLeft}');
    expect(screen.getByRole('tab', { name: 'News' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getAllByRole('tab').filter((t) => t.tabIndex === 0)).toHaveLength(1);
  });
});

describe('Switch (adversarial)', () => {
  it('toggles exactly once per Space press and per label click', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<Switch checked={false} onChange={onChange} label="Extended hours" />);
    const sw = screen.getByRole('switch', { name: 'Extended hours' });
    sw.focus();
    await user.keyboard(' ');
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenLastCalledWith(true);
    await user.click(screen.getByText('Extended hours'));
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it('disabled switch is not focusable and does not toggle from its label', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<Switch checked onChange={onChange} label="Sound" disabled />);
    await user.click(screen.getByText('Sound'));
    await user.tab();
    expect(screen.getByRole('switch')).not.toHaveFocus();
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe('Fields (adversarial)', () => {
  it('TextInput error is the accessible description and aria-invalid is set', () => {
    render(<TextInput label="Limit price" hint="USD" error="Price must be greater than 0" />);
    const input = screen.getByRole('textbox', { name: 'Limit price' });
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAccessibleDescription('Price must be greater than 0');
  });

  it('TextInput hint is the description when there is no error', () => {
    render(<TextInput label="Note" hint="Optional" />);
    const input = screen.getByRole('textbox', { name: 'Note' });
    expect(input).not.toHaveAttribute('aria-invalid');
    expect(input).toHaveAccessibleDescription('Optional');
  });

  it('Select label and error are wired', () => {
    render(
      <Select label="Condition" options={[{ value: '', label: 'Choose…' }]} error="Choose a condition" />,
    );
    const select = screen.getByRole('combobox', { name: 'Condition' });
    expect(select).toHaveAttribute('aria-invalid', 'true');
    expect(select).toHaveAccessibleDescription('Choose a condition');
  });
});

describe('Button (adversarial)', () => {
  it('loading blocks keyboard activation too', async () => {
    const onClick = vi.fn();
    const user = userEvent.setup();
    render(
      <Button variant="primary" loading onClick={onClick}>
        Save
      </Button>,
    );
    await user.tab();
    await user.keyboard('{Enter} ');
    expect(onClick).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Save' })).toHaveAttribute('aria-busy', 'true');
  });
});

describe('Panel (adversarial)', () => {
  it('renders header actions and a body with the given classes', () => {
    render(
      <Panel title="Quotes" actions={<button>Refresh</button>} className="outer" bodyClassName="inner">
        <p>content</p>
      </Panel>,
    );
    const region = screen.getByRole('region', { name: 'Quotes' });
    expect(region).toHaveClass('outer');
    expect(screen.getByText('content').parentElement).toHaveClass('inner');
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeInTheDocument();
  });
});
