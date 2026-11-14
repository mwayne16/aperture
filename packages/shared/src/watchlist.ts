/** The user's single watchlist: every symbol they watch, in their own order. */
export interface Watchlist {
  /** Ordered, unique, normalized symbols. */
  symbols: string[];
  /** ISO timestamp of the last change. */
  updatedAt: string;
}

export interface AddSymbolInput {
  symbol: string;
}

export interface ReorderSymbolsInput {
  /** Every current symbol exactly once, in the new order. */
  symbols: string[];
}
