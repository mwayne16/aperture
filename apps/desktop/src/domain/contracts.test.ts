import type * as SharedAlerts from '@aperture/shared/alerts';
import type * as SharedMarketData from '@aperture/shared/marketData';
import type * as SharedNews from '@aperture/shared/news';
import type * as SharedWatchlist from '@aperture/shared/watchlist';
import { describe, expectTypeOf, it } from 'vitest';
import type {
  AssetClass,
  Bar,
  BarTimeframe,
  CHART_RANGES,
  ChartRange,
  CreateAlertInput,
  DataStatus,
  HistoryResult,
  Instrument,
  MarketMovers,
  NewsItem,
  PriceAlert,
  Quote,
  UpdateAlertInput,
  Watchlist,
} from './types';

// ** The app keeps its own copies of the API types until it talks to the real backend. Typecheck fails
// here as soon as a copy drifts from the server's contract.
describe('API contract types', () => {
  it('match the shared alert and watchlist contracts', () => {
    expectTypeOf<PriceAlert>().toEqualTypeOf<SharedAlerts.PriceAlert>();
    expectTypeOf<CreateAlertInput>().toEqualTypeOf<SharedAlerts.CreateAlertInput>();
    expectTypeOf<UpdateAlertInput>().toEqualTypeOf<SharedAlerts.UpdateAlertInput>();
    expectTypeOf<Watchlist>().toEqualTypeOf<SharedWatchlist.Watchlist>();
  });

  it('match the shared market-data contracts', () => {
    expectTypeOf<DataStatus>().toEqualTypeOf<SharedMarketData.DataStatus>();
    expectTypeOf<AssetClass>().toEqualTypeOf<SharedMarketData.AssetClass>();
    expectTypeOf<Instrument>().toEqualTypeOf<SharedMarketData.Instrument>();
    expectTypeOf<Quote>().toEqualTypeOf<SharedMarketData.Quote>();
    expectTypeOf<MarketMovers>().toEqualTypeOf<SharedMarketData.MarketMovers>();
    expectTypeOf<typeof CHART_RANGES>().toEqualTypeOf<typeof SharedMarketData.CHART_RANGES>();
    expectTypeOf<ChartRange>().toEqualTypeOf<SharedMarketData.ChartRange>();
    expectTypeOf<BarTimeframe>().toEqualTypeOf<SharedMarketData.BarTimeframe>();
    expectTypeOf<Bar>().toEqualTypeOf<SharedMarketData.Bar>();
    expectTypeOf<HistoryResult>().toEqualTypeOf<SharedMarketData.HistoryResult>();
    expectTypeOf<NewsItem>().toEqualTypeOf<SharedNews.NewsItem>();
  });
});
