/**
 * Prototype-only simulation controls. They let a reviewer force each connection and data state
 * without a backend. Removed in Phase 5.
 */

export type FeedScenario =
  /** Ticks flow; quotes are "live"; connection "connected". */
  | 'live'
  /** Ticks flow with timestamps 15 minutes old; quotes are "delayed". */
  | 'delayed'
  /** Connected but no ticks arrive; quotes turn "stale" after STALE_AFTER_MS. */
  | 'stale'
  /** Connection drops and retries with exponential backoff (1s, 2s, 4s… capped at 30s) and never succeeds. */
  | 'disconnected'
  /** Connection drops, shows "reconnecting" for ~4s, then recovers and replays a snapshot. */
  | 'flaky';

export type HistoryScenario =
  /** History loads after ~400ms. */
  | 'normal'
  /** History loads after ~2.5s, to show the loading state. */
  | 'slow'
  /** Request succeeds with zero bars. */
  | 'empty'
  /** Request fails with PROVIDER_ERROR. */
  | 'error';

export interface SimulationState {
  feedScenario: FeedScenario;
  historyScenario: HistoryScenario;
  /** Trade updates per second across all subscribed symbols, 1-50. */
  ticksPerSecond: number;
  /** Artificial latency for watchlist/alert/search API calls, 0-3000ms. */
  apiLatencyMs: number;
  /** When true, the next API call rejects with UNAVAILABLE, then this resets to false. */
  failNextApiCall: boolean;
}

export const STALE_AFTER_MS = 10_000;

export const DEFAULT_SIMULATION: SimulationState = {
  feedScenario: 'live',
  historyScenario: 'normal',
  ticksPerSecond: 12,
  apiLatencyMs: 350,
  failNextApiCall: false,
};
