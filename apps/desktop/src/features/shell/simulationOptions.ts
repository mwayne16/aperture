import { HISTORY_DELAY_MS } from '../../data/mock/mockApi';
import { DELAYED_FEED_MS, FLAKY_DROP_AFTER_MS, FLAKY_RECOVER_AFTER_MS } from '../../data/mock/mockRealtime';
import {
  DEFAULT_SIMULATION,
  STALE_AFTER_MS,
  type FeedScenario,
  type HistoryScenario,
  type SimulationState,
} from '../../data/simulation';

/**
 * Names and one-line explanations for the prototype's simulation scenarios. The timings come from
 * the mock layer's own constants, so the text stays true if the mocks change.
 */

interface ScenarioInfo {
  label: string;
  description: string;
}

const seconds = (ms: number) => `${ms / 1000} seconds`;
const minutes = (ms: number) => `${ms / 60_000} minutes`;

export const FEED_SCENARIO_INFO: Readonly<Record<FeedScenario, ScenarioInfo>> = {
  live: { label: 'Live', description: 'Trades stream continuously and quotes are marked live.' },
  delayed: {
    label: 'Delayed',
    description: `Trades stream with timestamps ${minutes(DELAYED_FEED_MS)} old, like a delayed data plan.`,
  },
  stale: {
    label: 'Stale',
    description: `Connected, but no trades arrive. Quotes turn stale after ${seconds(STALE_AFTER_MS)}.`,
  },
  disconnected: {
    label: 'Disconnected',
    description: 'The feed is unreachable. The client keeps retrying with growing backoff.',
  },
  flaky: {
    label: 'Flaky',
    description: `Drops every ${seconds(FLAKY_DROP_AFTER_MS)} and recovers about ${seconds(FLAKY_RECOVER_AFTER_MS)} later.`,
  },
};

export const HISTORY_SCENARIO_INFO: Readonly<Record<HistoryScenario, ScenarioInfo>> = {
  normal: { label: 'Normal', description: `Chart history loads after ${HISTORY_DELAY_MS.normal} ms.` },
  slow: {
    label: 'Slow',
    description: `Chart history takes ${seconds(HISTORY_DELAY_MS.slow)}, to show the loading state.`,
  },
  empty: { label: 'Empty', description: 'Chart history loads with no bars, to show the empty state.' },
  error: { label: 'Error', description: 'Chart history requests fail with a provider error.' },
};

/** True when every simulation control is at its default, so "Restore defaults" has nothing to do. */
export function isDefaultSimulation(simulation: SimulationState): boolean {
  return (Object.keys(DEFAULT_SIMULATION) as (keyof SimulationState)[]).every(
    (key) => simulation[key] === DEFAULT_SIMULATION[key],
  );
}
