import { Aperture, Bell, BellRing, Compass, LayoutDashboard, Settings, Star, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link, useLocation } from 'wouter';
import { paths } from '../../app/routes';
import { Badge } from '../../components/ui/Badge';
import { cx } from '../../components/ui/cx';
import { useUnreadCount } from '../notifications/notificationStore';
import { WatchlistSection } from '../watchlists/WatchlistSection';
import './shell.css';

interface NavItemProps {
  href: string;
  icon: LucideIcon;
  label: string;
  /** Whether the current path belongs to this item, e.g. any /discover tab for Discover. */
  matches: (path: string) => boolean;
  badge?: ReactNode;
}

function NavItem({ href, icon: Icon, label, matches, badge }: NavItemProps) {
  const [location] = useLocation();
  const current = matches(location);
  return (
    <li>
      <Link href={href} className={cx('sidebar-nav__item', current && 'is-current')} aria-current={current ? 'page' : undefined}>
        <Icon className="sidebar-nav__icon" aria-hidden="true" />
        <span className="sidebar-nav__label">{label}</span>
        {badge}
      </Link>
    </li>
  );
}

function NavSection({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="sidebar-nav__section">
      <h2 className="sidebar-nav__heading">{label}</h2>
      <ul className="sidebar-nav__list">{children}</ul>
    </div>
  );
}

function UnreadBadge() {
  const unread = useUnreadCount();
  if (unread === 0) return null;
  return (
    <span className="sidebar-nav__badge num" aria-label={`${unread} unread`}>
      {unread > 99 ? '99+' : unread}
    </span>
  );
}

/** App navigation: brand, the main pages, preferences, and the watchlist. */
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
        <NavSection label="Main menu">
          <NavItem href={paths.dashboard} icon={LayoutDashboard} label="Dashboard" matches={(p) => p === '/'} />
          <NavItem href={paths.watchlist} icon={Star} label="Watchlist" matches={(p) => p === paths.watchlist} />
          <NavItem
            href={paths.discover()}
            icon={Compass}
            label="Discover"
            matches={(p) => p.startsWith('/discover') || p.startsWith('/symbol')}
          />
          <NavItem href={paths.alerts} icon={BellRing} label="Alerts" matches={(p) => p === paths.alerts} />
        </NavSection>
        <NavSection label="Preferences">
          <NavItem
            href={paths.notifications}
            icon={Bell}
            label="Notifications"
            matches={(p) => p === paths.notifications}
            badge={<UnreadBadge />}
          />
          <NavItem href={paths.settings} icon={Settings} label="Settings" matches={(p) => p === paths.settings} />
        </NavSection>
      </nav>
      <WatchlistSection />
      <div className="sidebar__footer">
        <Badge tone="warning" size="sm">
          Simulated
        </Badge>
        <span>Saved in this browser</span>
      </div>
    </div>
  );
}
