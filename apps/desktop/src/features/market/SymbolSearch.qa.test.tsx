import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useUiStore } from '../../app/uiStore';
import { dismissAllToasts } from '../../components/ui/toastStore';
import { api, resetDemoData } from '../../data/dataLayer';
import { resetSimulation, updateSimulation } from '../../data/simulationStore';
import type { Instrument } from '../../domain/types';
import { useWatchlistStore } from '../watchlists/watchlistStore';
import { useInstrumentStore } from './instrumentStore';
import { SymbolSearch } from './SymbolSearch';

const initialWatchlists = useWatchlistStore.getState();
const initialUi = useUiStore.getState();

/**
 * Loads the seeded demo watchlist from the mock API into the watchlist store, with an addSymbol
 * that saves through the API and rejects with its ApiError, as the store contract describes.
 */
async function seedFromApi() {
  await resetDemoData();
  const watchlist = await api.getWatchlist();
  const addSymbol = vi.fn(async (symbol: string) => {
    const saved = await api.addSymbol(symbol);
    useWatchlistStore.setState({ watchlist: saved });
  });
  act(() => {
    useWatchlistStore.setState({ status: 'ready', error: null, watchlist, addSymbol });
  });
  return { addSymbol, watchlist };
}

const addBox = () => screen.getByRole('combobox', { name: 'Add symbol to watchlist' });
const globalBox = () => screen.getByRole('combobox', { name: 'Search symbols' });

beforeEach(() => {
  updateSimulation({ apiLatencyMs: 0 });
});

afterEach(() => {
  act(() => {
    useWatchlistStore.setState(initialWatchlists, true);
    useUiStore.setState(initialUi, true);
    useInstrumentStore.setState({ entries: {} });
    dismissAllToasts();
  });
  resetSimulation();
});

describe('SymbolSearch add box with the mock API', () => {
  it('adds the best match when Enter follows a company name before results arrive', async () => {
    const { addSymbol } = await seedFromApi();
    const user = userEvent.setup();
    render(<SymbolSearch variant="add" />);
    // "intel" is also a valid ticker, but the user typed a company name.
    await user.type(addBox(), 'intel{Enter}');
    await waitFor(() => {
      expect(addSymbol).toHaveBeenCalledWith('INTC');
    });
    expect(useWatchlistStore.getState().watchlist?.symbols).toContain('INTC');
    expect(addBox()).toHaveValue('');
  });

  it('shows the API conflict inline when the list changed elsewhere', async () => {
    const { addSymbol, watchlist } = await seedFromApi();
    // The repository already holds JPM, but this window's copy of the list doesn't know yet.
    await api.addSymbol('JPM');
    act(() => {
      useWatchlistStore.setState({ watchlist });
    });
    const user = userEvent.setup();
    render(<SymbolSearch variant="add" />);
    await user.type(addBox(), 'jpm');
    await screen.findByRole('option', { name: /^JPM, JPMorgan/ });
    await user.keyboard('{Enter}');
    expect(
      await screen.findByText('JPM is already in this watchlist.', { selector: 'p' }),
    ).toBeInTheDocument();
    expect(addSymbol).toHaveBeenCalledTimes(1);
    expect(addBox()).toHaveValue('jpm');
    expect(addBox()).toHaveAttribute('aria-invalid', 'true');
  });

  it('reports a duplicate typed before the results arrive without calling the API', async () => {
    const { addSymbol } = await seedFromApi();
    const user = userEvent.setup();
    render(<SymbolSearch variant="add" />);
    await user.type(addBox(), 'nflx{Enter}');
    expect(
      await screen.findByText('NFLX is already in this watchlist.', { selector: 'p' }),
    ).toBeInTheDocument();
    expect(addSymbol).not.toHaveBeenCalled();
  });

  it('keeps text typed for the next symbol while the previous add is still saving', async () => {
    const { addSymbol } = await seedFromApi();
    let finish: () => void = () => undefined;
    addSymbol.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const user = userEvent.setup();
    render(<SymbolSearch variant="add" />);
    await user.type(addBox(), 'jpm');
    await screen.findByRole('option', { name: /^JPM, JPMorgan/ });
    await user.keyboard('{Enter}');
    expect(addSymbol).toHaveBeenCalledWith('JPM');
    // A fast typist starts on the next symbol before the save comes back.
    await user.type(addBox(), 'nv');
    expect(document.querySelector('.symsearch .ui-spinner')).not.toBeNull();
    act(() => {
      finish();
    });
    await waitFor(() => {
      expect(document.querySelector('.symsearch .ui-spinner')).toBeNull();
    });
    expect(addBox()).toHaveValue('nv');
  });

  it('recovers when the user keeps typing after a failed search', async () => {
    await seedFromApi();
    updateSimulation({ failNextApiCall: true });
    const user = userEvent.setup();
    render(<SymbolSearch variant="add" />);
    await user.type(addBox(), 'nvi');
    // The visible message; a visually hidden live region announces the same text.
    expect(
      await screen.findByText(/^Search failed\. The service is temporarily unavailable/, { selector: 'p' }),
    ).toBeInTheDocument();
    await user.type(addBox(), 'd');
    expect(await screen.findByRole('option', { name: /^NVDA, NVIDIA Corporation/ })).toBeInTheDocument();
    expect(screen.queryByText(/^Search failed/, { selector: 'p' })).not.toBeInTheDocument();
  });

  it('searches and adds exactly once under StrictMode', async () => {
    const { addSymbol } = await seedFromApi();
    const search = vi.spyOn(api, 'searchInstruments');
    const user = userEvent.setup();
    render(
      <StrictMode>
        <SymbolSearch variant="add" />
      </StrictMode>,
    );
    await user.type(addBox(), 'ibm');
    await screen.findByRole('option', { name: /^IBM, International Business Machines/ });
    expect(search.mock.calls.filter(([term]) => term === 'ibm')).toHaveLength(1);
    await user.keyboard('{Enter}');
    await waitFor(() => {
      expect(addBox()).toHaveValue('');
    });
    expect(addSymbol).toHaveBeenCalledTimes(1);
    expect(addSymbol).toHaveBeenCalledWith('IBM');
  });
});

describe('SymbolSearch global search with the mock API', () => {
  it('Enter picks the option under the mouse pointer', async () => {
    await seedFromApi();
    const user = userEvent.setup();
    render(<SymbolSearch variant="global" />);
    await user.type(globalBox(), 'a');
    const options = await screen.findAllByRole('option');
    expect(options.length).toBeGreaterThan(2);
    const third = options[2];
    if (!third) throw new Error('expected a third option');
    const symbol = third.querySelector('.symsearch__symbol')?.textContent;
    await user.hover(third);
    expect(globalBox()).toHaveAttribute('aria-activedescendant', third.id);
    await user.keyboard('{Enter}');
    expect(useUiStore.getState().selectedSymbol).toBe(symbol);
  });

  it('does not reopen the list when a response arrives after the box was cleared', async () => {
    await seedFromApi();
    const pending: ((results: Instrument[]) => void)[] = [];
    vi.spyOn(api, 'searchInstruments').mockImplementation(
      () =>
        new Promise((resolve) => {
          pending.push(resolve);
        }),
    );
    const user = userEvent.setup();
    render(<SymbolSearch variant="global" />);
    await user.type(globalBox(), 'ms');
    await waitFor(() => {
      expect(pending).toHaveLength(1);
    });
    await user.clear(globalBox());
    act(() => {
      pending[0]?.([{ symbol: 'MSFT', name: 'Microsoft Corporation', exchange: 'NASDAQ', assetClass: 'stock' }]);
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(globalBox()).toHaveAttribute('aria-expanded', 'false');
  });

  it('adds to the watchlist with Shift+Enter through the API, then shows it as in the list', async () => {
    const { addSymbol } = await seedFromApi();
    const user = userEvent.setup();
    render(<SymbolSearch variant="global" />);
    await user.type(globalBox(), 'xom');
    await screen.findByRole('option', { name: /^XOM, Exxon/ });
    await user.keyboard('{Shift>}{Enter}{/Shift}');
    await waitFor(() => {
      expect(addSymbol).toHaveBeenCalledWith('XOM');
    });
    expect(await screen.findByRole('option', { name: /^XOM, .*, in your watchlist$/ })).toHaveTextContent(
      'In list',
    );
    expect((await api.getWatchlist()).symbols.at(-1)).toBe('XOM');
    expect(useUiStore.getState().selectedSymbol).toBeNull();
  });
});
