import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_TOAST_DURATION_MS,
  MAX_TOAST_DURATION_MS,
  MAX_VISIBLE_TOASTS,
  dismissAllToasts,
  dismissToast,
  pauseToasts,
  resumeToasts,
  showToast,
  useToastStore,
} from './toastStore';
import { ToastViewport } from './ToastViewport';

const titles = () => useToastStore.getState().toasts.map((t) => t.title);

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  act(() => {
    dismissAllToasts();
  });
  vi.useRealTimers();
});

describe('toast store', () => {
  it('returns unique ids and keeps insertion order', () => {
    const a = showToast({ tone: 'info', title: 'A' });
    const b = showToast({ tone: 'info', title: 'B' });
    expect(a).not.toBe(b);
    expect(titles()).toEqual(['A', 'B']);
  });

  it('auto-dismisses after the default 5000ms', () => {
    expect(DEFAULT_TOAST_DURATION_MS).toBe(5000);
    showToast({ tone: 'success', title: 'Saved' });
    vi.advanceTimersByTime(4999);
    expect(titles()).toEqual(['Saved']);
    vi.advanceTimersByTime(1);
    expect(titles()).toEqual([]);
  });

  it('honours a custom duration per toast', () => {
    showToast({ tone: 'info', title: 'Short', durationMs: 1000 });
    showToast({ tone: 'info', title: 'Long', durationMs: 8000 });
    vi.advanceTimersByTime(1000);
    expect(titles()).toEqual(['Long']);
    vi.advanceTimersByTime(7000);
    expect(titles()).toEqual([]);
  });

  it.each([0, -50, Infinity])('keeps a toast with durationMs %s until dismissed', (durationMs) => {
    const id = showToast({ tone: 'error', title: 'Sticky', durationMs });
    vi.advanceTimersByTime(60_000);
    expect(titles()).toEqual(['Sticky']);
    dismissToast(id);
    expect(titles()).toEqual([]);
  });

  it('clamps durations above the setTimeout limit instead of firing at once', () => {
    expect(MAX_TOAST_DURATION_MS).toBe(2 ** 31 - 1);
    showToast({ tone: 'info', title: 'Huge', durationMs: Number.MAX_SAFE_INTEGER });
    expect(useToastStore.getState().toasts[0]?.durationMs).toBe(MAX_TOAST_DURATION_MS);
    vi.advanceTimersByTime(60_000);
    expect(titles()).toEqual(['Huge']);
    vi.advanceTimersByTime(MAX_TOAST_DURATION_MS - 60_001);
    expect(titles()).toEqual(['Huge']);
    vi.advanceTimersByTime(1);
    expect(titles()).toEqual([]);
  });

  it('keeps a clamped toast across pause and resume', () => {
    showToast({ tone: 'info', title: 'Huge', durationMs: 2 ** 32 });
    vi.advanceTimersByTime(1000);
    pauseToasts();
    resumeToasts();
    vi.advanceTimersByTime(60_000);
    expect(titles()).toEqual(['Huge']);
  });

  it('falls back to the default for NaN', () => {
    showToast({ tone: 'info', title: 'NaN', durationMs: Number.NaN });
    vi.advanceTimersByTime(DEFAULT_TOAST_DURATION_MS);
    expect(titles()).toEqual([]);
  });

  it(`keeps at most ${MAX_VISIBLE_TOASTS}, evicting the oldest`, () => {
    for (let i = 1; i <= 7; i++) showToast({ tone: 'info', title: `T${i}`, durationMs: 0 });
    expect(titles()).toEqual(['T3', 'T4', 'T5', 'T6', 'T7']);
  });

  it('cancels the timer of an evicted toast so it cannot remove a newer one', () => {
    showToast({ tone: 'info', title: 'Old', durationMs: 1000 });
    for (let i = 1; i <= 5; i++) showToast({ tone: 'info', title: `N${i}`, durationMs: 0 });
    expect(titles()).not.toContain('Old');
    vi.advanceTimersByTime(1000);
    expect(titles()).toEqual(['N1', 'N2', 'N3', 'N4', 'N5']);
  });

  it('dismisses by id, ignoring unknown and repeated ids', () => {
    const a = showToast({ tone: 'info', title: 'A' });
    showToast({ tone: 'info', title: 'B' });
    dismissToast(a);
    dismissToast(a);
    dismissToast('nope');
    expect(titles()).toEqual(['B']);
  });

  it('a manually dismissed toast does not fire its timer later', () => {
    const a = showToast({ tone: 'info', title: 'A', durationMs: 1000 });
    dismissToast(a);
    const before = useToastStore.getState();
    vi.advanceTimersByTime(2000);
    expect(useToastStore.getState()).toBe(before);
  });

  it('pauses and resumes countdowns with the remaining time', () => {
    showToast({ tone: 'info', title: 'A', durationMs: 1000 });
    vi.advanceTimersByTime(600);
    pauseToasts();
    vi.advanceTimersByTime(10_000);
    expect(titles()).toEqual(['A']);

    resumeToasts();
    vi.advanceTimersByTime(399);
    expect(titles()).toEqual(['A']);
    vi.advanceTimersByTime(1);
    expect(titles()).toEqual([]);
  });

  it('starts toasts shown while paused only after resuming', () => {
    pauseToasts();
    showToast({ tone: 'info', title: 'Queued', durationMs: 500 });
    vi.advanceTimersByTime(5000);
    expect(titles()).toEqual(['Queued']);
    resumeToasts();
    vi.advanceTimersByTime(500);
    expect(titles()).toEqual([]);
  });

  it('never stays paused once the stack is empty', () => {
    const a = showToast({ tone: 'info', title: 'A' });
    pauseToasts();
    dismissToast(a);
    showToast({ tone: 'info', title: 'B', durationMs: 500 });
    vi.advanceTimersByTime(500);
    expect(titles()).toEqual([]);
  });
});

describe('ToastViewport', () => {
  it('is a polite live region that exists before any toast appears', () => {
    render(<ToastViewport />);
    const region = screen.getByRole('region', { name: 'Notifications' });
    expect(region).toHaveAttribute('aria-live', 'polite');
    expect(within(region).queryAllByRole('listitem')).toHaveLength(0);
  });

  it('renders title and description, newest last', () => {
    render(<ToastViewport />);
    act(() => {
      showToast({ tone: 'warning', title: 'Data is stale', description: 'No update for TSLA in 30s.' });
      showToast({ tone: 'error', title: 'Connection lost' });
    });
    const items = within(screen.getByRole('region', { name: 'Notifications' })).getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent('Data is stale');
    expect(items[0]).toHaveTextContent('No update for TSLA in 30s.');
    expect(items[1]).toHaveTextContent('Connection lost');
    expect(items[1]).toHaveClass('ui-toast--error');
  });

  it('auto-dismisses rendered toasts with fake timers', () => {
    render(<ToastViewport />);
    act(() => {
      showToast({ tone: 'success', title: 'Alert created' });
    });
    expect(screen.getByText('Alert created')).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(DEFAULT_TOAST_DURATION_MS);
    });
    expect(screen.queryByText('Alert created')).not.toBeInTheDocument();
  });

  it('shows at most 5 toasts', () => {
    render(<ToastViewport />);
    act(() => {
      for (let i = 1; i <= 8; i++) showToast({ tone: 'info', title: `Alert ${i}` });
    });
    const items = within(screen.getByRole('region', { name: 'Notifications' })).getAllByRole('listitem');
    expect(items).toHaveLength(5);
    expect(items.map((li) => li.textContent)).toEqual([
      'Alert 4',
      'Alert 5',
      'Alert 6',
      'Alert 7',
      'Alert 8',
    ]);
  });

  it('dismisses from the close button', () => {
    render(<ToastViewport />);
    act(() => {
      showToast({ tone: 'info', title: 'Hello', durationMs: 0 });
    });
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss notification' }));
    expect(screen.queryByText('Hello')).not.toBeInTheDocument();
  });

  it('pauses while hovered and resumes on leave', () => {
    render(<ToastViewport />);
    act(() => {
      showToast({ tone: 'info', title: 'Hover', durationMs: 1000 });
    });
    const region = screen.getByRole('region', { name: 'Notifications' });
    fireEvent.mouseEnter(region);
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(screen.getByText('Hover')).toBeInTheDocument();
    fireEvent.mouseLeave(region);
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(screen.queryByText('Hover')).not.toBeInTheDocument();
  });

  it('resumes countdowns if it unmounts while hovered', () => {
    const { unmount } = render(<ToastViewport />);
    act(() => {
      showToast({ tone: 'info', title: 'A', durationMs: 1000 });
      showToast({ tone: 'info', title: 'B', durationMs: 1000 });
    });
    fireEvent.mouseEnter(screen.getByRole('region', { name: 'Notifications' }));
    unmount();
    vi.advanceTimersByTime(1000);
    expect(titles()).toEqual([]);
  });
});
