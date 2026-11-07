import { describe, expect, it } from 'vitest';
import type { Instrument } from '../../domain/types';
import { buildOptions, defaultActiveIndex, stepActiveIndex } from './symbolSearchModel';

const AAPL: Instrument = { symbol: 'AAPL', name: 'Apple Inc.', exchange: 'NASDAQ' };
const AAL: Instrument = { symbol: 'AAL', name: 'American Airlines Group Inc.', exchange: 'NASDAQ' };
const KO: Instrument = { symbol: 'KO', name: 'The Coca-Cola Company', exchange: 'NYSE' };

const symbols = (options: ReturnType<typeof buildOptions>) => options.map((o) => `${o.kind}:${o.symbol}`);

describe('buildOptions', () => {
  it('lists the results as they came for the global search', () => {
    expect(symbols(buildOptions('global', 'zz', []))).toEqual([]);
    expect(symbols(buildOptions('global', 'aa', [AAL, AAPL]))).toEqual(['instrument:AAL', 'instrument:AAPL']);
  });

  it('offers a valid typed symbol in the add box when the results do not list it', () => {
    expect(symbols(buildOptions('add', 'zzzz', []))).toEqual(['typed:ZZZZ']);
    expect(symbols(buildOptions('add', 'aa', [AAL, AAPL]))).toEqual([
      'instrument:AAL',
      'instrument:AAPL',
      'typed:AA',
    ]);
  });

  it('waits for the results to settle before offering the typed symbol', () => {
    expect(symbols(buildOptions('add', 'zzzz', [], false))).toEqual([]);
    expect(symbols(buildOptions('add', 'aa', [AAPL], false))).toEqual(['instrument:AAPL']);
  });

  it('does not offer the typed text when it is listed or not a valid symbol', () => {
    expect(symbols(buildOptions('add', 'aapl', [AAPL]))).toEqual(['instrument:AAPL']);
    expect(symbols(buildOptions('add', 'coca cola', [KO]))).toEqual(['instrument:KO']);
  });
});

describe('defaultActiveIndex', () => {
  it('highlights an exact symbol match, else the first option', () => {
    const options = buildOptions('add', 'aal', [AAPL, AAL]);
    expect(defaultActiveIndex(options, ' aal ')).toBe(1);
    expect(defaultActiveIndex(buildOptions('add', 'apple', [AAPL]), 'apple')).toBe(0);
  });

  it('highlights the typed symbol when it is the only option', () => {
    expect(defaultActiveIndex(buildOptions('add', 'zzzz', []), 'zzzz')).toBe(0);
  });

  it('returns -1 when there is nothing to highlight', () => {
    expect(defaultActiveIndex([], 'x')).toBe(-1);
  });
});

describe('stepActiveIndex', () => {
  it('moves and wraps at both ends', () => {
    expect(stepActiveIndex(0, 3, 1)).toBe(1);
    expect(stepActiveIndex(2, 3, 1)).toBe(0);
    expect(stepActiveIndex(0, 3, -1)).toBe(2);
  });

  it('enters the list from either end when nothing is highlighted', () => {
    expect(stepActiveIndex(-1, 3, 1)).toBe(0);
    expect(stepActiveIndex(-1, 3, -1)).toBe(2);
    expect(stepActiveIndex(-1, 0, 1)).toBe(-1);
  });
});
