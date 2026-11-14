import { describe, expect, it } from 'vitest';
import {
  MAX_WATCHLIST_SYMBOLS,
  normalizeSymbol,
  validateSymbol,
  validateSymbolForWatchlist,
} from './symbols';

/**
 * Round-3 adversarial tests for symbols, derived from the doc-comment rules.
 * Seeded generation of valid and near-valid symbols checked against an independent reference,
 * reason-text quality, and input immutability.
 */

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Reference validity without regex: 1-5 ASCII letters, optional "." + 1-2 ASCII letters. */
function referenceValid(normalized: string): boolean {
  const isLetter = (c: string) => c >= 'A' && c <= 'Z' && c.length === 1;
  const parts = normalized.split('.');
  if (parts.length > 2) return false;
  const [base = '', cls] = parts;
  if (base.length < 1 || base.length > 5 || !base.split('').every(isLetter)) return false;
  if (cls === undefined) return true;
  return cls.length >= 1 && cls.length <= 2 && cls.split('').every(isLetter);
}

const ALPHABET = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ.-1 _/';

/** Reasons must be short user-facing sentences. */
function expectSentence(reason: string): void {
  expect(reason.length).toBeGreaterThan(5);
  expect(reason.length).toBeLessThanOrEqual(90);
  expect(reason).toMatch(/^[A-Z0-9]/);
  expect(reason).toMatch(/[.!?]$/);
  expect(reason).not.toMatch(/undefined|null|NaN|\[object|\^|\$\/|\\/);
  expect(reason.trim()).toBe(reason);
}

describe('validateSymbol vs reference (round 3)', () => {
  it('agrees with a regex-free reference for 20000 seeded strings', () => {
    const r = rng(2026);
    for (let i = 0; i < 20000; i++) {
      const len = Math.floor(r() * 10);
      let s = '';
      for (let j = 0; j < len; j++) s += ALPHABET.charAt(Math.floor(r() * ALPHABET.length));
      if (r() < 0.2) s = `  ${s}\t`;
      const res = validateSymbol(s);
      const normalized = s.trim().toUpperCase();
      const want = normalized !== '' && referenceValid(normalized);
      expect(res.ok, JSON.stringify(s)).toBe(want);
      if (res.ok) {
        expect(res.value).toBe(normalized);
        expect(res.value).toBe(normalizeSymbol(s));
      } else {
        expectSentence(res.reason);
      }
    }
  });

  it('accepts every valid shape at the length boundaries', () => {
    for (const s of [
      'A',
      'AB',
      'ABC',
      'ABCD',
      'ABCDE',
      'A.B',
      'A.BC',
      'ABCDE.F',
      'ABCDE.FG',
      'brk.b',
      ' brk.b ',
    ]) {
      expect(validateSymbol(s).ok, s).toBe(true);
    }
    for (const s of [
      'ABCDEF',
      'ABCDEF.G',
      'A.',
      '.A',
      'A..B',
      'A.B.C',
      'A.BCD',
      'A B',
      'A-B',
      'A1',
      '1A',
      '.',
    ]) {
      expect(validateSymbol(s).ok, s).toBe(false);
    }
  });

  it('normalizeSymbol is idempotent and validateSymbol is stable on its own output', () => {
    const r = rng(5);
    for (let i = 0; i < 2000; i++) {
      let s = '';
      for (let j = 0; j < 6; j++) s += ALPHABET.charAt(Math.floor(r() * ALPHABET.length));
      const once = normalizeSymbol(s);
      expect(normalizeSymbol(once)).toBe(once);
      const v = validateSymbol(s);
      if (v.ok) expect(validateSymbol(v.value)).toEqual(v);
    }
  });

  it('rejects letters that only become ASCII after upper-casing or that are non-ASCII look-alikes', () => {
    // Fullwidth A, Cyrillic A, dotless i, long s, German sharp s (uppercases to "SS").
    for (const s of ['ＡAPL', 'АAPL', 'ıBM', 'ſpy', 'straße'.slice(0, 5)]) {
      expect(validateSymbol(s).ok, s).toBe(false);
    }
  });
});

describe('validateSymbolForWatchlist (round 3)', () => {
  it('does not mutate the existing list', () => {
    const existing = Object.freeze(['AAPL', 'MSFT']);
    expect(validateSymbolForWatchlist('goog', existing)).toEqual({ ok: true, value: 'GOOG' });
    expect(existing).toEqual(['AAPL', 'MSFT']);
  });

  it('fills a list from empty to MAX one symbol at a time and rejects the next one', () => {
    const r = rng(77);
    const list: string[] = [];
    while (list.length < MAX_WATCHLIST_SYMBOLS) {
      let s = '';
      const len = 1 + Math.floor(r() * 5);
      for (let j = 0; j < len; j++) s += String.fromCharCode(97 + Math.floor(r() * 26));
      const res = validateSymbolForWatchlist(` ${s} `, list);
      if (list.includes(s.toUpperCase())) {
        expect(res.ok).toBe(false);
        if (!res.ok) {
          expect(res.reason).toContain(s.toUpperCase());
          expectSentence(res.reason);
        }
      } else {
        expect(res).toEqual({ ok: true, value: s.toUpperCase() });
        list.push(s.toUpperCase());
      }
    }
    const full = validateSymbolForWatchlist('ZZZZZ.ZZ', list);
    expect(full.ok).toBe(false);
    if (!full.ok) {
      expectSentence(full.reason);
      expect(full.reason).toContain(String(MAX_WATCHLIST_SYMBOLS));
    }
  });

  it('an invalid symbol is reported as invalid even when the list is full or contains junk', () => {
    const list = Array.from(
      { length: MAX_WATCHLIST_SYMBOLS },
      (_, i) => `S${String.fromCharCode(65 + (i % 26))}`,
    );
    // Format is checked first, so the user is told the symbol is malformed, not that the list is full.
    expect(validateSymbolForWatchlist('AAPL1', list)).toEqual(validateSymbol('AAPL1'));
    expect(validateSymbolForWatchlist('', list)).toEqual(validateSymbol(''));
  });
});
