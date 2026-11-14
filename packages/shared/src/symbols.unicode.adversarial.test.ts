import { describe, expect, it } from 'vitest';
import { normalizeSymbol, validateSymbol, validateSymbolForWatchlist } from './symbols.js';

/**
 * Symbols are trimmed of every Unicode White_Space character, not just what String#trim removes.
 */

const NEL = '\u0085'; // NEXT LINE, Unicode White_Space=yes

describe('Unicode whitespace is trimmed', () => {
  it('fixture sanity: NEL is Unicode whitespace that String#trim keeps', () => {
    expect(/^\p{White_Space}$/u.test(NEL)).toBe(true);
    expect(NEL.trim()).toBe(NEL);
  });

  it('every Unicode White_Space character is trimmed from a symbol', () => {
    const kept: string[] = [];
    for (let cp = 0; cp < 0x110000; cp++) {
      if (cp >= 0xd800 && cp <= 0xdfff) continue;
      const ws = String.fromCodePoint(cp);
      if (!/^\p{White_Space}$/u.test(ws)) continue;
      const res = validateSymbol(`${ws}aapl${ws}`);
      if (!res.ok || res.value !== 'AAPL') kept.push(`U+${cp.toString(16).toUpperCase()}`);
    }
    expect(kept).toEqual([]);
  });

  it('symbols lose surrounding NEL like any other whitespace', () => {
    expect(normalizeSymbol(`${NEL}aapl${NEL}`)).toBe('AAPL');
    expect(validateSymbol(`aapl${NEL}`)).toEqual({ ok: true, value: 'AAPL' });
    expect(validateSymbolForWatchlist(`${NEL}msft`, ['AAPL'])).toEqual({ ok: true, value: 'MSFT' });
    expect(validateSymbol(NEL)).toEqual({ ok: false, reason: 'Enter a symbol.' });
  });
});
