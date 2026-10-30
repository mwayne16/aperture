import { useAppStartup } from './app/useAppStartup';
import { useGlobalShortcuts } from './app/useGlobalShortcuts';
import { useQuoteSubscriptions } from './app/useQuoteSubscriptions';
import { ToastViewport } from './components/ui/ToastViewport';
import { AlertDialogHost } from './features/alerts/AlertDialogHost';
import { AlertNotifications } from './features/alerts/AlertNotifications';
import { AlertsPanel } from './features/alerts/AlertsPanel';
import { StockDetail } from './features/details/StockDetail';
import { MarketTable } from './features/market/MarketTable';
import { PrototypeControls } from './features/shell/PrototypeControls';
import { StatusBar } from './features/shell/StatusBar';
import { TopBar } from './features/shell/TopBar';
import { WatchlistSidebar } from './features/watchlists/WatchlistSidebar';
import './app/layout.css';

/**
 * Application layout. Each area hosts one feature. This component owns the landmarks and the area
 * sizes, so features render only their content and handle their own scrolling.
 */
export function App() {
  useAppStartup();
  useQuoteSubscriptions();
  useGlobalShortcuts();

  return (
    <div className="layout">
      <header className="layout__top">
        <TopBar />
      </header>
      <aside className="layout__side" aria-label="Watchlists">
        <WatchlistSidebar />
      </aside>
      <main className="layout__main">
        <section className="layout__market" aria-label="Market">
          <MarketTable />
        </section>
        <section className="layout__detail" aria-label="Stock details">
          <StockDetail />
        </section>
      </main>
      <section className="layout__dock" aria-label="Alerts">
        <AlertsPanel />
      </section>
      <footer className="layout__status">
        <StatusBar />
      </footer>
      <div className="layout__overlays">
        <PrototypeControls />
        <AlertDialogHost />
        <AlertNotifications />
        <ToastViewport />
      </div>
    </div>
  );
}
