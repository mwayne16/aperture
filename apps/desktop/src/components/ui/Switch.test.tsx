import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { Switch } from './Switch';

function Controlled({ initial = false, onChange = vi.fn(), hideLabel = false }) {
  const [checked, setChecked] = useState(initial);
  return (
    <Switch
      checked={checked}
      onChange={(next) => {
        onChange(next);
        setChecked(next);
      }}
      label="Extended hours"
      hideLabel={hideLabel}
    />
  );
}

describe('Switch', () => {
  it('has role switch, an accessible name and aria-checked', () => {
    render(<Controlled initial />);
    const sw = screen.getByRole('switch', { name: 'Extended hours' });
    expect(sw).toHaveAttribute('aria-checked', 'true');
  });

  it('toggles with Space', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<Controlled onChange={onChange} />);
    const sw = screen.getByRole('switch');
    sw.focus();
    await user.keyboard(' ');
    expect(sw).toHaveAttribute('aria-checked', 'true');
    await user.keyboard(' ');
    expect(sw).toHaveAttribute('aria-checked', 'false');
    expect(onChange.mock.calls).toEqual([[true], [false]]);
  });

  it('toggles from a click on the track or the visible label', async () => {
    const user = userEvent.setup();
    render(<Controlled />);
    const sw = screen.getByRole('switch');
    await user.click(sw);
    expect(sw).toHaveAttribute('aria-checked', 'true');
    await user.click(screen.getByText('Extended hours'));
    expect(sw).toHaveAttribute('aria-checked', 'false');
  });

  it('keeps the name but hides the text with hideLabel', () => {
    render(<Controlled hideLabel />);
    expect(screen.getByRole('switch', { name: 'Extended hours' })).toHaveAttribute(
      'aria-label',
      'Extended hours',
    );
    expect(screen.queryByText('Extended hours')).not.toBeInTheDocument();
  });

  it('takes its description from aria-describedby', () => {
    render(
      <>
        <Switch checked={false} onChange={vi.fn()} label="Sound" aria-describedby="sound-hint" />
        <p id="sound-hint">Plays a chime when an alert fires.</p>
      </>,
    );
    expect(screen.getByRole('switch', { name: 'Sound' })).toHaveAccessibleDescription(
      'Plays a chime when an alert fires.',
    );
  });

  it('does not toggle while disabled', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<Switch checked={false} onChange={onChange} label="Sound" disabled />);
    const sw = screen.getByRole('switch', { name: 'Sound' });
    expect(sw).toBeDisabled();
    await user.click(sw);
    await user.click(screen.getByText('Sound'));
    sw.focus();
    await user.keyboard(' ');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('is controlled: reports the next value without changing on its own', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<Switch checked={false} onChange={onChange} label="Sound" />);
    await user.click(screen.getByRole('switch'));
    expect(onChange).toHaveBeenCalledWith(true);
    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'false');
  });
});
