import type { AssetClass } from '../../domain/types';
import { MARKET_SESSION_LABELS, marketSession } from '../shell/marketSession';

/** How an instrument's kind, trading hours and data source read on the stock page. */

const ASSET_CLASS_LABELS: Record<AssetClass, string> = { stock: 'Stock', etf: 'ETF', crypto: 'Crypto' };

export function assetClassLabel(assetClass: AssetClass): string {
  return ASSET_CLASS_LABELS[assetClass];
}

/** Crypto trades around the clock; stocks and ETFs trade in the regular US session. */
export function tradingHours(assetClass: AssetClass): string {
  return assetClass === 'crypto' ? '24/7, every day' : '9:30–16:00 ET, Monday to Friday';
}

export interface SessionView {
  label: string;
  open: boolean;
}

/**
 * Whether the instrument trades at `now` (epoch ms). Stocks and ETFs follow the US session, where
 * pre-market and after hours count as closed for the regular session. Crypto is always open.
 */
export function sessionNow(assetClass: AssetClass, now: number): SessionView {
  if (assetClass === 'crypto') return { label: 'Open', open: true };
  const session = marketSession(now);
  return { label: MARKET_SESSION_LABELS[session], open: session === 'open' };
}

/** Where the numbers come from, said plainly. */
export function dataSourceNote(simulated: boolean): string {
  return simulated
    ? 'Simulated prices and volume for this prototype. Live data will come from the Alpaca IEX feed.'
    : 'Alpaca IEX feed: real-time prices from one exchange, with IEX-only volume.';
}
