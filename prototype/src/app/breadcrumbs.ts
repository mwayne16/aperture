import { decodeParam, DISCOVER_TAB_LABELS, isDiscoverTab, paths } from './routes';

export interface Crumb {
  label: string;
  /** Link target, or undefined for the current page. */
  href?: string;
}

/**
 * Breadcrumbs for a path, ending with the current page. `watchlistName` resolves a watchlist id to its
 * name; an unknown id falls back to "Watchlist" so the trail never shows a raw id.
 */
export function breadcrumbsFor(path: string, watchlistName: (id: string) => string | null): Crumb[] {
  const [, section = '', param] = path.split('/');
  switch (section) {
    case '':
      return [{ label: 'Dashboard' }];
    case 'discover': {
      const tab = decodeParam(param);
      return [{ label: 'Discover', href: paths.discover() }, { label: DISCOVER_TAB_LABELS[isDiscoverTab(tab) ? tab : 'stocks'] }];
    }
    case 'watchlists': {
      const id = decodeParam(param);
      const name = id === null ? null : watchlistName(id);
      return [{ label: 'Watchlists', href: paths.watchlists }, { label: name ?? 'Watchlist' }];
    }
    case 'symbol': {
      const symbol = decodeParam(param) ?? '';
      const crypto = symbol.includes('/');
      return [
        { label: crypto ? 'Crypto' : 'Stocks', href: paths.discover(crypto ? 'crypto' : 'stocks') },
        { label: symbol || 'Details' },
      ];
    }
    case 'alerts':
      return [{ label: 'Alerts' }];
    case 'notifications':
      return [{ label: 'Notifications' }];
    case 'settings':
      return [{ label: 'Settings' }];
    default:
      return [{ label: 'Page not found' }];
  }
}
