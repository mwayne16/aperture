import { create } from 'zustand';
import type { Unsubscribe } from './realtime';
import {
  DEFAULT_SIMULATION,
  type FeedScenario,
  type HistoryScenario,
  type SimulationState,
} from './simulation';

/** Prototype-only simulation controls. Not persisted: a reload starts from DEFAULT_SIMULATION. */

export const TICKS_PER_SECOND_RANGE = { min: 1, max: 50 } as const;
export const API_LATENCY_RANGE = { min: 0, max: 3000 } as const;

const FEED_SCENARIOS: readonly FeedScenario[] = ['live', 'delayed', 'stale', 'disconnected', 'flaky'];
const HISTORY_SCENARIOS: readonly HistoryScenario[] = ['normal', 'slow', 'empty', 'error'];

export interface SimulationStoreState {
  simulation: SimulationState;
}

export const useSimulationStore = create<SimulationStoreState>()(() => ({
  simulation: DEFAULT_SIMULATION,
}));

function clampInteger(value: unknown, range: { min: number; max: number }, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(range.max, Math.max(range.min, Math.round(value)));
}

/**
 * Applies a partial update. Numbers are rounded and clamped (ticksPerSecond 1-50, apiLatencyMs
 * 0-3000); non-numeric numbers, unknown scenarios and non-boolean flags are ignored.
 */
export function updateSimulation(patch: Partial<SimulationState>): void {
  const current = useSimulationStore.getState().simulation;
  const input = patch as Partial<Record<keyof SimulationState, unknown>>;
  const next: SimulationState = {
    feedScenario: FEED_SCENARIOS.find((s) => s === input.feedScenario) ?? current.feedScenario,
    historyScenario: HISTORY_SCENARIOS.find((s) => s === input.historyScenario) ?? current.historyScenario,
    ticksPerSecond: clampInteger(input.ticksPerSecond, TICKS_PER_SECOND_RANGE, current.ticksPerSecond),
    apiLatencyMs: clampInteger(input.apiLatencyMs, API_LATENCY_RANGE, current.apiLatencyMs),
    failNextApiCall:
      typeof input.failNextApiCall === 'boolean' ? input.failNextApiCall : current.failNextApiCall,
  };
  const changed = (Object.keys(next) as (keyof SimulationState)[]).some((key) => next[key] !== current[key]);
  if (changed) useSimulationStore.setState({ simulation: next });
}

export function getSimulation(): SimulationState {
  return useSimulationStore.getState().simulation;
}

export function subscribeSimulation(listener: (state: SimulationState) => void): Unsubscribe {
  return useSimulationStore.subscribe((state, previous) => {
    if (state.simulation !== previous.simulation) listener(state.simulation);
  });
}

/** Restores the defaults (tests). */
export function resetSimulation(): void {
  useSimulationStore.setState({ simulation: DEFAULT_SIMULATION });
}

/** Current simulation controls. */
export function useSimulation(): SimulationState {
  return useSimulationStore((state) => state.simulation);
}
