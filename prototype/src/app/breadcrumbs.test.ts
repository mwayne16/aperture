import { describe, expect, it } from 'vitest';
import { breadcrumbsFor } from './breadcrumbs';
import { decodeParam, paths } from './routes';

const names = {
  assetClass: (symbol: string) => (symbol === 'SPY' ? ('etf' as const) : null),
};

describe('breadcrumbsFor', () => {
  it('names each top-level page', () => {
    expect(breadcrumbsFor('/', names)).toEqual([{ label: 'Dashboard' }]);
    expect(breadcrumbsFor('/alerts', names)).toEqual([{ label: 'Alerts' }]);
    expect(breadcrumbsFor('/settings', names)).toEqual([{ label: 'Settings' }]);
    expect(breadcrumbsFor('/nope', names)).toEqual([{ label: 'Page not found' }]);
  });

  it('shows the discover tab, defaulting to stocks', () => {
    expect(breadcrumbsFor(paths.discover('crypto'), names)).toEqual([
      { label: 'Discover', href: '/discover/stocks' },
      { label: 'Crypto' },
    ]);
    expect(breadcrumbsFor('/discover', names).at(-1)).toEqual({ label: 'Stocks' });
  });

  it('names the watchlist page', () => {
    expect(breadcrumbsFor(paths.watchlist, names)).toEqual([{ label: 'Watchlist' }]);
  });

  it('decodes crypto pairs and links back to the matching discover tab', () => {
    expect(breadcrumbsFor(paths.symbol('BTC/USD'), names)).toEqual([
      { label: 'Crypto', href: '/discover/crypto' },
      { label: 'BTC/USD' },
    ]);
    expect(breadcrumbsFor(paths.symbol('AAPL'), names)[0]).toEqual({ label: 'Stocks', href: '/discover/stocks' });
  });

  it('links an ETF back to the ETFs tab once its asset class is known', () => {
    expect(breadcrumbsFor(paths.symbol('SPY'), names)[0]).toEqual({ label: 'ETFs', href: '/discover/etfs' });
  });
});

describe('decodeParam', () => {
  it('round-trips encoded symbols and rejects malformed or missing values', () => {
    expect(decodeParam(encodeURIComponent('BRK.B'))).toBe('BRK.B');
    expect(decodeParam('BTC%2FUSD')).toBe('BTC/USD');
    expect(decodeParam('%E0%A4%A')).toBeNull();
    expect(decodeParam(undefined)).toBeNull();
  });
});
