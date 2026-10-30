import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { App } from './App';
import { dismissAllToasts } from './components/ui/toastStore';

afterEach(() => {
  act(() => {
    dismissAllToasts();
  });
});

describe('App', () => {
  it('renders the app name', () => {
    render(<App />);
    expect(screen.getByRole('heading', { level: 1, name: 'Aperture' })).toBeInTheDocument();
  });

  it('marks the page as simulated data', () => {
    render(<App />);
    expect(screen.getByText('Simulated data')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: /Quotes/ })).toHaveTextContent('SIMULATED');
  });

  it('shows a dense quote table with 10 rows, one selected', () => {
    render(<App />);
    const grid = screen.getByRole('grid', { name: 'Simulated quotes' });
    const headers = within(grid)
      .getAllByRole('columnheader')
      .map((h) => h.textContent);
    expect(headers).toEqual(['Symbol', 'Last', 'Chg', 'Chg%', 'Bid', 'Ask', 'Volume']);
    const rows = within(grid).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(10);
    expect(rows.filter((r) => r.getAttribute('aria-selected') === 'true')).toHaveLength(1);
  });

  it('colors gains and losses and keeps unchanged rows neutral', () => {
    render(<App />);
    const grid = screen.getByRole('grid', { name: 'Simulated quotes' });
    const row = (symbol: string) => within(grid).getByText(symbol).closest('tr')!;
    expect(within(row('AAPL')).getByText('+2.31')).toHaveClass('is-gain');
    expect(within(row('TSLA')).getByText('−9.37')).toHaveClass('is-loss');
    expect(within(row('BRK.B')).getByText('0.00')).toHaveClass('is-muted');
  });

  it('moves the selection with the keyboard and the mouse', async () => {
    const user = userEvent.setup();
    render(<App />);
    const grid = screen.getByRole('grid', { name: 'Simulated quotes' });
    const selected = () =>
      within(grid)
        .getAllByRole('row')
        .find((r) => r.getAttribute('aria-selected') === 'true')
        ?.querySelector('.sc-symbol')?.textContent;
    expect(selected()).toBe('AAPL');

    grid.focus();
    await user.keyboard('{ArrowUp}'); // already at the top: stays
    expect(selected()).toBe('AAPL');
    await user.keyboard('{ArrowDown}{ArrowDown}');
    expect(selected()).toBe('NVDA');

    await user.click(within(grid).getByText('AMD'));
    expect(selected()).toBe('AMD');
    await user.keyboard('{ArrowDown}'); // already at the bottom: stays
    expect(selected()).toBe('AMD');
  });

  it('switches the theme on <html> from the showcase', async () => {
    const user = userEvent.setup();
    render(<App />);
    const theme = screen.getByRole('radiogroup', { name: 'Theme' });
    await user.click(within(theme).getByRole('radio', { name: 'Light' }));
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(localStorage.getItem('aperture.theme')).toBe('light');
    await user.click(within(theme).getByRole('radio', { name: 'Dark' }));
    expect(document.documentElement.dataset.theme).toBe('dark');
  });

  it('opens a toast from the showcase', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: 'Warning' }));
    const region = screen.getByRole('region', { name: 'Notifications' });
    expect(within(region).getByText('Data is stale')).toBeInTheDocument();
  });

  it('opens and closes the showcase dialog', async () => {
    const user = userEvent.setup();
    render(<App />);
    const opener = screen.getByRole('button', { name: 'Rename watchlist' });
    await user.click(opener);
    expect(screen.getByRole('dialog', { name: 'Rename watchlist' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Name' })).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });
});
