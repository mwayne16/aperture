import { describe, expect, it } from 'vitest';
import {
  MAX_WATCHLIST_SYMBOLS,
  SYMBOL_PATTERN,
  normalizeSymbol,
  validateSymbol,
  validateSymbolForWatchlist,
  type ValidationResult,
} from './symbols';

/**
 * Round-2 adversarial tests for symbols: exhaustive length boundaries, a brute-force check that
 * validateSymbol agrees with the documented pattern applied to the normalized input, check order,
 * and the "short user-facing sentence" contract for every reason.
 */

function reasonOf(r: ValidationResult<string>): string {
  if (r.ok) throw new Error(`expected rejection, got ok ${r.value}`);
  return r.reason;
}

function expectUserSentence(reason: string): void {
  expect(reason.length).toBeGreaterThan(3);
  expect(reason.length).toBeLessThanOrEqual(90);
  expect(reason).toMatch(/^[A-Z0-9]/);
  expect(reason).toMatch(/[.!]$/);
  expect(reason).not.toMatch(/undefined|null|NaN|\[object|\^|\$\/|Error/);
  expect(reason).not.toContain('\n');
}

const letters = (n: number): string => 'ABCDEFGH'.slice(0, n);

describe('validateSymbol boundaries (round 2)', () => {
  it('every combination of 0-6 base letters and 0-3 class letters follows the 1-5 / 1-2 rule', () => {
    for (let base = 0; base <= 6; base++) {
      const plain = letters(base);
      expect(validateSymbol(plain).ok, plain).toBe(base >= 1 && base <= 5);
      for (let cls = 0; cls <= 3; cls++) {
        const withClass = `${plain}.${letters(cls)}`;
        expect(validateSymbol(withClass).ok, withClass).toBe(base >= 1 && base <= 5 && cls >= 1 && cls <= 2);
      }
    }
  });

  it('agrees with SYMBOL_PATTERN on the normalized input for a brute-force ASCII corpus', () => {
    const alphabet = ['A', 'z', '.', '-', '1', ' ', '/', '_'];
    const corpus: string[] = [''];
    for (let len = 1; len <= 4; len++) {
      const next: string[] = [];
      for (const prefix of corpus.filter((c) => c.length === len - 1)) {
        for (const ch of alphabet) next.push(prefix + ch);
      }
      corpus.push(...next);
    }
    for (const input of corpus) {
      const normalized = normalizeSymbol(input);
      const expected = SYMBOL_PATTERN.test(normalized);
      const r = validateSymbol(input);
      expect(r.ok, JSON.stringify(input)).toBe(expected);
      if (r.ok) expect(r.value).toBe(normalized);
      else expectUserSentence(r.reason);
    }
  });

  it.each([
    'A..B',
    '.B',
    'A.',
    'A.B.C',
    'BRK/B',
    'BRK B',
    'BRK_B',
    'ÄAPL',
    'ＡＡＰＬ',
    'ß',
    'ﬀ',
    'AAPL​',
    '$AAPL',
  ])('rejects %j', (input) => {
    expectUserSentence(reasonOf(validateSymbol(input)));
  });

  it.each([
    ['\tbrk.b\n', 'BRK.B'],
    [' aapl　', 'AAPL'],
    ['abcde.fg', 'ABCDE.FG'],
    ['f', 'F'],
  ])('accepts %j as %j', (input, value) => {
    expect(validateSymbol(input)).toEqual({ ok: true, value });
  });
});

describe('validateSymbolForWatchlist check order and limits (round 2)', () => {
  const full = Array.from({ length: MAX_WATCHLIST_SYMBOLS }, (_, i) => {
    // Unique valid symbols: AA..ZZ style using two/three letters.
    const a = String.fromCharCode(65 + Math.floor(i / 26));
    const b = String.fromCharCode(65 + (i % 26));
    return `X${a}${b}`;
  });

  it('fixture sanity: the full list has MAX unique symbols', () => {
    expect(new Set(full).size).toBe(MAX_WATCHLIST_SYMBOLS);
  });

  it('format error wins over duplicate and full', () => {
    const r = validateSymbolForWatchlist('XAA1', full);
    expect(r.ok).toBe(false);
    expect(reasonOf(r)).toBe(reasonOf(validateSymbol('XAA1')));
  });

  it('duplicate wins over full and names the normalized symbol', () => {
    const reason = reasonOf(validateSymbolForWatchlist('  xaa ', full));
    expect(reason).toContain('XAA');
    expect(reason).not.toMatch(/full/i);
    expectUserSentence(reason);
  });

  it('a new valid symbol on a full list is rejected as full', () => {
    const reason = reasonOf(validateSymbolForWatchlist('AAPL', full));
    expect(reason).toMatch(/full|max|limit/i);
    expectUserSentence(reason);
  });

  it('a list one short of the max still accepts and returns the normalized value', () => {
    expect(validateSymbolForWatchlist(' brk.b ', full.slice(1))).toEqual({ ok: true, value: 'BRK.B' });
  });

  it('duplicates are detected against legacy un-normalized entries', () => {
    expect(validateSymbolForWatchlist('AAPL', [' aapl ']).ok).toBe(false);
    expect(validateSymbolForWatchlist('brk.b', ['BRK.B']).ok).toBe(false);
  });
});
