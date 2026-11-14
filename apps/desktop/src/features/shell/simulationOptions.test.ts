import { describe, expect, it } from 'vitest';
import { DEFAULT_SIMULATION } from '../../data/simulation';
import { FEED_SCENARIO_INFO, HISTORY_SCENARIO_INFO, isDefaultSimulation } from './simulationOptions';

describe('scenario info', () => {
  it('explains each scenario with the mock layer timings', () => {
    expect(FEED_SCENARIO_INFO.delayed.description).toContain('15 minutes');
    expect(FEED_SCENARIO_INFO.stale.description).toContain('10 seconds');
    expect(FEED_SCENARIO_INFO.flaky.description).toBe('Drops every 20 seconds and recovers about 4 seconds later.');
    expect(HISTORY_SCENARIO_INFO.slow.description).toContain('2.5 seconds');
  });
});

describe('isDefaultSimulation', () => {
  it('is true only when every control is at its default', () => {
    expect(isDefaultSimulation(DEFAULT_SIMULATION)).toBe(true);
    expect(isDefaultSimulation({ ...DEFAULT_SIMULATION })).toBe(true);
    expect(isDefaultSimulation({ ...DEFAULT_SIMULATION, ticksPerSecond: 13 })).toBe(false);
    expect(isDefaultSimulation({ ...DEFAULT_SIMULATION, failNextApiCall: true })).toBe(false);
  });
});
