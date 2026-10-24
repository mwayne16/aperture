/**
 * Public surface of the data layer. UI code imports from here only, never from `./mock/*`.
 * Implemented by the data-layer task; these stubs only fix the signatures.
 */
import type { ConnectionInfo, Quote } from '../domain/types';
import type { MarketApi } from './api';
import type { RealtimeClient } from './realtime';
import type { SimulationState } from './simulation';

export { ApiError, isApiError } from './api';
export type { ApiErrorCode, ApiErrorDetail, MarketApi } from './api';
export type { RealtimeClient, Unsubscribe } from './realtime';
export type { FeedScenario, HistoryScenario, SimulationState } from './simulation';

/** Singleton API client (mock in the prototype). */
export declare const api: MarketApi;
/** Singleton realtime client (mock in the prototype). */
export declare const realtime: RealtimeClient;

/**
 * Connects the realtime client and pipes quotes and connection info into the stores below.
 * Idempotent. Returns a function that tears the wiring down (used by tests and HMR).
 */
export declare function startDataLayer(): () => void;

/** Latest quote for one symbol. Re-renders only when that symbol's quote object changes. */
export declare function useQuote(symbol: string): Quote | undefined;
/** Current connection info. */
export declare function useConnection(): ConnectionInfo;
/** Non-hook read of a quote, for event handlers. */
export declare function getQuote(symbol: string): Quote | undefined;

/** Prototype-only simulation controls. */
export declare function useSimulation(): SimulationState;
export declare function updateSimulation(patch: Partial<SimulationState>): void;
/** Prototype-only: wipe persisted watchlists/alerts and restore the seeded demo data. */
export declare function resetDemoData(): Promise<void>;
