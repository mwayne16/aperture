import { Aperture, BellRing, Compass, LayoutDashboard, Settings, Star, type LucideIcon } from 'lucide-react';
import { Link, useLocation } from 'wouter';
import { paths } from '../../app/routes';
import { cx } from '../../components/ui/cx';
import { WatchlistSection } from '../watchlists/WatchlistSection';
import './shell.css';

interface NavItemProps {
  href: string;
  icon: LucideIcon;
  label: string;
  /** Whether the current path belongs to this item, e.g. any /discover tab for Discover. */
  matches: (path: string) => boolean;
}

function NavItem({ href, icon: Icon, label, matches }: NavItemProps) {
  const [location] = useLocation();
  const current = matches(location);
  return (
    <li>
      <Link href={href} className={cx('sidebar-nav__item', current && 'is-current')} aria-current={current ? 'page' : undefined}>
        <Icon className="sidebar-nav__icon" aria-hidden="true" />
        <span className="sidebar-nav__label">{label}</span>
      </Link>
    </li>
  );
}

/**
 * App navigation: the brand, the main pages, the watchlist, and Settings pinned to the bottom. The
 * watchlist scrolls on its own, so Settings stays in view however long the list gets.
 */
export function Sidebar() {
  return (
    <div className="sidebar">
      <div className="sidebar__brand">
        <span className="sidebar__mark" aria-hidden="true">
          <Aperture />
        </span>
        <span className="sidebar__name">Aperture</span>
      </div>
      <nav className="sidebar-nav" aria-label="Main">
        <h2 className="sidebar-nav__heading">Main menu</h2>
        <ul className="sidebar-nav__list">
          <NavItem href={paths.dashboard} icon={LayoutDashboard} label="Dashboard" matches={(p) => p === '/'} />
          <NavItem href={paths.watchlist} icon={Star} label="Watchlist" matches={(p) => p === paths.watchlist} />
          <NavItem
            href={paths.discover()}
            icon={Compass}
            label="Discover"
            matches={(p) => p.startsWith('/discover') || p.startsWith('/symbol')}
          />
          <NavItem href={paths.alerts} icon={BellRing} label="Alerts" matches={(p) => p === paths.alerts} />
        </ul>
      </nav>
      <WatchlistSection />
      <nav className="sidebar-nav sidebar-nav--bottom" aria-label="Preferences">
        <ul className="sidebar-nav__list">
          <NavItem href={paths.settings} icon={Settings} label="Settings" matches={(p) => p === paths.settings} />
        </ul>
      </nav>
    </div>
  );
}
