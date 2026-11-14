import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { INITIAL_CONNECTION, useConnection, useConnectionStore } from './connectionStore';
import { DEFAULT_SIMULATION, type SimulationState } from './simulation';
import {
  getSimulation,
  resetSimulation,
  subscribeSimulation,
  updateSimulation,
  useSimulation,
  useSimulationStore,
} from './simulationStore';

beforeEach(() => {
  resetSimulation();
  useConnectionStore.getState().setConnection(INITIAL_CONNECTION);
});

describe('simulationStore', () => {
  it('starts from DEFAULT_SIMULATION', () => {
    expect(getSimulation()).toEqual(DEFAULT_SIMULATION);
  });

  it('applies partial patches and keeps other fields', () => {
    updateSimulation({ feedScenario: 'flaky' });
    updateSimulation({ historyScenario: 'error', failNextApiCall: true });
    expect(getSimulation()).toEqual({
      ...DEFAULT_SIMULATION,
      feedScenario: 'flaky',
      historyScenario: 'error',
      failNextApiCall: true,
    });
  });

  it.each([
    [0, 1],
    [-10, 1],
    [1, 1],
    [50, 50],
    [51, 50],
    [12.4, 12],
    [12.6, 13],
  ])('clamps ticksPerSecond %s to %s', (input, expected) => {
    updateSimulation({ ticksPerSecond: input });
    expect(getSimulation().ticksPerSecond).toBe(expected);
  });

  it.each([
    [-1, 0],
    [0, 0],
    [3000, 3000],
    [3001, 3000],
    [99999, 3000],
    [349.6, 350],
  ])('clamps apiLatencyMs %s to %s', (input, expected) => {
    updateSimulation({ apiLatencyMs: input });
    expect(getSimulation().apiLatencyMs).toBe(expected);
  });

  it('ignores NaN, infinite and non-numeric numbers, unknown scenarios and non-boolean flags', () => {
    updateSimulation({ ticksPerSecond: 20, apiLatencyMs: 100 });
    const garbage = {
      ticksPerSecond: Number.NaN,
      apiLatencyMs: Number.POSITIVE_INFINITY,
      feedScenario: 'offline',
      historyScenario: 'broken',
      failNextApiCall: 'yes',
    } as unknown as Partial<SimulationState>;
    updateSimulation(garbage);
    expect(getSimulation()).toEqual({ ...DEFAULT_SIMULATION, ticksPerSecond: 20, apiLatencyMs: 100 });
    updateSimulation({ ticksPerSecond: '30' } as unknown as Partial<SimulationState>);
    expect(getSimulation().ticksPerSecond).toBe(20);
  });

  it('does not notify for a patch that changes nothing', () => {
    const listener = vi.fn();
    const off = subscribeSimulation(listener);
    updateSimulation({ feedScenario: 'live' });
    updateSimulation({ ticksPerSecond: DEFAULT_SIMULATION.ticksPerSecond });
    updateSimulation({});
    expect(listener).not.toHaveBeenCalled();
    updateSimulation({ feedScenario: 'stale' });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ feedScenario: 'stale' }));
    off();
    updateSimulation({ feedScenario: 'live' });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('never mutates DEFAULT_SIMULATION', () => {
    updateSimulation({ feedScenario: 'disconnected', ticksPerSecond: 40 });
    expect(DEFAULT_SIMULATION.feedScenario).toBe('live');
    expect(DEFAULT_SIMULATION.ticksPerSecond).toBe(12);
    expect(useSimulationStore.getState().simulation).not.toBe(DEFAULT_SIMULATION);
  });

  it('useSimulation re-renders with the new state', () => {
    const { result } = renderHook(() => useSimulation());
    expect(result.current.feedScenario).toBe('live');
    act(() => {
      updateSimulation({ feedScenario: 'delayed' });
    });
    expect(result.current.feedScenario).toBe('delayed');
  });
});

describe('connectionStore', () => {
  it('starts disconnected and simulated', () => {
    expect(useConnectionStore.getState().connection).toEqual({
      state: 'disconnected',
      feedName: 'Simulated feed',
      simulated: true,
      lastMessageAt: null,
      reconnectAttempt: 0,
      nextRetryAt: null,
      error: null,
    });
  });

  it('useConnection follows setConnection', () => {
    const { result } = renderHook(() => useConnection());
    expect(result.current.state).toBe('disconnected');
    act(() => {
      useConnectionStore
        .getState()
        .setConnection({ ...INITIAL_CONNECTION, state: 'reconnecting', reconnectAttempt: 2 });
    });
    expect(result.current).toMatchObject({ state: 'reconnecting', reconnectAttempt: 2 });
  });
});
