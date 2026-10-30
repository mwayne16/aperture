import type { PriceAlert, Watchlist } from '../../domain/types';
import { createMockMarket, type MockMarket } from './market';
import { roundPrice } from './priceModel';

/** Demo data written on first run and by "reset demo data". */
export interface SeedData {
  watchlists: Watchlist[];
  alerts: PriceAlert[];
}

export const SEED_WATCHLISTS: readonly { id: string; name: string; symbols: readonly string[] }[] = [
  {
    id: 'wl-core-tech',
    name: 'Core Tech',
    symbols: ['AAPL', 'MSFT', 'NVDA', 'GOOGL', 'AMZN', 'META', 'TSLA', 'AMD', 'AVGO', 'NFLX'],
  },
  { id: 'wl-index-etfs', name: 'Index ETFs', symbols: ['SPY', 'QQQ', 'IWM', 'DIA', 'VTI', 'XLK', 'XLF'] },
  { id: 'wl-financials', name: 'Financials', symbols: ['JPM', 'BAC', 'GS', 'MS', 'V', 'MA', 'BRK.B'] },
  { id: 'wl-ideas', name: 'Ideas', symbols: [] },
];

/** Trades of look-ahead used to place the "near" demo alerts on the deterministic price path. */
export const NEAR_ALERT_LOOKAHEAD = 30;
/** The near demo alerts sit at most this far from the current price. */
export const NEAR_ALERT_MAX_DISTANCE = 0.003;

function currentPrice(market: MockMarket, symbol: string): number {
  const state = market.getState(symbol);
  if (!state) throw new Error(`Seed symbol ${symbol} is not in the simulated universe.`);
  return state.last;
}

/**
 * An "above" target the model's own path reaches within NEAR_ALERT_LOOKAHEAD trades, at most
 * NEAR_ALERT_MAX_DISTANCE above the current price, and strictly above it (so it doesn't fire instantly).
 */
function nearAboveTarget(market: MockMarket, symbol: string): number {
  const last = currentPrice(market, symbol);
  const peak = Math.max(...market.peekPrices(symbol, NEAR_ALERT_LOOKAHEAD));
  if (peak > last) return Math.min(peak, roundPrice(last * (1 + NEAR_ALERT_MAX_DISTANCE)));
  return roundPrice(last * 1.001);
}

/** Mirror of nearAboveTarget for a "below" alert. */
function nearBelowTarget(market: MockMarket, symbol: string): number {
  const last = currentPrice(market, symbol);
  const trough = Math.min(...market.peekPrices(symbol, NEAR_ALERT_LOOKAHEAD));
  if (trough < last) return Math.max(trough, roundPrice(last * (1 - NEAR_ALERT_MAX_DISTANCE)));
  return roundPrice(last * 0.999);
}

/**
 * Builds the seed. Alert targets are placed relative to the market's current simulated prices:
 * two enabled alerts that trigger within a minute of demo time (NVDA above/buy, TSLA below/sell),
 * one enabled alert far away that stays armed, and one disabled alert.
 */
export function buildSeedData(options: { market?: MockMarket; now?: number } = {}): SeedData {
  const market = options.market ?? createMockMarket();
  const iso = new Date(options.now ?? Date.now()).toISOString();

  const watchlists: Watchlist[] = SEED_WATCHLISTS.map((w) => ({
    id: w.id,
    name: w.name,
    symbols: [...w.symbols],
    createdAt: iso,
    updatedAt: iso,
  }));

  const alert = (
    fields: Pick<PriceAlert, 'id' | 'symbol' | 'condition' | 'targetPrice' | 'tag' | 'enabled' | 'note'>,
  ): PriceAlert => ({
    ...fields,
    field: 'last',
    armed: true,
    createdAt: iso,
    updatedAt: iso,
    lastTriggeredAt: null,
    lastTriggeredPrice: null,
    triggerCount: 0,
  });

  const alerts: PriceAlert[] = [
    alert({
      id: 'alert-seed-nvda',
      symbol: 'NVDA',
      condition: 'above',
      targetPrice: nearAboveTarget(market, 'NVDA'),
      tag: 'buy',
      enabled: true,
      note: 'Demo alert: set just above the price, so it triggers within a minute.',
    }),
    alert({
      id: 'alert-seed-tsla',
      symbol: 'TSLA',
      condition: 'below',
      targetPrice: nearBelowTarget(market, 'TSLA'),
      tag: 'sell',
      enabled: true,
      note: 'Demo alert: set just below the price, so it triggers within a minute.',
    }),
    alert({
      id: 'alert-seed-aapl',
      symbol: 'AAPL',
      condition: 'above',
      targetPrice: roundPrice(currentPrice(market, 'AAPL') * 1.2),
      tag: 'sell',
      enabled: true,
      note: 'Far from the price: stays armed.',
    }),
    alert({
      id: 'alert-seed-msft',
      symbol: 'MSFT',
      condition: 'below',
      targetPrice: roundPrice(currentPrice(market, 'MSFT') * 0.9),
      tag: 'buy',
      enabled: false,
      note: 'Disabled: never fires until enabled.',
    }),
  ];

  return { watchlists, alerts };
}
