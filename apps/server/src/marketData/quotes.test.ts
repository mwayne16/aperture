import { describe, expect, it } from 'vitest';
import { snapshot } from '../test/fakeProvider.js';
import { toQuote } from './quotes.js';

const NOW = Date.parse('2026-11-21T01:20:00Z');
const MINUTE = 60_000;

describe('toQuote status', () => {
  it('is stale after the close, once the last trade and bid/ask are over 15 minutes old', () => {
    const closed = snapshot('AAPL', {
      lastTradeAt: Date.parse('2026-11-20T20:59:59Z'),
      quoteAt: Date.parse('2026-11-20T21:00:03Z'),
    });
    expect(toQuote('AAPL', closed, false, NOW).status).toBe('stale');
  });

  it('stays live while the bid/ask updates, even without recent trades', () => {
    const quiet = snapshot('DOGE/USD', { lastTradeAt: NOW - 70 * MINUTE, quoteAt: NOW - 2_000 });
    expect(toQuote('DOGE/USD', quiet, false, NOW).status).toBe('live');
  });

  it('turns stale at 15 minutes without updates', () => {
    const at = (age: number) => snapshot('AAPL', { lastTradeAt: NOW - age, quoteAt: NOW - age });
    expect(toQuote('AAPL', at(15 * MINUTE), false, NOW).status).toBe('live');
    expect(toQuote('AAPL', at(15 * MINUTE + 1), false, NOW).status).toBe('stale');
  });

  it('allows for the delay of a delayed feed', () => {
    const late = snapshot('AAPL', { lastTradeAt: NOW - 20 * MINUTE, quoteAt: NOW - 20 * MINUTE });
    expect(toQuote('AAPL', late, true, NOW).status).toBe('delayed');
    const old = snapshot('AAPL', { lastTradeAt: NOW - 31 * MINUTE, quoteAt: NOW - 31 * MINUTE });
    expect(toQuote('AAPL', old, true, NOW).status).toBe('stale');
  });

  it('is unavailable without a last price', () => {
    expect(toQuote('ZZZZ', undefined, false, NOW).status).toBe('unavailable');
    expect(toQuote('AAPL', snapshot('AAPL', { last: null }), false, NOW).status).toBe('unavailable');
  });
});
