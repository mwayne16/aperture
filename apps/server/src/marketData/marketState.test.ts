import { describe, expect, it } from 'vitest';
import { snapshot } from '../test/fakeProvider.js';
import { MarketState } from './marketState.js';

function tracking(...symbols: string[]) {
  const state = new MarketState();
  state.track(symbols);
  return state;
}

describe('MarketState', () => {
  it('takes the day values from a snapshot and records when they arrived', () => {
    const state = tracking('AAPL');
    state.applySnapshot(snapshot('AAPL', { lastTradeAt: 1_000, quoteAt: 1_000 }), 5_000);
    expect(state.get('AAPL')).toMatchObject({
      last: 101,
      open: 99,
      high: 102,
      low: 98,
      prevClose: 100,
      baselineAt: 5_000,
    });
  });

  it('keeps a newer trade and quote when a late snapshot arrives', () => {
    const state = tracking('AAPL');
    state.applySnapshot(snapshot('AAPL', { lastTradeAt: 1_000, quoteAt: 1_000 }), 1_100);
    state.applyTrade({ symbol: 'AAPL', price: 103, time: 2_000 });
    state.applyQuote({ symbol: 'AAPL', bid: 102.9, bidSize: 1, ask: 103.1, askSize: 1, time: 2_000 });
    state.applySnapshot(
      snapshot('AAPL', { last: 101.5, lastTradeAt: 1_500, quoteAt: 1_500, volume: 9_000 }),
      2_500,
    );
    expect(state.get('AAPL')).toMatchObject({
      last: 103,
      lastTradeAt: 2_000,
      bid: 102.9,
      ask: 103.1,
      quoteAt: 2_000,
      volume: 9_000,
      // The day's high moves up to the newer trade the snapshot didn't include yet.
      high: 103,
    });
  });

  it('ignores ticks older than what it has, and ticks for untracked symbols', () => {
    const state = tracking('AAPL');
    state.applyTrade({ symbol: 'AAPL', price: 103, time: 2_000 });
    state.applyTrade({ symbol: 'AAPL', price: 90, time: 1_999 });
    state.applyTrade({ symbol: 'MSFT', price: 500, time: 3_000 });
    expect(state.get('AAPL')?.last).toBe(103);
    expect(state.get('MSFT')).toBeUndefined();
  });

  it('extends the day low when a trade goes below it', () => {
    const state = tracking('AAPL');
    state.applySnapshot(snapshot('AAPL', { lastTradeAt: 1_000 }), 1_000);
    state.applyTrade({ symbol: 'AAPL', price: 97, time: 2_000 });
    expect(state.get('AAPL')).toMatchObject({ low: 97, high: 102 });
  });

  it('drops symbols that are no longer tracked', () => {
    const state = tracking('AAPL', 'MSFT');
    state.applyTrade({ symbol: 'MSFT', price: 500, time: 1 });
    state.track(['AAPL']);
    expect(state.get('MSFT')).toBeUndefined();
    state.track(['AAPL', 'MSFT']);
    expect(state.get('MSFT')?.last).toBeNull();
  });
});
