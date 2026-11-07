import { act } from '@testing-library/react';
import { useUiStore } from '../../app/uiStore';
import { dismissAllToasts, useToastStore } from '../../components/ui/toastStore';
import { INITIAL_CONNECTION, useConnectionStore } from '../../data/connectionStore';
import { resetDemoData } from '../../data/dataLayer';
import { useQuoteStore } from '../../data/quoteStore';
import { resetSimulation, updateSimulation } from '../../data/simulationStore';
import type { Quote } from '../../domain/types';
import { useAlertStore } from './alertStore';

/** Test-only helpers shared by the alerts component tests. */

/** Seeded demo data, an instant mock API, a connected simulated feed, and empty stores. */
export async function resetAlertsTestState(): Promise<void> {
  resetSimulation();
  updateSimulation({ apiLatencyMs: 0 });
  await resetDemoData();
  useAlertStore.setState(useAlertStore.getInitialState(), true);
  useUiStore.setState(useUiStore.getInitialState(), true);
  useQuoteStore.getState().clear();
  useConnectionStore.getState().setConnection({ ...INITIAL_CONNECTION, state: 'connected' });
  dismissAllToasts();
}

/** Puts a live quote for `symbol` into the quote store. */
export function setQuote(symbol: string, last: number, patch: Partial<Quote> = {}): void {
  const quote: Quote = {
    symbol,
    last,
    lastTradeAt: Date.now(),
    bid: null,
    bidSize: null,
    ask: null,
    askSize: null,
    quoteAt: null,
    open: null,
    high: null,
    low: null,
    prevClose: last,
    volume: null,
    change: 0,
    changePct: 0,
    status: 'live',
    updatedAt: Date.now(),
    ...patch,
  };
  act(() => {
    useQuoteStore.getState().applyBatch([quote]);
  });
}

export function toastTitles(): string[] {
  return useToastStore.getState().toasts.map((t) => t.title);
}
