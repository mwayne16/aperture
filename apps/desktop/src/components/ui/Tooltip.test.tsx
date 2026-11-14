import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { IconButton } from './IconButton';
import { Tooltip } from './Tooltip';

afterEach(() => {
  vi.useRealTimers();
});

describe('Tooltip', () => {
  it('shows immediately on keyboard focus and describes the trigger', async () => {
    const user = userEvent.setup();
    render(
      <Tooltip content="Refresh quotes">
        <button type="button">Refresh</button>
      </Tooltip>,
    );
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    await user.tab();
    const tooltip = screen.getByRole('tooltip');
    expect(tooltip).toHaveTextContent('Refresh quotes');
    expect(screen.getByRole('button')).toHaveAccessibleDescription('Refresh quotes');
  });

  it('hides on blur and drops aria-describedby', async () => {
    const user = userEvent.setup();
    render(
      <>
        <Tooltip content="Refresh quotes">
          <button type="button">Refresh</button>
        </Tooltip>
        <button type="button">Next</button>
      </>,
    );
    await user.tab();
    await user.tab();
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Refresh' })).not.toHaveAttribute('aria-describedby');
  });

  it('hides on Escape', async () => {
    const user = userEvent.setup();
    render(
      <Tooltip content="Refresh quotes">
        <button type="button">Refresh</button>
      </Tooltip>,
    );
    await user.tab();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('does not show for focus that comes from a mouse click', async () => {
    const user = userEvent.setup();
    render(
      <Tooltip content="Refresh quotes" delayMs={400}>
        <button type="button">Refresh</button>
      </Tooltip>,
    );
    await user.click(screen.getByRole('button'));
    expect(screen.getByRole('button')).toHaveFocus();
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('shows on hover only after the delay, and not if the pointer leaves first', () => {
    vi.useFakeTimers();
    render(
      <Tooltip content="Later" delayMs={400}>
        <button type="button">Hover me</button>
      </Tooltip>,
    );
    const button = screen.getByRole('button');

    fireEvent.pointerMove(button);
    act(() => {
      vi.advanceTimersByTime(399);
    });
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.getByRole('tooltip')).toHaveTextContent('Later');

    fireEvent.pointerLeave(button);
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();

    fireEvent.pointerMove(button);
    act(() => {
      vi.advanceTimersByTime(200);
    });
    fireEvent.pointerLeave(button);
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('uses the default 400ms delay and hides when the trigger is pressed', () => {
    vi.useFakeTimers();
    render(
      <Tooltip content="Default">
        <button type="button">Hover me</button>
      </Tooltip>,
    );
    const button = screen.getByRole('button');
    fireEvent.pointerMove(button);
    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(screen.getByRole('tooltip')).toBeInTheDocument();
    fireEvent.pointerDown(button);
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('keeps the child handlers, its existing description and its ref', async () => {
    const onFocus = vi.fn();
    const onMouseEnter = vi.fn();
    const ref = createRef<HTMLButtonElement>();
    const user = userEvent.setup();
    render(
      <>
        <span id="extra">Extra info</span>
        <Tooltip content="Tip">
          <button
            type="button"
            ref={ref}
            aria-describedby="extra"
            onFocus={onFocus}
            onMouseEnter={onMouseEnter}
          >
            Target
          </button>
        </Tooltip>
      </>,
    );
    await user.tab();
    expect(onFocus).toHaveBeenCalledTimes(1);
    expect(ref.current).toBe(screen.getByRole('button'));
    expect(screen.getByRole('button')).toHaveAccessibleDescription('Extra info Tip');
    fireEvent.mouseEnter(screen.getByRole('button'));
    expect(onMouseEnter).toHaveBeenCalledTimes(1);
  });

  it('renders the child alone when there is no content', async () => {
    const user = userEvent.setup();
    render(
      <Tooltip content="">
        <button type="button">Plain</button>
      </Tooltip>,
    );
    await user.tab();
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('opens below when side is bottom', async () => {
    const user = userEvent.setup();
    render(
      <Tooltip content="Below" side="bottom">
        <button type="button">Target</button>
      </Tooltip>,
    );
    await user.tab();
    expect(screen.getByRole('tooltip')).toHaveAttribute('data-side', 'bottom');
  });
});

describe('IconButton', () => {
  it('uses the label as its name and tooltip without describing itself twice', async () => {
    const user = userEvent.setup();
    render(<IconButton label="Refresh" icon={<svg />} />);
    const button = screen.getByRole('button', { name: 'Refresh' });
    await user.tab();
    expect(screen.getByRole('tooltip')).toHaveTextContent('Refresh');
    expect(button).not.toHaveAttribute('aria-describedby');
  });

  it('reflects active as aria-pressed only when provided', () => {
    const { rerender } = render(<IconButton label="Pin" icon={<svg />} />);
    expect(screen.getByRole('button')).not.toHaveAttribute('aria-pressed');
    rerender(<IconButton label="Pin" icon={<svg />} active />);
    expect(screen.getByRole('button', { pressed: true })).toHaveClass('is-active');
    rerender(<IconButton label="Pin" icon={<svg />} active={false} />);
    expect(screen.getByRole('button', { pressed: false })).not.toHaveClass('is-active');
  });

  it('forwards its ref and defaults to type="button"', () => {
    const ref = createRef<HTMLButtonElement>();
    render(<IconButton ref={ref} label="Pin" icon={<svg />} />);
    expect(ref.current).toBe(screen.getByRole('button'));
    expect(ref.current).toHaveAttribute('type', 'button');
  });
});
