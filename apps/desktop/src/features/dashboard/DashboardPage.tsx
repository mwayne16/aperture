import { AlertsCard } from './AlertsCard';
import { DashboardHeader } from './DashboardHeader';
import { IndexStrip } from './IndexStrip';
import { MoversCard } from './MoversCard';
import { NewsCard } from './NewsCard';
import { WatchlistCard } from './WatchlistCard';
import './dashboard.css';

/** Overview page: the session and clock, the broad market, your watchlist, movers, alerts and news. */
export function DashboardPage() {
  return (
    <div className="page dashboard">
      <DashboardHeader />
      <IndexStrip />
      <div className="dashboard__grid">
        <div className="dashboard__column">
          <WatchlistCard />
          <NewsCard />
        </div>
        <div className="dashboard__column">
          <MoversCard />
          <AlertsCard />
        </div>
      </div>
    </div>
  );
}
