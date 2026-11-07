import type { InstrumentProfile } from './instruments';
import { createPrng, hashString, type Prng } from './random';

/**
 * Simulated intraday price model. Deterministic: the same symbol always starts from the same state
 * and walks the same path, trade by trade.
 *
 * Each trade is one step of an Ornstein-Uhlenbeck process on the log price, pulled back toward the
 * session open. Step size scales with the instrument's volatility so moves are visible every few
 * trades; mean reversion keeps the typical drift around 1-2%, and a hard band keeps every price
 * within ±MAX_DEVIATION of the previous close.
 */

/** Per-trade log-price standard deviation for volatility 1 (0.06%). */
const BASE_TRADE_SIGMA = 0.0006;
/** Stationary standard deviation of the log price for volatility 1 (1.2%). */
const BASE_STATIONARY_SD = 0.012;
/** Prices never move further than this fraction from the previous close. */
export const MAX_DEVIATION = 0.06;

export interface PriceState {
  symbol: string;
  prevClose: number;
  open: number;
  last: number;
  high: number;
  low: number;
  volume: number;
  bid: number;
  ask: number;
  bidSize: number;
  askSize: number;
  /** Unrounded log of the last price; the process state. */
  logPrice: number;
  /** Number of trades applied since the initial state. */
  tradeCount: number;
  /** PRNG state, so stepping is a pure function of the state. */
  rngState: number;
  /** Model constants derived from the profile. */
  sigma: number;
  theta: number;
  averageVolume: number;
  relativeSpread: number;
}

/** Smallest price increment: a cent at or above $1, 0.0001 below. */
export function tickSize(price: number): number {
  return Math.abs(price) >= 1 ? 0.01 : 0.0001;
}

function decimalsFor(price: number): number {
  return Math.abs(price) >= 1 ? 2 : 4;
}

/** Rounds to cents, or to 4 decimals below $1. Never returns -0. */
export function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  const rounded = Math.round(value * factor) / factor;
  return rounded === 0 ? 0 : rounded;
}

/** Rounds a positive price to its tick (cents, or 4 dp below $1) and never returns less than one tick. */
export function roundPrice(price: number): number {
  if (!Number.isFinite(price) || price <= 0) return 0.0001;
  const rounded = roundTo(price, decimalsFor(price));
  // 0.99996 rounds to 1.0000 at 4 dp; that is already a valid cent price.
  return rounded > 0 ? rounded : 0.0001;
}

/** Signed difference rounded like a price (cents, or 4 dp when the magnitude is below 1). */
export function roundChange(value: number): number {
  return roundTo(value, decimalsFor(value));
}

function roundLots(shares: number): number {
  return Math.max(100, Math.round(shares / 100) * 100);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function spreadAround(last: number, relativeSpread: number): { bid: number; ask: number } {
  const tick = tickSize(last);
  const decimals = decimalsFor(last);
  const units = 10 ** decimals;
  const halfSpread = Math.max(tick, (last * relativeSpread) / 2);
  // Integer tick arithmetic so rounding can never cross the book.
  let bidUnits = Math.floor((last - halfSpread) * units + 1e-9);
  let askUnits = Math.ceil((last + halfSpread) * units - 1e-9);
  if (bidUnits < 1) bidUnits = 1;
  if (askUnits <= bidUnits) askUnits = bidUnits + 1;
  return { bid: bidUnits / units, ask: askUnits / units };
}

function bookSizes(rng: Prng): { bidSize: number; askSize: number } {
  return {
    bidSize: 100 * (1 + Math.floor(rng.next() * 20)),
    askSize: 100 * (1 + Math.floor(rng.next() * 20)),
  };
}

/** Deterministic starting state for an instrument: previous close, a small opening gap, and a day range. */
export function createInitialState(profile: InstrumentProfile): PriceState {
  const rng = createPrng(hashString(profile.symbol));
  const vol = profile.volatility;

  const prevClose = roundPrice(profile.referencePrice * (1 + (rng.next() - 0.5) * 0.02));
  const gap = clamp((rng.next() - 0.5) * 0.012 * vol, -0.02, 0.02);
  const open = roundPrice(prevClose * (1 + gap));
  const lower = prevClose * (1 - MAX_DEVIATION);
  const upper = prevClose * (1 + MAX_DEVIATION);
  const high = roundPrice(clamp(open * (1 + rng.next() * 0.004 * vol), open, upper));
  const low = roundPrice(clamp(open * (1 - rng.next() * 0.004 * vol), lower, open));
  const volume = roundLots(profile.averageVolume * (0.15 + rng.next() * 0.2));

  const sigma = BASE_TRADE_SIGMA * vol;
  const stationarySd = BASE_STATIONARY_SD * Math.sqrt(vol);
  const theta = (sigma * sigma) / (2 * stationarySd * stationarySd);
  const relativeSpread = (profile.assetClass === 'etf' ? 0.0001 : 0.0003) * Math.max(0.5, vol);

  const { bid, ask } = spreadAround(open, relativeSpread);
  const { bidSize, askSize } = bookSizes(rng);

  return {
    symbol: profile.symbol,
    prevClose,
    open,
    last: open,
    high,
    low,
    volume,
    bid,
    ask,
    bidSize,
    askSize,
    logPrice: Math.log(open),
    tradeCount: 0,
    rngState: rng.state,
    sigma,
    theta,
    averageVolume: profile.averageVolume,
    relativeSpread,
  };
}

/**
 * Applies one trade at `price` (already rounded). Updates range, volume and the book. Pure.
 * Used by the model step and by tests that script exact prices.
 */
export function applyTrade(state: PriceState, price: number, rng?: Prng): PriceState {
  const random = rng ?? createPrng(state.rngState);
  const last = roundPrice(price);
  const size = roundLots(state.averageVolume * 0.00002 * (0.25 + random.next() * 1.5));
  const { bid, ask } = spreadAround(last, state.relativeSpread);
  const { bidSize, askSize } = bookSizes(random);
  return {
    ...state,
    last,
    // A scripted trade moves the process to that price; stepPrice keeps its unrounded value instead.
    logPrice: Math.log(last),
    high: Math.max(state.high, last),
    low: Math.min(state.low, last),
    volume: state.volume + size,
    bid,
    ask,
    bidSize,
    askSize,
    tradeCount: state.tradeCount + 1,
    rngState: random.state,
  };
}

/** One simulated trade: an OU step on the log price around ln(open), bounded to ±MAX_DEVIATION. Pure. */
export function stepPrice(state: PriceState): PriceState {
  const rng = createPrng(state.rngState);
  const mean = Math.log(state.open);
  const lowerLog = Math.log(state.prevClose * (1 - MAX_DEVIATION));
  const upperLog = Math.log(state.prevClose * (1 + MAX_DEVIATION));
  const next = state.logPrice + state.theta * (mean - state.logPrice) + state.sigma * rng.normal();
  const logPrice = clamp(next, lowerLog, upperLog);
  // Rounding can push a price that sits on the band edge a fraction of a cent outside; clamp after.
  const lowerPrice = Math.ceil(state.prevClose * (1 - MAX_DEVIATION) * 100) / 100;
  const upperPrice = Math.floor(state.prevClose * (1 + MAX_DEVIATION) * 100) / 100;
  const rounded = roundPrice(Math.exp(logPrice));
  const price = state.prevClose >= 1 ? clamp(rounded, lowerPrice, upperPrice) : rounded;
  return { ...applyTrade(state, price, rng), logPrice };
}

/** The next `count` trade prices from `state`, without changing it. */
export function peekPrices(state: PriceState, count: number): number[] {
  const prices: number[] = [];
  let current = state;
  for (let i = 0; i < count; i++) {
    current = stepPrice(current);
    prices.push(current.last);
  }
  return prices;
}
