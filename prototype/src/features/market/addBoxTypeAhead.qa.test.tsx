import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useUiStore } from '../../app/uiStore';
import { ToastViewport } from '../../components/ui/ToastViewport';
import { dismissAllToasts } from '../../components/ui/toastStore';
import { INITIAL_CONNECTION, useConnectionStore } from '../../data/connectionStore';
import { resetDemoData } from '../../data/dataLayer';
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

const addBox = (name: string) => screen.getByRole('combobox', { name: `Add symbol to ${name}` });
const symbolsOf = (id: string) =>
  useWatchlistStore.getState().watchlists.find((w) => w.id === id)?.symbols ?? [];

async function loadLists(activeId: string) {
  await resetDemoData();
  await act(async () => {
    await useWatchlistStore.getState().load({ force: true });
    useWatchlistStore.getState().setActive(activeId);
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
    await loadLists('wl-financials');
    const user = userEvent.setup();
    render(<MarketTable />);
    // Enter lands before the results for "nvda" arrive, then the user types the next symbol.
    await user.type(addBox('Financials'), 'nvda{Enter}amd');
    await waitFor(
      () => {
        expect(symbolsOf('wl-financials')).toContain('NVDA');
      },
      { timeout: 2000 },
    );
    expect(addBox('Financials')).toHaveValue('amd');
  });

  it('keeps the next symbol typed while the first symbol of an empty list saves', async () => {
    await loadLists('wl-ideas');
    const user = userEvent.setup();
    render(<MarketTable />);
    await user.type(addBox('Ideas'), 'nvda');
    await screen.findByRole('option', { name: /^NVDA, NVIDIA/ }, { timeout: 2000 });
    await user.keyboard('{Enter}');
    // The box clears while NVDA saves, so the user starts on the next symbol.
    await user.type(addBox('Ideas'), 'amd');
    await waitFor(
      () => {
        expect(document.querySelector('tr[data-symbol="NVDA"]')).not.toBeNull();
      },
      { timeout: 2000 },
    );
    expect(addBox('Ideas')).toHaveValue('amd');
  });

  it('tells a screen reader that the symbol was added', async () => {
    await loadLists('wl-financials');
    const user = userEvent.setup();
    render(
      <>
        <MarketTable />
        <ToastViewport />
      </>,
    );
    await user.type(addBox('Financials'), 'nvda');
    await screen.findByRole('option', { name: /^NVDA, NVIDIA/ }, { timeout: 2000 });
    await user.keyboard('{Enter}');
    await waitFor(
      () => {
        expect(document.querySelector('tr[data-symbol="NVDA"]')).not.toBeNull();
      },
      { timeout: 2000 },
    );
    expect(liveText()).toMatch(/NVDA/);
  });
});
