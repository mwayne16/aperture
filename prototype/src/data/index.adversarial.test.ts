/** Adversarial checks of the public data-layer surface and stores. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Quote } from '../domain/types';
import { useConnectionStore } from './connectionStore';
import { getQuote, realtime, resetDemoData, startDataLayer, updateSimulation, useSimulation } from './index';
import { useQuoteStore } from './quoteStore';
import { resetSimulation, useSimulationStore } from './simulationStore';
import { renderHook } from '@testing-library/react';

function quote(symbol: string, last: number): Quote {
  return {
    symbol,
    last,
    lastTradeAt: 1,
    bid: last - 0.01,
    bidSize: 100,
    ask: last + 0.01,
    askSize: 100,
    quoteAt: 1,
    open: last,
    high: last,
    low: last,
    prevClose: last,
    volume: 100,
    change: 0,
    changePct: 0,
    status: 'live',
    updatedAt: 1,
  };
}

beforeEach(async () => {
  vi.useFakeTimers({ now: Date.UTC(2026, 9, 21, 15, 0) });
  resetSimulation();
  updateSimulation({ apiLatencyMs: 0 });
  useQuoteStore.getState().clear();
  await resetDemoData();
});

afterEach(() => {
  realtime.setSubscriptions([]);
  vi.useRealTimers();
});

describe('startDataLayer', () => {
  it('leaves no timers running after the last teardown, in any scenario', () => {
    for (const feedScenario of ['live', 'flaky', 'disconnected', 'stale', 'delayed'] as const) {
      updateSimulation({ feedScenario });
      realtime.setSubscriptions(['AAPL', 'MSFT']);
      const a = startDataLayer();
      const b = startDataLayer();
      vi.advanceTimersByTime(25_000);
      a();
      b();
      expect(vi.getTimerCount()).toBe(0);
      expect(useConnectionStore.getState().connection.state).toBe('disconnected');
    }
  });

  it('pipes quotes into the store and marks them stale on teardown', () => {
    realtime.setSubscriptions(['AAPL']);
    const stop = startDataLayer();
    vi.advanceTimersByTime(1000);
    expect(getQuote('aapl')?.status).toBe('live');
    stop();
    expect(getQuote('AAPL')?.status).toBe('stale');
  });
});

describe('quoteStore', () => {
  it('keeps the identity of every untouched symbol across many batches', () => {
    const store = useQuoteStore.getState();
    store.applyBatch([quote('AAPL', 1), quote('MSFT', 2), quote('NVDA', 3)]);
    const msft = useQuoteStore.getState().quotes.MSFT;
    const nvda = useQuoteStore.getState().quotes.NVDA;
    for (let i = 0; i < 10; i++) store.applyBatch([quote('AAPL', 10 + i)]);
    store.applyBatch([{ ...quote('NVDA', 3), updatedAt: 999 }]);
    expect(useQuoteStore.getState().quotes.MSFT).toBe(msft);
    expect(useQuoteStore.getState().quotes.NVDA).toBe(nvda);
    expect(useQuoteStore.getState().quotes.AAPL?.last).toBe(19);
  });
});

describe('simulation store', () => {
  it.each([
    [{ ticksPerSecond: 0 }, 'ticksPerSecond', 1],
    [{ ticksPerSecond: -10 }, 'ticksPerSecond', 1],
    [{ ticksPerSecond: 51 }, 'ticksPerSecond', 50],
    [{ ticksPerSecond: 1e9 }, 'ticksPerSecond', 50],
    [{ apiLatencyMs: -1 }, 'apiLatencyMs', 0],
    [{ apiLatencyMs: 3001 }, 'apiLatencyMs', 3000],
    [{ apiLatencyMs: 3000 }, 'apiLatencyMs', 3000],
    [{ ticksPerSecond: 50 }, 'ticksPerSecond', 50],
    [{ ticksPerSecond: 1 }, 'ticksPerSecond', 1],
  ] as const)('clamps %o', (patch, key, expected) => {
    updateSimulation(patch);
    expect(useSimulationStore.getState().simulation[key]).toBe(expected);
  });

  it('useSimulation reflects updates', () => {
    const { result, rerender } = renderHook(() => useSimulation());
    updateSimulation({ historyScenario: 'slow' });
    rerender();
    expect(result.current.historyScenario).toBe('slow');
  });
});
