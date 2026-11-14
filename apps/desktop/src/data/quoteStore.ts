import { create } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import { normalizeSymbol } from '@aperture/shared/symbols';
import type { Quote } from '../domain/types';

/**
 * Latest quote per symbol. `applyBatch` replaces only the symbols whose quote actually changed, so
 * every other symbol keeps its object identity and per-symbol selectors don't re-render.
 */
export interface QuoteStoreState {
  quotes: Readonly<Record<string, Quote>>;
  applyBatch(quotes: readonly Quote[]): void;
  clear(): void;
}

const QUOTE_KEYS = [
  'symbol',
  'last',
  'lastTradeAt',
  'bid',
  'bidSize',
  'ask',
  'askSize',
  'quoteAt',
  'open',
  'high',
  'low',
  'prevClose',
  'volume',
  'change',
  'changePct',
  'status',
] as const satisfies readonly (keyof Quote)[];

/** Same market data. `updatedAt` is ignored: a re-sent identical quote is not a change. */
export function sameQuoteData(a: Quote, b: Quote): boolean {
  return QUOTE_KEYS.every((key) => Object.is(a[key], b[key]));
}

export const useQuoteStore = create<QuoteStoreState>()((set, get) => ({
  quotes: {},
  applyBatch(batch) {
    const current = get().quotes;
    let next: Record<string, Quote> | null = null;
    for (const quote of batch) {
      const existing = (next ?? current)[quote.symbol];
      if (existing && sameQuoteData(existing, quote)) continue;
      next ??= { ...current };
      next[quote.symbol] = quote;
    }
    if (next) set({ quotes: next });
  },
  clear() {
    set({ quotes: {} });
  },
}));

/** Non-hook read, for event handlers. */
export function getQuote(symbol: string): Quote | undefined {
  return useQuoteStore.getState().quotes[normalizeSymbol(symbol)];
}

/** Latest quote for one symbol. Re-renders only when that symbol's quote object changes. */
export function useQuote(symbol: string): Quote | undefined {
  const key = normalizeSymbol(symbol);
  return useQuoteStore((state) => state.quotes[key]);
}

/**
 * Latest quotes for `symbols`, in the same order. Re-renders when any of them changes, so use it for
 * summaries of a list, not for its rows.
 */
export function useQuotes(symbols: readonly string[]): readonly (Quote | undefined)[] {
  return useQuoteStore(useShallow((state) => symbols.map((symbol) => state.quotes[normalizeSymbol(symbol)])));
}
