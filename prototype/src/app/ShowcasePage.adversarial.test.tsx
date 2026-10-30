import { act, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ShowcasePage } from './ShowcasePage';
import { dismissAllToasts } from '../components/ui/toastStore';

afterEach(() => {
  act(() => {
    dismissAllToasts();
  });
  vi.useRealTimers();
});

describe('ShowcasePage (adversarial)', () => {
  it('keeps exactly one h1 "Aperture"', () => {
    render(<ShowcasePage />);
    const h1s = screen.getAllByRole('heading', { level: 1 });
    expect(h1s).toHaveLength(1);
    expect(h1s[0]).toHaveTextContent('Aperture');
  });

  it('flashes exactly one quote row and uses tabular numerals for numbers', () => {
    vi.useFakeTimers();
    render(<ShowcasePage />);
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    const grid = screen.getByRole('grid', { name: 'Simulated quotes' });
    const rows = within(grid).getAllByRole('row').slice(1);
    const flashingRows = rows.filter((r) => r.querySelector('.flash-up, .flash-down'));
    expect(flashingRows).toHaveLength(1);
    // Every numeric cell must not jitter: it or an ancestor carries tabular numerals.
    const lastCell = rows[0]!.querySelectorAll('td')[1]!;
    const tabular = lastCell.closest('.num, .mono, .ui-table, table');
    expect(tabular).not.toBeNull();
  });

  it('stops the flash interval when unmounted (no timer leak)', () => {
    vi.useFakeTimers();
    const { unmount } = render(<ShowcasePage />);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('shows a theme switcher with system, dark and light', () => {
    render(<ShowcasePage />);
    const theme = screen.getByRole('radiogroup', { name: 'Theme' });
    const names = within(theme)
      .getAllByRole('radio')
      .map((r) => r.textContent.trim().toLowerCase());
    expect(names).toEqual(expect.arrayContaining(['system', 'dark', 'light']));
  });
});
