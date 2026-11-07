import { Aperture, Bell, BellRing, Compass, LayoutDashboard, Settings, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link, useLocation } from 'wouter';
import { paths } from '../../app/routes';
import { cx } from '../../components/ui/cx';
import { useUnreadCount } from '../notifications/notificationStore';
import { WatchlistSidebar } from '../watchlists/WatchlistSidebar';
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

/** App navigation: brand, the main pages, preferences, and the watchlists. */
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
      <div className="sidebar__watchlists">
        <WatchlistSidebar />
      </div>
    </div>
  );
}
