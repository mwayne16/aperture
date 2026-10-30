import { describe, expect, it } from 'vitest';
import { validateWatchlistName } from './symbols';

/**
 * Round-5 adversarial tests for "watchlist names are unique per user ignoring case" with non-ASCII
 * names. Two names that differ only by case must collide, which Unicode defines as equal case folds
 * (caseless matching). Plain toLowerCase misses pairs whose lower-case forms differ, such as Greek
 * final sigma.
 */

describe('validateWatchlistName caseless matching beyond ASCII', () => {
  it('rejects a Greek name that is the lower-case spelling of another list', () => {
    // "οδοσ".toUpperCase() === "ΟΔΟΣ", so these differ only by case.
    expect('οδοσ'.toUpperCase()).toBe('ΟΔΟΣ');
    expect(validateWatchlistName('οδοσ', ['ΟΔΟΣ']).ok).toBe(false);
    expect(validateWatchlistName('ΟΔΟΣ', ['οδοσ']).ok).toBe(false);
  });

  it('rejects names whose only difference is the final or medial sigma form', () => {
    // Unicode simple case folding maps final sigma (U+03C2) to sigma (U+03C3).
    expect(validateWatchlistName('Λογος', ['λογοσ']).ok).toBe(false);
  });

  it('still rejects the common Greek pair that toLowerCase already handles', () => {
    expect(validateWatchlistName('Λόγος', ['ΛΌΓΟΣ']).ok).toBe(false);
  });

  it('treats the Kelvin sign and K as the same letter', () => {
    expect(validateWatchlistName('Keep', ['keep']).ok).toBe(false);
  });

  it('treats Cyrillic and accented Latin case variants as duplicates', () => {
    expect(validateWatchlistName('ПОРТФЕЛЬ', ['портфель']).ok).toBe(false);
    expect(validateWatchlistName('ÉTÉ', ['été']).ok).toBe(false);
  });

  it('does not treat different letters as case variants', () => {
    expect(validateWatchlistName('Cafe', ['Café']).ok).toBe(true);
    expect(validateWatchlistName('Tech', ['Tеch']).ok).toBe(true); // Cyrillic "е"
    expect(validateWatchlistName('Growth', ['Growth 2']).ok).toBe(true);
  });

  it('returns the trimmed name as typed, not a case-folded form', () => {
    expect(validateWatchlistName('  Λόγος  ', [])).toEqual({ ok: true, value: 'Λόγος' });
    expect(validateWatchlistName('Straße', [])).toEqual({ ok: true, value: 'Straße' });
  });
});
