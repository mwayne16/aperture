/**
 * Public surface of the data layer. UI code imports from here only, never from `./mock/*`.
 * In the prototype, `api` and `realtime` are mocks over one shared simulated market and repository,
 * so alert changes made through `api` reach the realtime alert evaluation immediately.
 */
import type { MarketApi } from './api';
import { useConnectionStore } from './connectionStore';
import { createMockMarket } from './mock/market';
import { createMockApi } from './mock/mockApi';
import { createMockRealtime } from './mock/mockRealtime';
import { createRepository } from './mock/repository';
import { buildSeedData } from './mock/seed';
import type { SimulationSource } from './mock/simulationSource';
import { useQuoteStore } from './quoteStore';
import type { RealtimeClient } from './realtime';
import { getSimulation, subscribeSimulation, updateSimulation } from './simulationStore';

export { ApiError, isApiError } from './api';
export type { ApiErrorCode, ApiErrorDetail, MarketApi } from './api';
export type { RealtimeClient, Unsubscribe } from './realtime';
export type { FeedScenario, HistoryScenario, SimulationState } from './simulation';
export { useConnection } from './connectionStore';
export { getQuote, useQuote } from './quoteStore';
export { updateSimulation, useSimulation } from './simulationStore';

const simulation: SimulationSource = {
  get: getSimulation,
  patch: updateSimulation,
  subscribe: subscribeSimulation,
};
const market = createMockMarket();
// The seed places the demo alerts relative to the market's current simulated prices.
const repo = createRepository({ seed: () => buildSeedData({ market }) });

/** Singleton API client (mock in the prototype). */
export const api: MarketApi = createMockApi({ repo, market, simulation });
/** Singleton realtime client (mock in the prototype). */
export const realtime: RealtimeClient = createMockRealtime({ repo, market, simulation });

let stopWiring: (() => void) | null = null;
let users = 0;

function wire(): () => void {
  const offQuotes = realtime.onQuotes((quotes) => {
    useQuoteStore.getState().applyBatch(quotes);
  });
  const offConnection = realtime.onConnection((info) => {
    useConnectionStore.getState().setConnection(info);
  });
  useConnectionStore.getState().setConnection(realtime.getConnection());
  realtime.connect();
  return () => {
    realtime.disconnect();
    offQuotes();
    offConnection();
    useConnectionStore.getState().setConnection(realtime.getConnection());
  };
}

/**
 * Connects the realtime client and pipes quotes and connection info into the stores.
 * Idempotent: extra calls never add a second wiring. Each call returns its own teardown (safe to call
 * twice); the wiring stops when every caller has torn down, which suits React StrictMode, HMR and tests.
 */
export function startDataLayer(): () => void {
  users += 1;
  stopWiring ??= wire();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    users -= 1;
    if (users === 0 && stopWiring) {
      const stop = stopWiring;
      stopWiring = null;
      stop();
    }
  };
}

/** Prototype-only: wipe persisted watchlists/alerts and restore the seeded demo data. */
export function resetDemoData(): Promise<void> {
  repo.reset();
  return Promise.resolve();
}
