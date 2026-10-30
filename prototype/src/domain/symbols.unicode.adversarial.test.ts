import { describe, expect, it } from 'vitest';
import {
  normalizeSymbol,
  validateSymbol,
  validateSymbolForWatchlist,
  validateWatchlistName,
} from './symbols';

/**
 * Round-6 adversarial tests. Two spec rules are checked against Unicode's own definitions instead of
 * what JavaScript's string helpers happen to do:
 * - "unique per user ignoring case": a letter and its own upper- or lower-case form are the same name.
 * - "trimmed" / "whitespace rejected": every Unicode White_Space character counts as whitespace.
 */

const CAPITAL_SHARP_S = 'ẞ'; // ẞ, whose lower-case form is ß
const NEL = '\u0085'; // NEXT LINE, Unicode White_Space=yes

/** Every code point whose toLowerCase or toUpperCase is a different string: [char, case variant]. */
function caseVariantPairs(): [string, string][] {
  const pairs: [string, string][] = [];
  for (let cp = 0; cp < 0x110000; cp++) {
    if (cp >= 0xd800 && cp <= 0xdfff) continue;
    const c = String.fromCodePoint(cp);
    for (const variant of [c.toLowerCase(), c.toUpperCase()]) {
      if (variant !== c) pairs.push([c, variant]);
    }
  }
  return pairs;
}

describe('validateWatchlistName: a letter and its own case variant collide', () => {
  it('rejects "STRAẞE" when "Straße" exists (ẞ lower-cases to ß)', () => {
    expect(CAPITAL_SHARP_S.toLowerCase()).toBe('ß');
    expect(validateWatchlistName(`STRA${CAPITAL_SHARP_S}E`, ['Straße']).ok).toBe(false);
    expect(validateWatchlistName('Straße', [`STRA${CAPITAL_SHARP_S}E`]).ok).toBe(false);
  });

  it('rejects "STRAẞE" when "STRASSE" exists (both case-fold to "strasse")', () => {
    expect(validateWatchlistName(`STRA${CAPITAL_SHARP_S}E`, ['STRASSE']).ok).toBe(false);
  });

  it('still rejects the ß / SS pair', () => {
    expect(validateWatchlistName('STRASSE', ['Straße']).ok).toBe(false);
  });

  it('every single-character name collides with its own upper- and lower-case form', () => {
    const missed = caseVariantPairs()
      .filter(([c, variant]) => validateWatchlistName(`x${c}`, [`x${variant}`]).ok)
      .map(([c, variant]) => `U+${(c.codePointAt(0) ?? 0).toString(16).toUpperCase()} ${c} vs ${variant}`);
    expect(missed).toEqual([]);
  });
});

describe('Unicode whitespace is trimmed', () => {
  it('fixture sanity: NEL is Unicode whitespace that String#trim keeps', () => {
    expect(/^\p{White_Space}$/u.test(NEL)).toBe(true);
    expect(NEL.trim()).toBe(NEL);
  });

  it('a watchlist name made only of whitespace is rejected', () => {
    for (const blank of [NEL, `${NEL} `, ` ${NEL}\t`]) {
      expect(validateWatchlistName(blank, []).ok, JSON.stringify(blank)).toBe(false);
    }
  });

  it('every Unicode White_Space character is trimmed from a watchlist name', () => {
    const kept: string[] = [];
    for (let cp = 0; cp < 0x110000; cp++) {
      if (cp >= 0xd800 && cp <= 0xdfff) continue;
      const ws = String.fromCodePoint(cp);
      if (!/^\p{White_Space}$/u.test(ws)) continue;
      const res = validateWatchlistName(`${ws}Tech${ws}`, []);
      if (!res.ok || res.value !== 'Tech') kept.push(`U+${cp.toString(16).toUpperCase()}`);
    }
    expect(kept).toEqual([]);
  });

  it('a name with trailing NEL is a duplicate of the same name without it', () => {
    expect(validateWatchlistName(`Tech${NEL}`, ['Tech']).ok).toBe(false);
  });

  it('symbols lose surrounding NEL like any other whitespace', () => {
    expect(normalizeSymbol(`${NEL}aapl${NEL}`)).toBe('AAPL');
    expect(validateSymbol(`aapl${NEL}`)).toEqual({ ok: true, value: 'AAPL' });
    expect(validateSymbolForWatchlist(`${NEL}msft`, ['AAPL'])).toEqual({ ok: true, value: 'MSFT' });
    expect(validateSymbol(NEL)).toEqual({ ok: false, reason: 'Enter a symbol.' });
  });
});
