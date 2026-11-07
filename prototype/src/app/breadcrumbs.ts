import type { AssetClass } from '../domain/types';
import { decodeParam, DISCOVER_TAB_LABELS, isDiscoverTab, paths, type DiscoverTab } from './routes';

export interface Crumb {
  label: string;
  /** Link target, or undefined for the current page. */
  href?: string;
}

interface CrumbLookups {
  /** A watchlist's name, or null for an unknown id. */
  watchlistName: (id: string) => string | null;
  /** A symbol's asset class, or null while it is unknown. */
  assetClass: (symbol: string) => AssetClass | null;
}

const TAB_FOR_CLASS: Record<AssetClass, DiscoverTab> = { stock: 'stocks', etf: 'etfs', crypto: 'crypto' };

/**
 * Breadcrumbs for a path, ending with the current page. An unknown watchlist id falls back to
 * "Watchlist" so the trail never shows a raw id. A symbol links back to its Discover tab; until its
 * asset class is known, a pair like "BTC/USD" counts as crypto and anything else as a stock.
 */
export function breadcrumbsFor(path: string, { watchlistName, assetClass }: CrumbLookups): Crumb[] {
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
      const tab = TAB_FOR_CLASS[assetClass(symbol) ?? (symbol.includes('/') ? 'crypto' : 'stock')];
      return [{ label: DISCOVER_TAB_LABELS[tab], href: paths.discover(tab) }, { label: symbol || 'Details' }];
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
