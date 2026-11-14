import { describe, expect, it } from 'vitest';
import { searchInstruments } from './instrumentSearch.js';

const UNIVERSE = [
  { symbol: 'APP', name: 'AppLovin Corporation' },
  { symbol: 'AAPL', name: 'Apple Inc.' },
  { symbol: 'AA', name: 'Alcoa Corporation' },
  { symbol: 'AAL', name: 'American Airlines Group Inc.' },
  { symbol: 'MSFT', name: 'Microsoft Corporation' },
  { symbol: 'PINE', name: 'Alpine Income Property Trust' },
  { symbol: 'BTC/USD', name: 'Bitcoin' },
];

const symbols = (query: string, limit = 10) => searchInstruments(UNIVERSE, query, limit).map((i) => i.symbol);

describe('searchInstruments', () => {
  it('puts the exact symbol first, then shorter symbol prefixes, then name matches', () => {
    expect(symbols('aa')).toEqual(['AA', 'AAL', 'AAPL']);
    expect(symbols('app')).toEqual(['APP', 'AAPL']);
  });

  it('orders name matches by where the query appears, then alphabetically', () => {
    expect(symbols('corp')).toEqual(['AA', 'APP', 'MSFT']);
    expect(symbols('pine')).toEqual(['PINE']);
    expect(symbols('lpine')).toEqual(['PINE']);
  });

  it('matches crypto pairs by symbol and name', () => {
    expect(symbols('btc/')).toEqual(['BTC/USD']);
    expect(symbols('bitcoin')).toEqual(['BTC/USD']);
  });

  it('honours the limit and matches nothing for a blank query', () => {
    expect(symbols('a', 2)).toHaveLength(2);
    expect(symbols('   ')).toEqual([]);
    expect(symbols('a', 0)).toEqual([]);
  });
});
