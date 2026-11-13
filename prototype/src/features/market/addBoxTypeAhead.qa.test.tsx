import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useUiStore } from '../../app/uiStore';
import { ToastViewport } from '../../components/ui/ToastViewport';
import { dismissAllToasts } from '../../components/ui/toastStore';
import { INITIAL_CONNECTION, useConnectionStore } from '../../data/connectionStore';
import { api, resetDemoData } from '../../data/dataLayer';
import { SEED_WATCHLIST_SYMBOLS } from '../../data/mock/seed';
import { resetSimulation, updateSimulation } from '../../data/simulationStore';
import { useWatchlistStore } from '../watchlists/watchlistStore';
import { useInstrumentStore } from './instrumentStore';
import { MarketTable } from './MarketTable';

/**
 * The market table's add box against the real watchlist store and mock API, with enough latency
 * that a fast typist starts on the next symbol before the previous one is saved.
 */

const LATENCY_MS = 200;
const initialWatchlists = useWatchlistStore.getState();
const initialUi = useUiStore.getState();

const addBox = () => screen.getByRole('combobox', { name: 'Add symbol to watchlist' });
const symbols = () => useWatchlistStore.getState().watchlist?.symbols ?? [];

/** Loads the demo watchlist into the real store, emptied first when asked. */
async function loadWatchlist({ empty = false } = {}) {
  await resetDemoData();
  if (empty) {
    updateSimulation({ apiLatencyMs: 0 });
    for (const symbol of SEED_WATCHLIST_SYMBOLS) await api.removeSymbol(symbol);
    updateSimulation({ apiLatencyMs: LATENCY_MS });
  }
  await act(async () => {
    await useWatchlistStore.getState().load({ force: true });
  });
}

/** Text of every live region, where a screen reader hears status messages. */
function liveText(): string {
  return [...document.querySelectorAll('[aria-live], [role="status"], [role="alert"]')]
    .map((el) => el.textContent)
    .join(' ');
}

beforeEach(() => {
  updateSimulation({ apiLatencyMs: LATENCY_MS });
  act(() => {
    useConnectionStore.getState().setConnection({ ...INITIAL_CONNECTION, state: 'connected' });
  });
});

afterEach(() => {
  act(() => {
    useWatchlistStore.setState(initialWatchlists, true);
    useUiStore.setState(initialUi, true);
    useInstrumentStore.setState({ entries: {} });
    useConnectionStore.getState().setConnection(INITIAL_CONNECTION);
    dismissAllToasts();
  });
  resetSimulation();
});

describe('market add box type-ahead (QA)', () => {
  it('still adds a symbol when Enter beats the search and the next symbol is typed right away', async () => {
    await loadWatchlist();
    const user = userEvent.setup();
    render(<MarketTable />);
    // Enter lands before the results for "jpm" arrive, then the user types the next symbol.
    await user.type(addBox(), 'jpm{Enter}xom');
    await waitFor(
      () => {
        expect(symbols()).toContain('JPM');
      },
      { timeout: 2000 },
    );
    expect(addBox()).toHaveValue('xom');
  });

  it('keeps the next symbol typed while the first symbol of an empty list saves', async () => {
    await loadWatchlist({ empty: true });
    const user = userEvent.setup();
    render(<MarketTable />);
    await user.type(addBox(), 'nvda');
    await screen.findByRole('option', { name: /^NVDA, NVIDIA/ }, { timeout: 2000 });
    await user.keyboard('{Enter}');
    // The box clears while NVDA saves, so the user starts on the next symbol.
    await user.type(addBox(), 'amd');
    await waitFor(
      () => {
        expect(document.querySelector('tr[data-symbol="NVDA"]')).not.toBeNull();
      },
      { timeout: 2000 },
    );
    expect(addBox()).toHaveValue('amd');
  });

  it('tells a screen reader that the symbol was added', async () => {
    await loadWatchlist();
    const user = userEvent.setup();
    render(
      <>
        <MarketTable />
        <ToastViewport />
      </>,
    );
    await user.type(addBox(), 'jpm');
    await screen.findByRole('option', { name: /^JPM, JPMorgan/ }, { timeout: 2000 });
    await user.keyboard('{Enter}');
    await waitFor(
      () => {
        expect(document.querySelector('tr[data-symbol="JPM"]')).not.toBeNull();
      },
      { timeout: 2000 },
    );
    expect(liveText()).toMatch(/Added JPM to your watchlist/);
  });
});
