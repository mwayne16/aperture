import { ChevronRight } from 'lucide-react';
import { Fragment } from 'react';
import { Link, useLocation } from 'wouter';
import { breadcrumbsFor } from '../../app/breadcrumbs';
import { useWatchlistStore } from '../watchlists/watchlistStore';
import './shell.css';

/** Where the user is, e.g. "Watchlists › Core Tech". Every crumb but the last links back up. */
export function Breadcrumbs() {
  const [location] = useLocation();
  const watchlists = useWatchlistStore((s) => s.watchlists);
  const crumbs = breadcrumbsFor(location, (id) => watchlists.find((w) => w.id === id)?.name ?? null);
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
