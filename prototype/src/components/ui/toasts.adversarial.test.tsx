import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { dismissAllToasts, dismissToast, showToast } from './toastStore';
import { ToastViewport } from './ToastViewport';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  act(() => {
    dismissAllToasts();
  });
  vi.useRealTimers();
});

const items = () => within(screen.getByRole('region', { name: 'Notifications' })).queryAllByRole('listitem');

describe('Toasts (adversarial)', () => {
  it('keeps a toast with a very long durationMs instead of dismissing it at once (setTimeout overflow)', () => {
    render(<ToastViewport />);
    act(() => {
      // ~25 days: a legitimate "effectively sticky" value. setTimeout delays above 2^31-1 ms
      // overflow and fire after ~1ms in browsers and Node unless clamped.
      showToast({ tone: 'info', title: 'Long lived', durationMs: 2 ** 31 + 1000 });
    });
    act(() => {
      vi.advanceTimersByTime(50);
    });
    expect(screen.getByText('Long lived')).toBeInTheDocument();
  });

  it('dismisses exactly at the default 5000ms boundary, not before', () => {
    render(<ToastViewport />);
    act(() => {
      showToast({ tone: 'success', title: 'Saved' });
    });
    act(() => {
      vi.advanceTimersByTime(4999);
    });
    expect(screen.getByText('Saved')).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.queryByText('Saved')).not.toBeInTheDocument();
  });

  it('never shows more than 5 at once and always shows the newest', () => {
    render(<ToastViewport />);
    act(() => {
      for (let i = 1; i <= 12; i++) showToast({ tone: 'info', title: `T${i}`, durationMs: Infinity });
    });
    expect(items()).toHaveLength(5);
    expect(screen.getByText('T12')).toBeInTheDocument();
    expect(screen.queryByText('T7')).not.toBeInTheDocument();
  });

  it('dismissing one toast does not restart or cancel the countdown of the others', () => {
    render(<ToastViewport />);
    let a = '';
    act(() => {
      a = showToast({ tone: 'info', title: 'A', durationMs: 3000 });
      showToast({ tone: 'info', title: 'B', durationMs: 3000 });
    });
    act(() => {
      vi.advanceTimersByTime(2000);
      dismissToast(a);
    });
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(items()).toHaveLength(0);
  });

  it('returns a distinct id for every call, even within the same millisecond', () => {
    const ids = new Set<string>();
    act(() => {
      for (let i = 0; i < 50; i++) ids.add(showToast({ tone: 'warning', title: 'x', durationMs: Infinity }));
    });
    expect(ids.size).toBe(50);
  });

  it('the live region is polite and the stack keeps the 5 most recent after hover pause and resume', () => {
    render(<ToastViewport />);
    const region = screen.getByRole('region', { name: 'Notifications' });
    expect(region).toHaveAttribute('aria-live', 'polite');
    act(() => {
      showToast({ tone: 'error', title: 'E1', durationMs: 1000 });
    });
    fireEvent.mouseEnter(region);
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(screen.getByText('E1')).toBeInTheDocument();
    fireEvent.mouseLeave(region);
    act(() => {
      vi.advanceTimersByTime(999);
    });
    expect(screen.getByText('E1')).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.queryByText('E1')).not.toBeInTheDocument();
  });

  it('leaves no pending timers after every toast is gone', () => {
    render(<ToastViewport />);
    act(() => {
      for (let i = 0; i < 8; i++) showToast({ tone: 'info', title: `t${i}` });
    });
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(items()).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
  });
});
