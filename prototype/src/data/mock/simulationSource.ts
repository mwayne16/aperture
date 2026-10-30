import type { Unsubscribe } from '../realtime';
import { DEFAULT_SIMULATION, type SimulationState } from '../simulation';

/**
 * How the mocks read the prototype simulation controls. The app passes an adapter over the zustand
 * simulation store; tests use `createSimulationSource`.
 */
export interface SimulationSource {
  get(): SimulationState;
  /** Applies a partial change (used to consume the one-shot `failNextApiCall`). */
  patch(patch: Partial<SimulationState>): void;
  subscribe(listener: (state: SimulationState) => void): Unsubscribe;
}

/** A minimal in-memory source. No clamping; the store does that for user input. */
export function createSimulationSource(initial: Partial<SimulationState> = {}): SimulationSource {
  let state: SimulationState = { ...DEFAULT_SIMULATION, ...initial };
  const listeners = new Set<(state: SimulationState) => void>();
  return {
    get: () => state,
    patch(patch) {
      state = { ...state, ...patch };
      for (const listener of [...listeners]) listener(state);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
