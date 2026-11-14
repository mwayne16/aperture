import { describe, expect, it } from 'vitest';
import { planSubscriptions } from './streamPlan.js';

const symbols = (prefix: string, count: number) =>
  Array.from({ length: count }, (_, i) => `${prefix}${String(i)}`);

describe('planSubscriptions', () => {
  it('streams the watchlist, then what is on screen, then alerts, and polls what does not fit', () => {
    const plan = planSubscriptions(
      { focus: ['FOCUS'], alerts: ['ALERT', 'BTC/USD'], watchlist: ['W1', 'W2', 'ETH/USD'] },
      { stocks: 3, crypto: 30 },
    );
    expect(plan).toEqual({
      streamed: { stocks: ['W1', 'W2', 'FOCUS'], crypto: ['ETH/USD', 'BTC/USD'] },
      polled: ['ALERT'],
    });
  });

  it('counts each symbol once, at its highest priority', () => {
    const plan = planSubscriptions(
      { focus: ['AAPL'], alerts: ['AAPL', 'MSFT'], watchlist: ['MSFT'] },
      { stocks: 30, crypto: 30 },
    );
    expect(plan.streamed.stocks).toEqual(['MSFT', 'AAPL']);
  });

  it('keeps a full watchlist of 30 stocks live and polls symbols outside it', () => {
    const watchlist = symbols('W', 30);
    const plan = planSubscriptions(
      { focus: ['F0'], alerts: ['A0', 'W3'], watchlist },
      { stocks: 30, crypto: 30 },
    );
    expect(plan.streamed.stocks).toEqual(watchlist);
    expect(plan.polled).toEqual(['F0', 'A0']);
  });

  it('streams everything when a stream has no cap', () => {
    const plan = planSubscriptions(
      { focus: [], alerts: [], watchlist: symbols('S', 50) },
      { stocks: null, crypto: null },
    );
    expect([plan.streamed.stocks.length, plan.polled]).toEqual([50, []]);
  });
});
