import { INSTRUMENTS, type InstrumentProfile } from './instruments';
import { applyTrade, createInitialState, peekPrices, stepPrice, type PriceState } from './priceModel';

/**
 * The simulated "exchange": current price state per symbol, shared by the mock realtime feed
 * (which advances it) and the mock API (which anchors history to the current price).
 */
export interface MockMarket {
  isKnown(symbol: string): boolean;
  getProfile(symbol: string): InstrumentProfile | undefined;
  /** Current state, created on first access. Undefined for symbols outside the universe. */
  getState(symbol: string): PriceState | undefined;
  /** Epoch ms of the symbol's last simulated trade, or null if it hasn't traded yet. */
  lastTradeAt(symbol: string): number | null;
  /** Applies one trade at time `at` and returns the new state. */
  trade(symbol: string, at: number): PriceState | undefined;
  /**
   * Trades a symbol forward for the time it sat idle, so symbols nobody streams still move between
   * snapshots. Symbols that traded in the last IDLE_AFTER_MS are left alone.
   */
  catchUp(symbol: string, at: number): PriceState | undefined;
  /** The next `count` model prices for a symbol, without advancing it. */
  peekPrices(symbol: string, count: number): number[];
  /** Restores every symbol to its deterministic initial state. */
  reset(): void;
}

export interface MockMarketOptions {
  instruments?: readonly InstrumentProfile[];
  /**
   * Test hook: return a price to force the next trade for `symbol` to that exact price, or undefined
   * to use the model.
   */
  priceOverride?: (symbol: string) => number | undefined;
}

const IDLE_AFTER_MS = 30_000;
/** One simulated catch-up trade per this much idle time, capped so a long gap can't jump far. */
const CATCH_UP_TRADE_MS = 4_000;
const MAX_CATCH_UP_TRADES = 30;

export function createMockMarket(options: MockMarketOptions = {}): MockMarket {
  const profiles: ReadonlyMap<string, InstrumentProfile> = new Map(
    (options.instruments ?? INSTRUMENTS).map((p) => [p.symbol, p]),
  );
  const lookup = (symbol: string): InstrumentProfile | undefined => profiles.get(symbol);

  const states = new Map<string, PriceState>();
  const tradeTimes = new Map<string, number>();

  function getState(symbol: string): PriceState | undefined {
    const existing = states.get(symbol);
    if (existing) return existing;
    const profile = lookup(symbol);
    if (!profile) return undefined;
    const initial = createInitialState(profile);
    states.set(symbol, initial);
    return initial;
  }

  function trade(symbol: string, at: number): PriceState | undefined {
    const state = getState(symbol);
    if (!state) return undefined;
    const forced = options.priceOverride?.(symbol);
    const next = forced !== undefined ? applyTrade(state, forced) : stepPrice(state);
    states.set(symbol, next);
    tradeTimes.set(symbol, at);
    return next;
  }

  return {
    isKnown: (symbol) => lookup(symbol) !== undefined,
    getProfile: lookup,
    getState,
    lastTradeAt: (symbol) => tradeTimes.get(symbol) ?? null,
    trade,
    catchUp(symbol, at) {
      const state = getState(symbol);
      if (!state) return undefined;
      const last = tradeTimes.get(symbol);
      if (last === undefined) {
        tradeTimes.set(symbol, at);
        return state;
      }
      const idle = at - last;
      if (idle < IDLE_AFTER_MS) return state;
      const count = Math.min(MAX_CATCH_UP_TRADES, Math.floor(idle / CATCH_UP_TRADE_MS));
      let current = state;
      for (let i = 0; i < count; i++) current = trade(symbol, at) ?? current;
      return current;
    },
    peekPrices(symbol, count) {
      const state = getState(symbol);
      return state ? peekPrices(state, count) : [];
    },
    reset() {
      states.clear();
      tradeTimes.clear();
    },
  };
}
