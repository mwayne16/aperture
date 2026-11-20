import { evaluateAlert } from '@aperture/shared/alertEngine';
import type { AlertCondition, PriceAlert, Watchlist } from '../../domain/types';
import { createMockMarket, type MockMarket } from './market';
import { roundPrice } from './priceModel';

/** Demo data written on first run and by "reset demo data". */
export interface SeedData {
  watchlist: Watchlist;
  alerts: PriceAlert[];
}

// ** The demo alert timing below was measured with exactly these ten symbols streaming.
export const SEED_WATCHLIST_SYMBOLS: readonly string[] = [
  'AAPL',
  'MSFT',
  'NVDA',
  'GOOGL',
  'AMZN',
  'META',
  'TSLA',
  'AMD',
  'AVGO',
  'NFLX',
];

/*
 * Demo alert placement. At default settings a fresh session trades the 10 watchlist symbols at
 * 12 trades a second in total, about 1.2 trades per symbol per second, so trade counts stand in
 * for time. The price path is deterministic, so a target can be checked against the trades ahead.
 */

/** The first trigger should land 30-90 seconds into a fresh session at default settings. */
export const DEMO_FIRST_TRIGGER_TRADES = { min: 36, max: 108 } as const;
/** Triggers are checked over this many trades ahead, about 10 minutes at default settings. */
export const DEMO_HORIZON_TRADES = 720;
/** Re-fires at least this many trades apart (about 2.5 minutes) are as good as none. */
const DEMO_REFIRE_GAP_TRADES = 180;
/** Preferred first trigger, about 50 seconds in. */
const DEMO_IDEAL_FIRST_TRADE = 60;

function currentPrice(market: MockMarket, symbol: string): number {
  const state = market.getState(symbol);
  if (!state) throw new Error(`Seed symbol ${symbol} is not in the simulated universe.`);
  return state.last;
}

/** Trade numbers (1-based) at which a new alert fires along `path`, by the alert engine's rules. */
export function demoFireTrades(
  path: readonly number[],
  condition: AlertCondition,
  targetPrice: number,
): number[] {
  const fires: number[] = [];
  let armed = true;
  path.forEach((price, index) => {
    const result = evaluateAlert({ enabled: true, armed, condition, targetPrice }, price);
    if (result.triggered) fires.push(index + 1);
    armed = result.armed;
  });
  return fires;
}

type Score = readonly [inWindow: number, refireGap: number, closeness: number];

function isBetter(a: Score, b: Score): boolean {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return (a[i] ?? 0) > (b[i] ?? 0);
  return false;
}

/**
 * A target the symbol's path first reaches 30-90 seconds in and rarely revisits. A price hovering at
 * a level re-fires every few trades, so only the path's new highs (or lows) are candidates: the one
 * with the widest gap between re-fires wins, then the one nearest 50 seconds. Falls back to just
 * beyond the price if the path never moves that way.
 */
function demoTarget(market: MockMarket, symbol: string, condition: AlertCondition): number {
  const last = currentPrice(market, symbol);
  const path = market.peekPrices(symbol, DEMO_HORIZON_TRADES);
  const beyond = (price: number, level: number) => (condition === 'above' ? price > level : price < level);
  let extreme = last;
  let best: { target: number; score: Score } | null = null;
  for (const price of path) {
    if (!beyond(price, extreme)) continue;
    extreme = price;
    const fires = demoFireTrades(path, condition, price);
    const first = fires[0] ?? DEMO_HORIZON_TRADES;
    const gaps = fires.slice(1).map((trade, i) => trade - (fires[i] ?? 0));
    const score: Score = [
      first >= DEMO_FIRST_TRIGGER_TRADES.min && first <= DEMO_FIRST_TRIGGER_TRADES.max ? 1 : 0,
      Math.min(DEMO_REFIRE_GAP_TRADES, ...gaps),
      -Math.abs(first - DEMO_IDEAL_FIRST_TRADE),
    ];
    if (!best || isBetter(score, best.score)) best = { target: price, score };
  }
  return best?.target ?? roundPrice(last * (condition === 'above' ? 1.001 : 0.999));
}

/**
 * Builds the seed. Alert targets are placed relative to the market's current simulated prices:
 * two enabled demo alerts that first trigger about a minute in and then only minutes apart
 * (MSFT above/buy, TSLA below/sell), one enabled alert far away that stays armed, and one
 * disabled alert.
 */
export function buildSeedData(options: { market?: MockMarket; now?: number } = {}): SeedData {
  const market = options.market ?? createMockMarket();
  const iso = new Date(options.now ?? Date.now()).toISOString();

  const watchlist: Watchlist = { symbols: [...SEED_WATCHLIST_SYMBOLS], updatedAt: iso };

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
    // ** MSFT and TSLA, because their paths make a clean move early on. NVDA's path has no level it
    // reaches 30-90 seconds in without hovering there again within minutes.
    alert({
      id: 'alert-seed-msft',
      symbol: 'MSFT',
      condition: 'above',
      targetPrice: demoTarget(market, 'MSFT', 'above'),
      tag: 'buy',
      enabled: true,
      note: 'Demo alert: placed on the simulated path, so it triggers about a minute in.',
    }),
    alert({
      id: 'alert-seed-tsla',
      symbol: 'TSLA',
      condition: 'below',
      targetPrice: demoTarget(market, 'TSLA', 'below'),
      tag: 'sell',
      enabled: true,
      note: 'Demo alert: placed on the simulated path, so it triggers about a minute in.',
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
      id: 'alert-seed-nvda',
      symbol: 'NVDA',
      condition: 'below',
      targetPrice: roundPrice(currentPrice(market, 'NVDA') * 0.9),
      tag: 'buy',
      enabled: false,
      note: 'Disabled: never fires until enabled.',
    }),
  ];

  return { watchlist, alerts };
}
