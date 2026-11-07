import { ChevronRight } from 'lucide-react';
import { Fragment } from 'react';
import { Link, useLocation } from 'wouter';
import { breadcrumbsFor, type Crumb } from '../../app/breadcrumbs';
import { decodeParam } from '../../app/routes';
import type { AssetClass } from '../../domain/types';
import { useInstrument } from '../market/instrumentStore';
import { useWatchlistStore } from '../watchlists/watchlistStore';
import './shell.css';

const SYMBOL_PATH = /^\/symbol\/([^/]+)$/;

/** Where the user is, e.g. "Watchlists › Core Tech". Every crumb but the last links back up. */
export function Breadcrumbs() {
  const [location] = useLocation();
  const symbol = decodeParam(SYMBOL_PATH.exec(location)?.[1]);
  // ** Only symbol pages look up an instrument, so other pages never trigger a request.
  return symbol === null ? <PageCrumbs path={location} assetClass={null} /> : <SymbolCrumbs path={location} symbol={symbol} />;
}

function SymbolCrumbs({ path, symbol }: { path: string; symbol: string }) {
  const entry = useInstrument(symbol);
  const assetClass = entry?.status === 'ready' ? (entry.instrument?.assetClass ?? null) : null;
  return <PageCrumbs path={path} assetClass={assetClass} />;
}

function PageCrumbs({ path, assetClass }: { path: string; assetClass: AssetClass | null }) {
  const watchlists = useWatchlistStore((s) => s.watchlists);
  const crumbs = breadcrumbsFor(path, {
    watchlistName: (id) => watchlists.find((w) => w.id === id)?.name ?? null,
    assetClass: () => assetClass,
  });
  return <Trail crumbs={crumbs} />;
}

function Trail({ crumbs }: { crumbs: Crumb[] }) {
  return (
    <nav className="shell-crumbs" aria-label="Breadcrumb">
      <ol className="shell-crumbs__list">
        {crumbs.map((crumb, index) => (
          <Fragment key={`${index}-${crumb.label}`}>
            {index > 0 && <ChevronRight className="shell-crumbs__separator" aria-hidden="true" />}
            <li className="shell-crumbs__item">
              {crumb.href === undefined ? (
                <span className="shell-crumbs__current" aria-current="page">
                  {crumb.label}
                </span>
              ) : (
                <Link href={crumb.href} className="shell-crumbs__link">
                  {crumb.label}
                </Link>
              )}
            </li>
          </Fragment>
        ))}
      </ol>
    </nav>
  );
}
