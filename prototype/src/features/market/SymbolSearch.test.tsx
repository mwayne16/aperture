import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useUiStore } from '../../app/uiStore';
import { dismissAllToasts, useToastStore } from '../../components/ui/toastStore';
import { ApiError } from '../../data/api';
import { api } from '../../data/dataLayer';
import { resetSimulation, updateSimulation } from '../../data/simulationStore';
import type { Instrument } from '../../domain/types';
import { useWatchlistStore } from '../watchlists/watchlistStore';
import { useInstrumentStore } from './instrumentStore';
import { SymbolSearch } from './SymbolSearch';

const initialWatchlists = useWatchlistStore.getState();
const initialUi = useUiStore.getState();

/** One active watchlist "Core" with an addSymbol that behaves like the real store on success. */
function seedWatchlist(symbols: string[] = ['AAPL']) {
  const addSymbol = vi.fn((_id: string, symbol: string) => {
    useWatchlistStore.setState((s) => ({
      watchlists: s.watchlists.map((w) => ({ ...w, symbols: [...w.symbols, symbol] })),
    }));
    return Promise.resolve();
  });
  act(() => {
    useWatchlistStore.setState({
      status: 'ready',
      watchlists: [{ id: 'wl-1', name: 'Core', symbols, createdAt: '', updatedAt: '' }],
      activeId: 'wl-1',
      addSymbol,
    });
  });
  return { addSymbol };
}

const addBox = () => screen.getByRole('combobox', { name: 'Add symbol to Core' });
const globalBox = () => screen.getByRole('combobox', { name: 'Search symbols' });
const findOption = (name: RegExp) => screen.findByRole('option', { name });
const toastTitles = () => useToastStore.getState().toasts.map((t) => t.title);

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

describe('SymbolSearch add variant', () => {
  it('searches as you type and adds the highlighted match with Enter', async () => {
    const { addSymbol } = seedWatchlist();
    const onDone = vi.fn();
    const user = userEvent.setup();
    render(<SymbolSearch variant="add" watchlistId="wl-1" onDone={onDone} />);
    await user.type(addBox(), 'msf');
    const msft = await findOption(/^MSFT, Microsoft Corporation, NASDAQ$/);
    expect(msft).toHaveAttribute('aria-selected', 'true');
    expect(addBox()).toHaveAttribute('aria-expanded', 'true');
    expect(addBox()).toHaveAttribute('aria-activedescendant', msft.id);

    await user.keyboard('{Enter}');
    await waitFor(() => {
      expect(onDone).toHaveBeenCalledTimes(1);
    });
    expect(addSymbol).toHaveBeenCalledWith('wl-1', 'MSFT');
    expect(addBox()).toHaveValue('');
  });

  it('moves the highlight with the arrow keys and wraps at the ends', async () => {
    seedWatchlist();
    const user = userEvent.setup();
    render(<SymbolSearch variant="add" watchlistId="wl-1" />);
    await user.type(addBox(), 'msf');
    const msft = await findOption(/^MSFT/);
    const typed = screen.getByRole('option', { name: /Add MSF as typed/ });
    await user.keyboard('{ArrowDown}');
    expect(addBox()).toHaveAttribute('aria-activedescendant', typed.id);
    await user.keyboard('{ArrowDown}');
    expect(addBox()).toHaveAttribute('aria-activedescendant', msft.id);
    await user.keyboard('{ArrowUp}');
    expect(typed).toHaveAttribute('aria-selected', 'true');
  });

  it('adds a valid symbol typed exactly, even before results arrive and when nothing lists it', async () => {
    const { addSymbol } = seedWatchlist();
    const user = userEvent.setup();
    render(<SymbolSearch variant="add" watchlistId="wl-1" />);
    await user.type(addBox(), 'zzzz{Enter}');
    await waitFor(() => {
      expect(addSymbol).toHaveBeenCalledWith('wl-1', 'ZZZZ');
    });
  });

  it('reports a duplicate inline without calling the API, and clears it on typing', async () => {
    const { addSymbol } = seedWatchlist(['AAPL']);
    const user = userEvent.setup();
    render(<SymbolSearch variant="add" watchlistId="wl-1" />);
    await user.type(addBox(), 'aapl');
    expect(await findOption(/^AAPL, Apple Inc\./)).toHaveTextContent('Added');
    await user.keyboard('{Enter}');
    const message = screen.getByText('AAPL is already in this watchlist.', { selector: 'p' });
    expect(addBox()).toHaveAttribute('aria-invalid', 'true');
    expect(addBox().getAttribute('aria-describedby')).toContain(message.id);
    expect(addSymbol).not.toHaveBeenCalled();
    await user.type(addBox(), 'x');
    expect(screen.queryByText('AAPL is already in this watchlist.', { selector: 'p' })).not.toBeInTheDocument();
  });

  it('explains an invalid symbol inline', async () => {
    const { addSymbol } = seedWatchlist();
    const user = userEvent.setup();
    render(<SymbolSearch variant="add" watchlistId="wl-1" />);
    await user.type(addBox(), '12{Enter}');
    expect(await screen.findByText(/Use 1-5 letters/, { selector: 'p' })).toBeInTheDocument();
    expect(addSymbol).not.toHaveBeenCalled();
  });

  it('shows the API error inline when the add fails', async () => {
    const { addSymbol } = seedWatchlist();
    addSymbol.mockRejectedValueOnce(new ApiError('CONFLICT', 'MSFT is already in this watchlist.', 409));
    const user = userEvent.setup();
    render(<SymbolSearch variant="add" watchlistId="wl-1" />);
    await user.type(addBox(), 'msft');
    await findOption(/^MSFT/);
    await user.keyboard('{Enter}');
    expect(await screen.findByText('MSFT is already in this watchlist.', { selector: 'p' })).toBeInTheDocument();
    expect(addBox()).toHaveValue('msft');
  });

  it('keeps the next symbol typed during a failed add and still shows the error', async () => {
    const { addSymbol } = seedWatchlist();
    let fail: () => void = () => undefined;
    addSymbol.mockImplementationOnce(
      () =>
        new Promise<void>((_, reject) => {
          fail = () => {
            reject(new ApiError('CONFLICT', 'MSFT is already in this watchlist.', 409));
          };
        }),
    );
    const user = userEvent.setup();
    render(<SymbolSearch variant="add" watchlistId="wl-1" />);
    await user.type(addBox(), 'msft');
    await findOption(/^MSFT/);
    await user.keyboard('{Enter}');
    // The box clears while the add saves.
    expect(addBox()).toHaveValue('');
    await user.type(addBox(), 'nv');
    act(() => {
      fail();
    });
    expect(await screen.findByText('MSFT is already in this watchlist.', { selector: 'p' })).toBeInTheDocument();
    expect(addBox()).toHaveValue('nv');
  });

  it('adds once when Enter is pressed repeatedly during a slow add', async () => {
    const { addSymbol } = seedWatchlist();
    let finish: () => void = () => undefined;
    addSymbol.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const user = userEvent.setup();
    render(<SymbolSearch variant="add" watchlistId="wl-1" />);
    await user.type(addBox(), 'msft');
    await findOption(/^MSFT/);
    await user.keyboard('{Enter}{Enter}{Enter}');
    expect(addSymbol).toHaveBeenCalledTimes(1);
    act(() => {
      finish();
    });
    await waitFor(() => {
      expect(addBox()).toHaveValue('');
    });
  });

  it('adds the option that is clicked', async () => {
    const { addSymbol } = seedWatchlist();
    const user = userEvent.setup();
    render(<SymbolSearch variant="add" watchlistId="wl-1" />);
    await user.type(addBox(), 'nvid');
    await user.click(await findOption(/^NVDA/));
    await waitFor(() => {
      expect(addSymbol).toHaveBeenCalledWith('wl-1', 'NVDA');
    });
  });

  it('closes the list with Escape, then clears the text with a second Escape', async () => {
    seedWatchlist();
    const user = userEvent.setup();
    render(<SymbolSearch variant="add" watchlistId="wl-1" />);
    await user.type(addBox(), 'msft');
    await findOption(/^MSFT/);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(addBox()).toHaveAttribute('aria-expanded', 'false');
    expect(addBox()).toHaveValue('msft');
    await user.keyboard('{Escape}');
    expect(addBox()).toHaveValue('');
  });
});

describe('SymbolSearch results', () => {
  it('ignores a response that arrives after a newer one', async () => {
    seedWatchlist();
    const pending: ((results: Instrument[]) => void)[] = [];
    vi.spyOn(api, 'searchInstruments').mockImplementation(
      () =>
        new Promise((resolve) => {
          pending.push(resolve);
        }),
    );
    const user = userEvent.setup();
    render(<SymbolSearch variant="global" />);
    await user.type(globalBox(), 'a');
    await waitFor(() => {
      expect(pending).toHaveLength(1);
    });
    await user.type(globalBox(), 'b');
    await waitFor(() => {
      expect(pending).toHaveLength(2);
    });
    act(() => {
      pending[1]?.([{ symbol: 'ABBV', name: 'AbbVie Inc.', exchange: 'NYSE', assetClass: 'stock' }]);
    });
    await findOption(/^ABBV/);
    act(() => {
      pending[0]?.([{ symbol: 'AAPL', name: 'Apple Inc.', exchange: 'NASDAQ', assetClass: 'stock' }]);
    });
    await Promise.resolve();
    expect(screen.queryByRole('option', { name: /^AAPL/ })).not.toBeInTheDocument();
    expect(screen.getAllByRole('option')).toHaveLength(1);
  });

  it('keeps the current matches while the text is extended, but drops matches for unrelated text', async () => {
    seedWatchlist();
    const user = userEvent.setup();
    render(<SymbolSearch variant="global" />);
    await user.type(globalBox(), 'nv');
    await findOption(/^NVDA/);
    vi.spyOn(api, 'searchInstruments').mockReturnValue(new Promise<Instrument[]>(() => undefined));
    await user.type(globalBox(), 'd');
    expect(screen.getByRole('option', { name: /^NVDA/ })).toBeInTheDocument();

    await user.clear(globalBox());
    await user.type(globalBox(), 'coca');
    expect(screen.queryByRole('option', { name: /^NVDA/ })).not.toBeInTheDocument();
    expect(screen.getByText('Searching…', { selector: 'p' })).toBeInTheDocument();
  });

  it('says when the search fails', async () => {
    seedWatchlist();
    vi.spyOn(api, 'searchInstruments').mockRejectedValue(
      new ApiError('UNAVAILABLE', 'The service is temporarily unavailable.', 503),
    );
    const user = userEvent.setup();
    render(<SymbolSearch variant="global" />);
    await user.type(globalBox(), 'ms');
    expect(
      await screen.findByText('Search failed. The service is temporarily unavailable.', { selector: 'p' }),
    ).toBeInTheDocument();
  });

  it('says when nothing matches', async () => {
    seedWatchlist();
    const user = userEvent.setup();
    render(<SymbolSearch variant="global" />);
    await user.type(globalBox(), 'qqqqq');
    expect(await screen.findByText('No matching symbols', { selector: 'p' })).toBeInTheDocument();
    expect(globalBox()).toHaveAttribute('aria-expanded', 'false');
  });
});

describe('SymbolSearch global variant', () => {
  it('selects the highlighted symbol for the detail panel with Enter and clears the box', async () => {
    seedWatchlist();
    const onDone = vi.fn();
    const user = userEvent.setup();
    render(<SymbolSearch variant="global" onDone={onDone} />);
    await user.type(globalBox(), 'nvda');
    await findOption(/^NVDA/);
    await user.keyboard('{Enter}');
    expect(useUiStore.getState().selectedSymbol).toBe('NVDA');
    expect(globalBox()).toHaveValue('');
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('selects the best match when Enter is pressed before the results arrive', async () => {
    seedWatchlist();
    const user = userEvent.setup();
    render(<SymbolSearch variant="global" />);
    await user.type(globalBox(), 'nvidia{Enter}');
    await waitFor(() => {
      expect(useUiStore.getState().selectedSymbol).toBe('NVDA');
    });
  });

  it('selects a clicked option', async () => {
    seedWatchlist();
    const user = userEvent.setup();
    render(<SymbolSearch variant="global" />);
    await user.type(globalBox(), 'tsl');
    await user.click(await findOption(/^TSLA/));
    expect(useUiStore.getState().selectedSymbol).toBe('TSLA');
  });

  it('adds to the active watchlist with Shift+Enter and then marks the option as in the list', async () => {
    const { addSymbol } = seedWatchlist();
    const user = userEvent.setup();
    render(<SymbolSearch variant="global" />);
    await user.type(globalBox(), 'nvda');
    await findOption(/^NVDA, NVIDIA Corporation, NASDAQ$/);
    await user.keyboard('{Shift>}{Enter}{/Shift}');
    await waitFor(() => {
      expect(addSymbol).toHaveBeenCalledWith('wl-1', 'NVDA');
    });
    expect(toastTitles()).toContain('Added NVDA to Core');
    expect(await findOption(/^NVDA, .*, in Core$/)).toHaveTextContent('In list');
    expect(useUiStore.getState().selectedSymbol).toBeNull();
  });

  it('adds with the option Add button without selecting the symbol', async () => {
    const { addSymbol } = seedWatchlist();
    const user = userEvent.setup();
    render(<SymbolSearch variant="global" />);
    await user.type(globalBox(), 'tsla');
    const tsla = await findOption(/^TSLA/);
    await user.click(within(tsla).getByText('Add'));
    await waitFor(() => {
      expect(addSymbol).toHaveBeenCalledWith('wl-1', 'TSLA');
    });
    expect(useUiStore.getState().selectedSymbol).toBeNull();
    expect(globalBox()).toHaveFocus();
  });

  it('reports a symbol already in the watchlist with a toast', async () => {
    const { addSymbol } = seedWatchlist(['AAPL']);
    const user = userEvent.setup();
    render(<SymbolSearch variant="global" />);
    await user.type(globalBox(), 'aapl');
    await findOption(/^AAPL/);
    await user.keyboard('{Shift>}{Enter}{/Shift}');
    expect(toastTitles()).toContain('AAPL is already in this watchlist.');
    expect(addSymbol).not.toHaveBeenCalled();
  });

  it('takes focus when Ctrl+K asks for it, but not on mount, also under StrictMode', () => {
    seedWatchlist();
    render(
      <StrictMode>
        <SymbolSearch variant="global" />
      </StrictMode>,
    );
    expect(globalBox()).not.toHaveFocus();
    act(() => {
      useUiStore.getState().requestSearchFocus();
    });
    expect(globalBox()).toHaveFocus();
  });

  it('shows the Ctrl K hint until something is typed', async () => {
    seedWatchlist();
    const user = userEvent.setup();
    render(<SymbolSearch variant="global" />);
    expect(screen.getByText('Ctrl')).toBeInTheDocument();
    await user.type(globalBox(), 'a');
    expect(screen.queryByText('Ctrl')).not.toBeInTheDocument();
  });
});
