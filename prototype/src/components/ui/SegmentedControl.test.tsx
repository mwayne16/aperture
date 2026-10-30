import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { SegmentedControl, type SegmentedOption } from './SegmentedControl';

type Range = '1D' | '1W' | '1M' | '1Y';
const OPTIONS: SegmentedOption<Range>[] = [
  { value: '1D', label: '1D' },
  { value: '1W', label: '1W' },
  { value: '1M', label: '1M', title: 'One month' },
  { value: '1Y', label: '1Y' },
];

function Controlled({ initial = '1W' as Range, onChange = vi.fn(), disabled = false }) {
  const [value, setValue] = useState<Range>(initial);
  return (
    <>
      <button type="button">Before</button>
      <SegmentedControl
        options={OPTIONS}
        value={value}
        onChange={(v) => {
          onChange(v);
          setValue(v);
        }}
        aria-label="Chart range"
        disabled={disabled}
      />
      <button type="button">After</button>
    </>
  );
}

const radio = (name: string) => screen.getByRole('radio', { name });

describe('SegmentedControl', () => {
  it('exposes radiogroup semantics with exactly one checked radio', () => {
    render(<Controlled />);
    expect(screen.getByRole('radiogroup', { name: 'Chart range' })).toBeInTheDocument();
    const radios = screen.getAllByRole('radio');
    expect(radios).toHaveLength(4);
    expect(radios.filter((r) => r.getAttribute('aria-checked') === 'true')).toEqual([radio('1W')]);
  });

  it('is a single tab stop on the checked option', async () => {
    const user = userEvent.setup();
    render(<Controlled />);
    await user.tab();
    await user.tab();
    expect(radio('1W')).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('button', { name: 'After' })).toHaveFocus();
    expect(screen.getAllByRole('radio').map((r) => r.tabIndex)).toEqual([-1, 0, -1, -1]);
  });

  it('moves and selects with arrow keys on both axes, wrapping at the ends', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<Controlled onChange={onChange} />);
    radio('1W').focus();

    await user.keyboard('{ArrowRight}');
    expect(radio('1M')).toHaveFocus();
    expect(radio('1M')).toHaveAttribute('aria-checked', 'true');
    await user.keyboard('{ArrowDown}{ArrowDown}'); // 1Y, then wrap to 1D
    expect(radio('1D')).toHaveAttribute('aria-checked', 'true');
    await user.keyboard('{ArrowLeft}'); // wrap back to 1Y
    expect(radio('1Y')).toHaveFocus();
    await user.keyboard('{ArrowUp}');
    expect(radio('1M')).toHaveAttribute('aria-checked', 'true');
    expect(onChange.mock.calls.map((c) => c[0] as Range)).toEqual(['1M', '1Y', '1D', '1Y', '1M']);
  });

  it('jumps with Home and End', async () => {
    const user = userEvent.setup();
    render(<Controlled />);
    radio('1W').focus();
    await user.keyboard('{End}');
    expect(radio('1Y')).toHaveAttribute('aria-checked', 'true');
    await user.keyboard('{Home}');
    expect(radio('1D')).toHaveAttribute('aria-checked', 'true');
    expect(radio('1D')).toHaveFocus();
  });

  it('selects on click and ignores clicks on the already checked option', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<Controlled onChange={onChange} />);
    await user.click(radio('1W'));
    expect(onChange).not.toHaveBeenCalled();
    await user.click(radio('1Y'));
    expect(onChange).toHaveBeenCalledWith('1Y');
  });

  it('ignores keys that are not navigation keys', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<Controlled onChange={onChange} />);
    radio('1W').focus();
    // Enter and Space on the checked option keep it checked. Radix moves with PageUp/PageDown
    // like Home/End, so they are navigation keys here.
    await user.keyboard('a{Enter} ');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('enters on the first option when the value matches none', async () => {
    const user = userEvent.setup();
    render(
      <SegmentedControl
        options={OPTIONS}
        value={'5Y' as Range}
        onChange={vi.fn()}
        aria-label="Chart range"
      />,
    );
    // The group holds the tab stop until an option has focus, and Tab hands it to the first one.
    await user.tab();
    expect(radio('1D')).toHaveFocus();
    expect(screen.getAllByRole('radio').every((r) => r.getAttribute('aria-checked') === 'false')).toBe(true);
  });

  it('does nothing while disabled', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<Controlled onChange={onChange} disabled />);
    expect(screen.getByRole('radiogroup')).toHaveAttribute('aria-disabled', 'true');
    await user.click(radio('1Y'));
    // A click on a disabled option focuses the group container, so start Tab from before it.
    screen.getByRole('button', { name: 'Before' }).focus();
    await user.tab();
    expect(screen.getByRole('button', { name: 'After' })).toHaveFocus();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('shows an option title as a tooltip on keyboard focus', async () => {
    const user = userEvent.setup();
    render(<Controlled initial="1M" />);
    await user.tab();
    await user.tab();
    expect(screen.getByRole('tooltip')).toHaveTextContent('One month');
    expect(radio('1M')).toHaveAccessibleDescription('One month');
  });
});
