import { act, render, screen } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { formatClock } from '../../lib/format';
import { useNow } from './useNow';

function Clock({ label }: { label: string }) {
  return <span data-testid={label}>{formatClock(useNow(), 'UTC')}</span>;
}

beforeEach(() => {
  vi.useFakeTimers({ now: Date.UTC(2026, 9, 28, 14, 30, 5, 400) });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useNow', () => {
  it('shows the current second on mount and advances on each whole second', () => {
    render(<Clock label="a" />);
    expect(screen.getByTestId('a')).toHaveTextContent('14:30:05');
    act(() => {
      vi.advanceTimersByTime(599);
    });
    expect(screen.getByTestId('a')).toHaveTextContent('14:30:05');
    act(() => {
      vi.advanceTimersByTime(10);
    });
    expect(screen.getByTestId('a')).toHaveTextContent('14:30:06');
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(screen.getByTestId('a')).toHaveTextContent('14:30:09');
  });

  it('shares one timer between consumers so they change together', () => {
    render(
      <>
        <Clock label="a" />
        <Clock label="b" />
      </>,
    );
    expect(vi.getTimerCount()).toBe(1);
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(screen.getByTestId('a').textContent).toBe(screen.getByTestId('b').textContent);
  });

  it('stops ticking once nothing is mounted, including after a StrictMode double mount', () => {
    const { unmount } = render(
      <StrictMode>
        <Clock label="a" />
      </StrictMode>,
    );
    expect(vi.getTimerCount()).toBe(1);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not show an old second when mounting long after the last tick', () => {
    const { unmount } = render(<Clock label="a" />);
    unmount();
    vi.setSystemTime(Date.UTC(2026, 9, 28, 16, 0, 0, 200));
    render(<Clock label="b" />);
    expect(screen.getByTestId('b')).toHaveTextContent('16:00:00');
  });
});
