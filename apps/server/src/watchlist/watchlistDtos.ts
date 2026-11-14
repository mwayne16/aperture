import { MAX_WATCHLIST_SYMBOLS, symbolProblem } from '@aperture/shared/symbols';
import type { AddSymbolInput, ReorderSymbolsInput } from '@aperture/shared/watchlist';
import { FollowsRule } from '../validation/rules.js';

export class AddSymbolBody implements AddSymbolInput {
  @FollowsRule(symbolProblem)
  symbol!: string;
}

export class SymbolParams {
  @FollowsRule(symbolProblem)
  symbol!: string;
}

/** Whether the new order is a list of strings. Whether it matches the watchlist is checked against the database. */
function symbolListProblem(value: unknown): string | null {
  if (!Array.isArray(value)) return 'Symbols must be a list.';
  if (value.length > MAX_WATCHLIST_SYMBOLS) return `List at most ${String(MAX_WATCHLIST_SYMBOLS)} symbols.`;
  return value.every((entry) => typeof entry === 'string') ? null : 'Each entry must be a symbol.';
}

export class ReorderSymbolsBody implements ReorderSymbolsInput {
  @FollowsRule(symbolListProblem)
  symbols!: string[];
}
