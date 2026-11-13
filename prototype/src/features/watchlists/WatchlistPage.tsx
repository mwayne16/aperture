import { StockDetail } from '../details/StockDetail';
import { MarketTable } from '../market/MarketTable';
import './watchlists.css';

/** The watchlist's quote table beside a quick view of the selected symbol. */
export function WatchlistPage() {
  return (
    <div className="watchlist-page">
      <section className="watchlist-page__market" aria-label="Market">
        <MarketTable />
      </section>
      <section className="watchlist-page__detail" aria-label="Stock details">
        <StockDetail expandable />
      </section>
    </div>
  );
}
