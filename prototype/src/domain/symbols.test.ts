import { describe, expect, it } from 'vitest';
import {
  MAX_WATCHLIST_SYMBOLS,
  normalizeSymbol,
  validateSymbol,
  validateSymbolForWatchlist,
  validateWatchlistName,
  type ValidationResult,
  WATCHLIST_NAME_MAX,
} from './symbols';

function reasonOf<T>(result: ValidationResult<T>): string {
  if (result.ok) throw new Error(`expected a failure, got ok: ${JSON.stringify(result.value)}`);
  return result.reason;
}

/** Reasons are short user-facing sentences: capitalized, end with a period, no internal jargon. */
function expectUserFacingReason(reason: string): void {
  expect(reason).toMatch(/^[A-Z0-9]/);
  expect(reason).toMatch(/\.$/);
  expect(reason.length).toBeLessThanOrEqual(80);
  expect(reason).not.toMatch(/regex|pattern|undefined|null|NaN|\[object/i);
}

/** Distinct valid symbols: AAA, AAB, ... */
function symbols(count: number): string[] {
  return Array.from({ length: count }, (_, i) => {
    const a = String.fromCharCode(65 + Math.floor(i / 676));
    const b = String.fromCharCode(65 + (Math.floor(i / 26) % 26));
    const c = String.fromCharCode(65 + (i % 26));
    return `${a}${b}${c}`;
  });
}

describe('normalizeSymbol', () => {
  it.each([
    ['aapl', 'AAPL'],
    ['  msft ', 'MSFT'],
    ['\tbrk.b\n', 'BRK.B'],
    [' nvda ', 'NVDA'], // non-breaking spaces pasted from a web page
    ['GoOg', 'GOOG'],
    ['', ''],
    ['   ', ''],
  ])('%j -> %j', (input, expected) => {
    expect(normalizeSymbol(input)).toBe(expected);
  });

  it('only trims the ends; inner whitespace is kept (and then fails validation)', () => {
    expect(normalizeSymbol(' brk b ')).toBe('BRK B');
    expect(validateSymbol(' brk b ').ok).toBe(false);
  });

  it('is idempotent', () => {
    for (const input of [' aapl ', 'brk.b', 'X', '']) {
      expect(normalizeSymbol(normalizeSymbol(input))).toBe(normalizeSymbol(input));
    }
  });
});

describe('validateSymbol', () => {
  it.each([
    ['AAPL', 'AAPL'],
    ['F', 'F'],
    ['GOOGL', 'GOOGL'],
    ['BRK.B', 'BRK.B'],
    ['brk.b', 'BRK.B'],
    ['  brk.a ', 'BRK.A'],
    ['BF.AB', 'BF.AB'],
    ['ABCDE.FG', 'ABCDE.FG'],
    [' aapl ', 'AAPL'],
  ])('accepts %j as %j', (input, expected) => {
    expect(validateSymbol(input)).toEqual({ ok: true, value: expected });
  });

  it.each([
    ['BRK-B', 'hyphen instead of a dot'],
    ['AAPL1', 'digit'],
    ['1AAPL', 'leading digit'],
    ['TOOLONG', 'more than 5 letters'],
    ['ABCDEF', 'exactly 6 letters'],
    ['.', 'dot only'],
    ['.B', 'missing base'],
    ['BRK.', 'empty class'],
    ['A.BCD', 'class longer than 2 letters'],
    ['BRK.B.C', 'two classes'],
    ['BRK..B', 'double dot'],
    ['BRK B', 'inner space'],
    ['AA PL', 'inner space'],
    ['$AAPL', 'cashtag'],
    ['AAPL!', 'punctuation'],
    ['ÄAPL', 'non-ASCII letter'],
    ['ſpy', 'long s that upper-cases to ASCII "S"'],
    ['ﬁ', 'ligature that upper-cases to "FI"'],
    ['ＡＡＰＬ', 'full-width letters'],
  ])('rejects %j (%s)', (input) => {
    const result = validateSymbol(input);
    expect(result.ok).toBe(false);
    expectUserFacingReason(reasonOf(result));
  });

  it.each(['', '   ', '\t\n'])('rejects empty input %j with a prompt to enter a symbol', (input) => {
    const reason = reasonOf(validateSymbol(input));
    expectUserFacingReason(reason);
    expect(reason).toBe('Enter a symbol.');
  });

  it('gives different reasons for empty and malformed input', () => {
    expect(reasonOf(validateSymbol(''))).not.toBe(reasonOf(validateSymbol('BRK-B')));
  });
});

describe('validateSymbolForWatchlist', () => {
  it('accepts a new symbol and returns it normalized', () => {
    expect(validateSymbolForWatchlist(' tsla ', ['AAPL', 'MSFT'])).toEqual({ ok: true, value: 'TSLA' });
  });

  it('accepts the first symbol of an empty list', () => {
    expect(validateSymbolForWatchlist('aapl', [])).toEqual({ ok: true, value: 'AAPL' });
  });

  it.each([' aapl ', 'AAPL', 'aApL'])('detects %j as a duplicate of AAPL after normalization', (input) => {
    const reason = reasonOf(validateSymbolForWatchlist(input, ['MSFT', 'AAPL']));
    expectUserFacingReason(reason);
    expect(reason).toBe('AAPL is already in this watchlist.');
  });

  it('normalizes existing entries too, so legacy lower-case data still counts as a duplicate', () => {
    expect(validateSymbolForWatchlist('BRK.B', ['brk.b']).ok).toBe(false);
  });

  it('does not treat share classes as duplicates of the base symbol', () => {
    expect(validateSymbolForWatchlist('BRK.B', ['BRK.A', 'BRK'])).toEqual({ ok: true, value: 'BRK.B' });
  });

  it('rejects invalid format before checking duplicates or capacity', () => {
    const full = symbols(MAX_WATCHLIST_SYMBOLS);
    const reason = reasonOf(validateSymbolForWatchlist('BRK-B', full));
    expect(reason).toBe(reasonOf(validateSymbol('BRK-B')));
    expect(reasonOf(validateSymbolForWatchlist('', ['AAPL']))).toBe('Enter a symbol.');
  });

  it(`allows adding the ${MAX_WATCHLIST_SYMBOLS}th symbol and rejects the next one`, () => {
    const almostFull = symbols(MAX_WATCHLIST_SYMBOLS - 1);
    expect(validateSymbolForWatchlist('ZZZZ', almostFull)).toEqual({ ok: true, value: 'ZZZZ' });

    const full = symbols(MAX_WATCHLIST_SYMBOLS);
    const reason = reasonOf(validateSymbolForWatchlist('ZZZZ', full));
    expectUserFacingReason(reason);
    expect(reason).toBe(`This watchlist is full (${MAX_WATCHLIST_SYMBOLS} symbols max).`);
  });

  it('still rejects when a list is somehow over capacity', () => {
    expect(validateSymbolForWatchlist('ZZZZ', symbols(MAX_WATCHLIST_SYMBOLS + 5)).ok).toBe(false);
  });

  it('reports the duplicate (the more useful reason) when the list is full and already has the symbol', () => {
    const full = symbols(MAX_WATCHLIST_SYMBOLS);
    expect(reasonOf(validateSymbolForWatchlist(full[3]!.toLowerCase(), full))).toBe(
      `${full[3]!} is already in this watchlist.`,
    );
  });

  it('does not mutate the existing list', () => {
    const existing = Object.freeze(['AAPL']);
    validateSymbolForWatchlist('msft', existing);
    validateSymbolForWatchlist('aapl', existing);
    expect(existing).toEqual(['AAPL']);
  });
});

describe('validateWatchlistName', () => {
  it('trims and returns the name with its original casing', () => {
    expect(validateWatchlistName('  Tech Leaders  ', [])).toEqual({ ok: true, value: 'Tech Leaders' });
  });

  it.each(['', '   ', '\t\n', ' '])('rejects empty or whitespace-only %j', (input) => {
    const reason = reasonOf(validateWatchlistName(input, []));
    expectUserFacingReason(reason);
    expect(reason).toBe('Enter a watchlist name.');
  });

  it('accepts exactly 40 characters and rejects 41', () => {
    expect(WATCHLIST_NAME_MAX).toBe(40);
    const forty = 'a'.repeat(40);
    expect(validateWatchlistName(forty, [])).toEqual({ ok: true, value: forty });

    const reason = reasonOf(validateWatchlistName('a'.repeat(41), []));
    expectUserFacingReason(reason);
    expect(reason).toBe('Use 40 characters or fewer.');
  });

  it('measures length after trimming', () => {
    const forty = 'b'.repeat(40);
    expect(validateWatchlistName(`   ${forty}   `, [])).toEqual({ ok: true, value: forty });
  });

  it('counts an emoji as one character, not two UTF-16 units', () => {
    const name = `${'x'.repeat(39)}📈`;
    expect(name.length).toBe(41);
    expect(validateWatchlistName(name, [])).toEqual({ ok: true, value: name });
    expect(validateWatchlistName(`${name}x`, []).ok).toBe(false);
  });

  it.each([
    ['Tech', ['tech']],
    ['TECH', ['Tech']],
    ['  tech  ', ['Tech']],
    ['tech', ['  TECH ']], // other names are compared trimmed as well
    ['Dividends', ['Growth', 'dividends', 'Energy']],
  ])('rejects %j as a case-insensitive duplicate of %j', (input, others) => {
    const reason = reasonOf(validateWatchlistName(input, others));
    expectUserFacingReason(reason);
    expect(reason).toBe('You already have a watchlist with this name.');
  });

  it.each([
    ['οδοσ', ['ΟΔΟΣ']], // lower-cases to "οδοσ" while "ΟΔΟΣ" lower-cases to "οδος"
    ['Λογος', ['λογοσ']],
    ['Straße', ['STRASSE']],
    ['Keep', ['keep']], // Kelvin sign
  ])('rejects %j as a non-ASCII case variant of %j', (input, others) => {
    expect(reasonOf(validateWatchlistName(input, others))).toBe(
      'You already have a watchlist with this name.',
    );
  });

  it('allows renaming a list to a case variant of its own name (callers pass only OTHER names)', () => {
    // Renaming "tech" -> "Tech": the list's own name is not in otherNames.
    expect(validateWatchlistName('Tech', ['Growth', 'Energy'])).toEqual({ ok: true, value: 'Tech' });
  });

  it('allows names that only resemble an existing one', () => {
    expect(validateWatchlistName('Tech 2', ['Tech']).ok).toBe(true);
    expect(validateWatchlistName('Te ch', ['Tech']).ok).toBe(true);
  });

  it('checks emptiness and length before duplicates', () => {
    expect(reasonOf(validateWatchlistName('   ', ['']))).toBe('Enter a watchlist name.');
    const long = 'c'.repeat(41);
    expect(reasonOf(validateWatchlistName(long, [long]))).toBe('Use 40 characters or fewer.');
  });
});
