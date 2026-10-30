import { describe, expect, it } from 'vitest';
import { validateSymbol } from '../../domain/symbols';
import { findInstrument, INSTRUMENTS, toInstrument } from './instruments';
import { SEED_WATCHLISTS } from './seed';

describe('instrument universe', () => {
  it('has about 60 instruments with unique, valid, normalized symbols', () => {
    expect(INSTRUMENTS.length).toBeGreaterThanOrEqual(55);
    const symbols = INSTRUMENTS.map((i) => i.symbol);
    expect(new Set(symbols).size).toBe(symbols.length);
    for (const symbol of symbols) {
      const result = validateSymbol(symbol);
      expect(result.ok && result.value === symbol, symbol).toBe(true);
    }
  });

  it('has plausible simulated reference values', () => {
    for (const i of INSTRUMENTS) {
      expect(i.name.length, i.symbol).toBeGreaterThan(2);
      expect(['NASDAQ', 'NYSE', 'NYSE Arca']).toContain(i.exchange);
      expect(i.referencePrice).toBeGreaterThan(1);
      expect(i.volatility).toBeGreaterThan(0);
      expect(i.volatility).toBeLessThanOrEqual(3);
      expect(i.averageVolume).toBeGreaterThan(100_000);
      expect(Number.isInteger(i.listedYear)).toBe(true);
      expect(i.listedYear).toBeGreaterThan(1800);
      expect(i.listedYear).toBeLessThanOrEqual(2026);
    }
  });

  it('covers every seeded watchlist symbol and both stocks and ETFs', () => {
    for (const w of SEED_WATCHLISTS) {
      for (const symbol of w.symbols) expect(findInstrument(symbol), symbol).toBeDefined();
    }
    expect(INSTRUMENTS.some((i) => i.kind === 'etf')).toBe(true);
    expect(findInstrument('BRK.B')?.name).toContain('Berkshire');
    expect(findInstrument('ZZZZ')).toBeUndefined();
    expect(findInstrument('aapl')).toBeUndefined();
  });

  it('exposes only the public Instrument fields', () => {
    const aapl = findInstrument('AAPL')!;
    expect(toInstrument(aapl)).toEqual({ symbol: 'AAPL', name: 'Apple Inc.', exchange: 'NASDAQ' });
  });

  it('is frozen so simulated parameters cannot be changed at runtime', () => {
    expect(Object.isFrozen(INSTRUMENTS)).toBe(true);
    expect(Object.isFrozen(INSTRUMENTS[0])).toBe(true);
  });
});
