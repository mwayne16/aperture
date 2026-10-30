import { describe, expect, it } from 'vitest';
import { findInstrument, INSTRUMENTS, type InstrumentProfile } from './instruments';
import {
  applyTrade,
  createInitialState,
  MAX_DEVIATION,
  peekPrices,
  roundChange,
  roundPrice,
  stepPrice,
  tickSize,
  type PriceState,
} from './priceModel';
import { createPrng, hashString, makeId, mulberry32Step } from './random';

function profile(symbol: string): InstrumentProfile {
  const found = findInstrument(symbol);
  if (!found) throw new Error(`missing ${symbol}`);
  return found;
}

function walk(state: PriceState, steps: number, visit?: (s: PriceState) => void): PriceState {
  let current = state;
  for (let i = 0; i < steps; i++) {
    current = stepPrice(current);
    visit?.(current);
  }
  return current;
}

function decimals(value: number): number {
  const text = String(value);
  return text.includes('.') ? (text.split('.')[1]?.length ?? 0) : 0;
}

describe('random helpers', () => {
  it('hashString is stable and distinguishes close inputs', () => {
    expect(hashString('AAPL')).toBe(hashString('AAPL'));
    expect(hashString('AAPL')).not.toBe(hashString('AAPM'));
    expect(hashString('')).toBe(0x811c9dc5);
    expect(Number.isInteger(hashString('BRK.B'))).toBe(true);
    expect(hashString('BRK.B')).toBeGreaterThanOrEqual(0);
  });

  it('mulberry32 yields values in [0, 1) and is reproducible from its state', () => {
    const a = createPrng(42);
    const values = Array.from({ length: 5000 }, () => a.next());
    expect(Math.min(...values)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...values)).toBeLessThan(1);
    const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
    expect(mean).toBeGreaterThan(0.45);
    expect(mean).toBeLessThan(0.55);

    const b = createPrng(42);
    b.next();
    const resumed = createPrng(b.state);
    const c = createPrng(42);
    c.next();
    expect(resumed.next()).toBe(c.next());
    expect(mulberry32Step(7).value).toBe(createPrng(7).next());
  });

  it('normal draws are finite with roughly zero mean and unit variance', () => {
    const rng = createPrng(1);
    const draws = Array.from({ length: 20_000 }, () => rng.normal());
    expect(draws.every(Number.isFinite)).toBe(true);
    const mean = draws.reduce((s, v) => s + v, 0) / draws.length;
    const variance = draws.reduce((s, v) => s + (v - mean) ** 2, 0) / draws.length;
    expect(Math.abs(mean)).toBeLessThan(0.05);
    expect(variance).toBeGreaterThan(0.9);
    expect(variance).toBeLessThan(1.1);
  });

  it('makeId returns unique prefixed ids even within one millisecond', () => {
    const ids = new Set(Array.from({ length: 1000 }, () => makeId('evt')));
    expect(ids.size).toBe(1000);
    for (const id of ids) expect(id.startsWith('evt_')).toBe(true);
  });
});

describe('rounding', () => {
  it('rounds to cents at or above $1 and to 4 decimals below', () => {
    expect(roundPrice(123.456)).toBe(123.46);
    expect(roundPrice(1)).toBe(1);
    expect(roundPrice(0.123456)).toBe(0.1235);
    expect(roundPrice(0.99996)).toBe(1);
    expect(tickSize(5)).toBe(0.01);
    expect(tickSize(0.5)).toBe(0.0001);
  });

  it('never returns a non-positive price', () => {
    expect(roundPrice(0)).toBe(0.0001);
    expect(roundPrice(-5)).toBe(0.0001);
    expect(roundPrice(0.00001)).toBe(0.0001);
    expect(roundPrice(Number.NaN)).toBe(0.0001);
    expect(roundPrice(Number.POSITIVE_INFINITY)).toBe(0.0001);
  });

  it('rounds signed changes and never yields -0', () => {
    expect(roundChange(-1.234)).toBe(-1.23);
    expect(roundChange(0.12345)).toBe(0.1235);
    expect(Object.is(roundChange(-0.00001), 0)).toBe(true);
  });
});

describe('initial state', () => {
  it('is deterministic per symbol and differs between symbols', () => {
    expect(createInitialState(profile('AAPL'))).toEqual(createInitialState(profile('AAPL')));
    expect(createInitialState(profile('AAPL')).open).not.toBe(createInitialState(profile('MSFT')).open);
  });

  it('is coherent for every instrument', () => {
    for (const instrument of INSTRUMENTS) {
      const s = createInitialState(instrument);
      expect(s.prevClose, instrument.symbol).toBeGreaterThan(0);
      expect(Math.abs(s.prevClose / instrument.referencePrice - 1)).toBeLessThanOrEqual(0.0101);
      expect(Math.abs(s.open / s.prevClose - 1)).toBeLessThanOrEqual(0.0201);
      expect(s.last).toBe(s.open);
      expect(s.low).toBeLessThanOrEqual(s.last);
      expect(s.high).toBeGreaterThanOrEqual(s.last);
      expect(s.bid).toBeLessThan(s.ask);
      expect(s.volume % 100).toBe(0);
      expect(s.volume).toBeGreaterThan(0);
      expect(s.tradeCount).toBe(0);
    }
  });
});

describe('stepPrice', () => {
  it('is pure and deterministic: the same state walks the same path', () => {
    const start = createInitialState(profile('NVDA'));
    const snapshot = structuredClone(start);
    const a = peekPrices(start, 200);
    const b = peekPrices(start, 200);
    expect(a).toEqual(b);
    expect(start).toEqual(snapshot);
    expect(walk(start, 200).last).toBe(a[199]);
  });

  it('moves visibly: most trades change the price, and moves scale with volatility', () => {
    const tsla = peekPrices(createInitialState(profile('TSLA')), 500);
    const changes = tsla.filter((p, i) => i > 0 && p !== tsla[i - 1]).length;
    expect(changes).toBeGreaterThan(400);

    const avgAbsReturn = (symbol: string): number => {
      const prices = peekPrices(createInitialState(profile(symbol)), 2000);
      let sum = 0;
      for (let i = 1; i < prices.length; i++) sum += Math.abs(Math.log(prices[i]! / prices[i - 1]!));
      return sum / (prices.length - 1);
    };
    expect(avgAbsReturn('TSLA')).toBeGreaterThan(avgAbsReturn('KO') * 2);
  });

  it.each(['AAPL', 'TSLA', 'COIN', 'KO', 'F', 'SPY', 'BRK.B'])(
    'keeps %s within 6 percent of prevClose, positive, tick-rounded, with a sane book over 30k trades',
    (symbol) => {
      const start = createInitialState(profile(symbol));
      const lower = start.prevClose * (1 - MAX_DEVIATION);
      const upper = start.prevClose * (1 + MAX_DEVIATION);
      const violations: string[] = [];
      let previous = start;
      let maxDeviation = 0;
      walk(start, 30_000, (s) => {
        const problems = [
          s.last > 0 ? null : 'non-positive last',
          s.last >= lower - 1e-9 && s.last <= upper + 1e-9 ? null : `out of band ${s.last}`,
          decimals(s.last) <= (s.last >= 1 ? 2 : 4) ? null : `unrounded ${s.last}`,
          s.bid > 0 && s.bid < s.ask ? null : `crossed book ${s.bid}/${s.ask}`,
          s.bidSize % 100 === 0 && s.askSize % 100 === 0 && s.bidSize >= 100 ? null : 'odd lot size',
          s.high >= s.last && s.low <= s.last ? null : 'last outside day range',
          s.volume > previous.volume && (s.volume - previous.volume) % 100 === 0 ? null : 'bad volume step',
          s.tradeCount === previous.tradeCount + 1 ? null : 'trade count',
        ].filter((p): p is string => p !== null);
        if (problems.length > 0 && violations.length < 5)
          violations.push(`#${s.tradeCount}: ${problems.join(', ')}`);
        maxDeviation = Math.max(maxDeviation, Math.abs(s.last / start.prevClose - 1));
        previous = s;
      });
      expect(violations).toEqual([]);
      // It actually moves around rather than sitting still.
      expect(maxDeviation).toBeGreaterThan(0.005);
    },
  );

  it('mean-reverts toward the open instead of drifting to the band edge', () => {
    const start = createInitialState(profile('AAPL'));
    const prices = peekPrices(start, 20_000);
    const meanAbsDev = prices.reduce((s, p) => s + Math.abs(p / start.open - 1), 0) / prices.length;
    expect(meanAbsDev).toBeLessThan(0.03);
  });

  it('keeps sub-dollar prices at 4 decimals with a positive, uncrossed book', () => {
    const penny: InstrumentProfile = { ...profile('F'), symbol: 'PNY', referencePrice: 0.42, kind: 'stock' };
    walk(createInitialState(penny), 5000, (s) => {
      expect(s.last).toBeGreaterThan(0);
      expect(s.last).toBeLessThan(1);
      expect(decimals(s.last)).toBeLessThanOrEqual(4);
      expect(decimals(s.bid)).toBeLessThanOrEqual(4);
      expect(s.bid).toBeGreaterThan(0);
      expect(s.bid).toBeLessThan(s.ask);
    });
  });
});

describe('applyTrade', () => {
  it('forces an exact price and updates range and book without mutating the input', () => {
    const start = createInitialState(profile('AAPL'));
    const forced = applyTrade(start, start.high + 5);
    expect(forced.last).toBe(roundPrice(start.high + 5));
    expect(forced.high).toBe(forced.last);
    expect(forced.low).toBe(start.low);
    expect(forced.bid).toBeLessThan(forced.ask);
    expect(start.last).toBe(start.open);
    // The model continues from the scripted price.
    expect(Math.abs(stepPrice(forced).last / forced.last - 1)).toBeLessThan(0.02);
  });

  it('keeps the book uncrossed at the smallest prices', () => {
    const start = createInitialState(profile('F'));
    const tiny = applyTrade(start, 0.0001);
    expect(tiny.last).toBe(0.0001);
    expect(tiny.bid).toBeGreaterThan(0);
    expect(tiny.bid).toBeLessThan(tiny.ask);
  });
});
