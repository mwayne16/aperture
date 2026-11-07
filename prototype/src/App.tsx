import { useEffect, useRef } from 'react';
import { Route, Router, Switch, useLocation } from 'wouter';
import { useHashLocation } from 'wouter/use-hash-location';
import { NotFoundPage } from './app/NotFoundPage';
import { routes } from './app/routes';
import { useAppStartup } from './app/useAppStartup';
import { useGlobalShortcuts } from './app/useGlobalShortcuts';
import { useQuoteSubscriptions } from './app/useQuoteSubscriptions';
import { ToastViewport } from './components/ui/ToastViewport';
import { AlertDialogHost } from './features/alerts/AlertDialogHost';
import { AlertNotifications } from './features/alerts/AlertNotifications';
import { AlertsPage } from './features/alerts/AlertsPage';
import { DashboardPage } from './features/dashboard/DashboardPage';
import { StockPage } from './features/details/StockPage';
import { DiscoverPage } from './features/discover/DiscoverPage';
import { NotificationsPage } from './features/notifications/NotificationsPage';
import { SettingsPage } from './features/settings/SettingsPage';
import { PrototypeControls } from './features/shell/PrototypeControls';
import { Sidebar } from './features/shell/Sidebar';
import { StatusBar } from './features/shell/StatusBar';
import { TopBar } from './features/shell/TopBar';
import { WatchlistPage } from './features/watchlists/WatchlistPage';
import './app/layout.css';

/** The app with hash routing, so page links keep working when the desktop build loads from a file. */
export function App() {
  return (
    <Router hook={useHashLocation}>
      <AppShell />
    </Router>
  );
}

/**
 * Application layout: the sidebar, then the top bar, the current page and the status bar. This
 * component owns the landmarks; pages render their content and handle their own scrolling.
 */
function AppShell() {
  useAppStartup();
  useQuoteSubscriptions();
  useGlobalShortcuts();
  const contentRef = useScrollTopOnNavigation();

  return (
    <div className="shell">
      <aside className="shell__side" aria-label="Navigation">
        <Sidebar />
      </aside>
      <header className="shell__top">
        <TopBar />
      </header>
      <main ref={contentRef} className="shell__content">
        <Pages />
      </main>
      <footer className="shell__status">
        <StatusBar />
      </footer>
      <div className="shell__overlays">
        <PrototypeControls />
        <AlertDialogHost />
        <AlertNotifications />
        <ToastViewport />
      </div>
    </div>
  );
}

function Pages() {
  return (
    <Switch>
      <Route path={routes.dashboard} component={DashboardPage} />
      <Route path={routes.discover} component={DiscoverPage} />
      <Route path={routes.watchlists} component={WatchlistPage} />
      <Route path={routes.watchlist} component={WatchlistPage} />
      <Route path={routes.symbol} component={StockPage} />
      <Route path={routes.alerts} component={AlertsPage} />
      <Route path={routes.notifications} component={NotificationsPage} />
      <Route path={routes.settings} component={SettingsPage} />
      <Route component={NotFoundPage} />
    </Switch>
  );
}

/** Each page starts at the top, instead of keeping the previous page's scroll position. */
function useScrollTopOnNavigation() {
  const ref = useRef<HTMLElement>(null);
  const [location] = useLocation();
  useEffect(() => {
    if (ref.current) ref.current.scrollTop = 0;
  }, [location]);
  return ref;
}
