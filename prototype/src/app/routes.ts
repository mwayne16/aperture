/**
 * Page paths. The app uses hash routing (`#/discover/crypto`), so links keep working when the
 * desktop build loads the UI from a local file. Symbols and ids are URI-encoded because crypto pairs
 * contain a slash.
 */

const DISCOVER_TABS = ['stocks', 'etfs', 'crypto'] as const;
export type DiscoverTab = (typeof DISCOVER_TABS)[number];

/** Discover tabs in display order, with their labels. */
export const DISCOVER_TAB_LABELS: Readonly<Record<DiscoverTab, string>> = { stocks: 'Stocks', etfs: 'ETFs', crypto: 'Crypto' };

export const paths = {
  dashboard: '/',
  discover: (tab: DiscoverTab = 'stocks') => `/discover/${tab}`,
  watchlists: '/watchlists',
  watchlist: (id: string) => `/watchlists/${encodeURIComponent(id)}`,
  symbol: (symbol: string) => `/symbol/${encodeURIComponent(symbol)}`,
  alerts: '/alerts',
  notifications: '/notifications',
  settings: '/settings',
} as const;

/** Route patterns for the router, matching the paths above. */
export const routes = {
  dashboard: '/',
  discover: '/discover/:tab?',
  watchlists: '/watchlists',
  watchlist: '/watchlists/:id',
  symbol: '/symbol/:symbol',
  alerts: '/alerts',
  notifications: '/notifications',
  settings: '/settings',
} as const;

/** A path parameter as written by `paths`, or null when it is missing or malformed. */
export function decodeParam(value: string | undefined): string | null {
  if (value === undefined || value === '') return null;
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

export function isDiscoverTab(value: string | null): value is DiscoverTab {
  return (DISCOVER_TABS as readonly (string | null)[]).includes(value);
}
