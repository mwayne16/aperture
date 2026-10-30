import { describe, expect, it } from 'vitest';
import {
  MAX_WATCHLIST_SYMBOLS,
  normalizeSymbol,
  type ValidationResult,
  validateSymbol,
  validateSymbolForWatchlist,
  validateWatchlistName,
  WATCHLIST_NAME_MAX,
} from './symbols';

/** Adversarial tests derived from the symbols doc-comment spec. */

function reasonOf(r: ValidationResult<string>): string {
  if (r.ok) throw new Error(`expected failure, got ok: ${r.value}`);
  return r.reason;
}

function expectUserFacingSentence(reason: string) {
  expect(reason.length).toBeGreaterThan(3);
  expect(reason.length).toBeLessThanOrEqual(80);
  expect(reason).toMatch(/^[A-Z0-9]/);
  expect(reason).toMatch(/[.!]$/);
  expect(reason).not.toMatch(/undefined|null|NaN|\[object|regex|\^|\$\//i);
}

/** Fake but valid tickers: AA..ZZ style, all distinct. */
function tickers(n: number): string[] {
  const out: string[] = [];
  for (let i = 0; out.length < n; i++) {
    out.push(String.fromCharCode(65 + (Math.floor(i / 26) % 26), 65 + (i % 26), 65 + Math.floor(i / 676)));
  }
  return out;
}

describe('normalizeSymbol (adversarial)', () => {
  it.each([
    ['aapl', 'AAPL'],
    ['  msft  ', 'MSFT'],
    ['\tbrk.b\n', 'BRK.B'],
    [' goog　', 'GOOG'],
    ['BRK.B', 'BRK.B'],
    ['aapl1', 'AAPL1'], // normalize does not validate
    ['', ''],
  ])('%j -> %j', (input, expected) => {
    expect(normalizeSymbol(input)).toBe(expected);
  });

  it('is idempotent', () => {
    for (const s of [' a.b ', 'xyz', 'BRK.b']) {
      expect(normalizeSymbol(normalizeSymbol(s))).toBe(normalizeSymbol(s));
    }
  });
});

describe('validateSymbol (adversarial)', () => {
  it.each([
    ['F', 'F'],
    ['ABCDE', 'ABCDE'],
    ['brk.b', 'BRK.B'],
    ['BF.AB', 'BF.AB'],
    [' x.yz ', 'X.YZ'],
    ['\n\tspy ', 'SPY'],
  ])('accepts %j as %j', (input, value) => {
    expect(validateSymbol(input)).toEqual({ ok: true, value });
  });

  it.each([
    'BRK-B',
    'AAPL1',
    'TOOLONG',
    'ABCDEF',
    '',
    '   ',
    '.',
    '.B',
    'A.',
    'A..B',
    'A.BCD',
    'BRK.B.C',
    'BRK/B',
    'BR K',
    'AAPL​',
    '1',
    '$AAPL',
  ])('rejects %j with a user-facing sentence', (input) => {
    const r = validateSymbol(input);
    expect(r.ok).toBe(false);
    expectUserFacingSentence(reasonOf(r));
  });
});

describe('validateSymbolForWatchlist (adversarial)', () => {
  it('detects duplicates after normalizing the input', () => {
    const r = validateSymbolForWatchlist('  aapl ', ['MSFT', 'AAPL']);
    expect(r.ok).toBe(false);
    expectUserFacingSentence(reasonOf(r));
  });

  it('BRK.B and BRKB are different symbols', () => {
    expect(validateSymbolForWatchlist('BRKB', ['BRK.B'])).toEqual({ ok: true, value: 'BRKB' });
  });

  it('allows the 100th symbol and rejects the 101st', () => {
    const ninetyNine = tickers(MAX_WATCHLIST_SYMBOLS - 1);
    expect(new Set(ninetyNine).size).toBe(MAX_WATCHLIST_SYMBOLS - 1);
    expect(validateSymbolForWatchlist('zzzz', ninetyNine)).toEqual({ ok: true, value: 'ZZZZ' });
    const full = tickers(MAX_WATCHLIST_SYMBOLS);
    const r = validateSymbolForWatchlist('zzzz', full);
    expect(r.ok).toBe(false);
    expectUserFacingSentence(reasonOf(r));
  });

  it('reports an invalid format before a full list, and never returns ok for invalid input', () => {
    const full = tickers(MAX_WATCHLIST_SYMBOLS);
    const invalid = validateSymbolForWatchlist('BRK-B', full);
    const fullReason = reasonOf(validateSymbolForWatchlist('ZZZZ', full));
    expect(reasonOf(invalid)).toBe(reasonOf(validateSymbol('BRK-B')));
    expect(reasonOf(invalid)).not.toBe(fullReason);
  });

  it('does not mutate the existing list', () => {
    const existing = Object.freeze(['AAPL']);
    expect(validateSymbolForWatchlist('msft', existing)).toEqual({ ok: true, value: 'MSFT' });
    expect(existing).toEqual(['AAPL']);
  });

  it('empty list accepts any valid symbol', () => {
    expect(validateSymbolForWatchlist('f', [])).toEqual({ ok: true, value: 'F' });
  });
});

describe('validateWatchlistName (adversarial)', () => {
  it('trims and returns the trimmed name', () => {
    expect(validateWatchlistName('  Tech  ', [])).toEqual({ ok: true, value: 'Tech' });
  });

  it('keeps inner whitespace and case as typed', () => {
    expect(validateWatchlistName(' My  Big List ', [])).toEqual({ ok: true, value: 'My  Big List' });
  });

  it.each(['', ' ', '\t\n', ' 　'])('rejects blank %j', (input) => {
    const r = validateWatchlistName(input, []);
    expect(r.ok).toBe(false);
    expectUserFacingSentence(reasonOf(r));
  });

  it('length limit applies after trimming: 40 ok, 41 rejected', () => {
    const forty = 'a'.repeat(WATCHLIST_NAME_MAX);
    expect(validateWatchlistName(`   ${forty}   `, [])).toEqual({ ok: true, value: forty });
    const r = validateWatchlistName(`${forty}b`, []);
    expect(r.ok).toBe(false);
    expectUserFacingSentence(reasonOf(r));
    expect(validateWatchlistName('a', [])).toEqual({ ok: true, value: 'a' });
  });

  it('rejects a case-insensitive duplicate of another list', () => {
    for (const input of ['tech', 'TECH', ' Tech ', 'tEcH']) {
      const r = validateWatchlistName(input, ['Growth', 'Tech']);
      expect(r.ok).toBe(false);
      expectUserFacingSentence(reasonOf(r));
    }
  });

  it('allows renaming to a case variant of itself (callers pass only OTHER names)', () => {
    expect(validateWatchlistName('TECH', ['Growth'])).toEqual({ ok: true, value: 'TECH' });
  });

  it('a name that only shares a prefix is not a duplicate', () => {
    expect(validateWatchlistName('Tech 2', ['Tech'])).toEqual({ ok: true, value: 'Tech 2' });
  });

  it('does not mutate otherNames', () => {
    const others = Object.freeze(['A']);
    validateWatchlistName('b', others);
    expect(others).toEqual(['A']);
  });
});
