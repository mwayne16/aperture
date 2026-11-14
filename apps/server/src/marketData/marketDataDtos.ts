import { MAX_SEARCH_LIMIT } from '@aperture/shared/instrumentSearch';
import { ASSET_CLASSES, CHART_RANGES, type AssetClass, type ChartRange } from '@aperture/shared/marketData';
import { symbolProblem, validateSymbol } from '@aperture/shared/symbols';
import { Transform, Type } from 'class-transformer';
import { IsIn, IsInt, IsString, Max, MaxLength, Min } from 'class-validator';
import { FollowsRule, Omittable } from '../validation/rules.js';

/** The most symbols one quotes request may ask for; Alpaca's snapshot endpoint takes them in one call. */
export const MAX_QUOTE_SYMBOLS = 200;
export const DEFAULT_MOVERS_LIMIT = 5;
const MAX_MOVERS_LIMIT = 50;

/** `symbols=AAPL,MSFT` and `symbols=AAPL&symbols=MSFT` both become one trimmed list. */
function splitSymbols({ value }: { value: unknown }): unknown {
  const parts = Array.isArray(value) ? value : [value];
  if (!parts.every((part) => typeof part === 'string')) return value;
  return parts
    .flatMap((part) => part.split(','))
    .map((s) => s.trim())
    .filter((s) => s !== '');
}

function quoteSymbolsProblem(value: unknown): string | null {
  if (!Array.isArray(value)) return 'Symbols must be a comma-separated list.';
  if (value.length === 0) return 'Enter at least one symbol.';
  if (value.length > MAX_QUOTE_SYMBOLS)
    return `Ask for at most ${String(MAX_QUOTE_SYMBOLS)} symbols at a time.`;
  const index = value.findIndex((symbol) => typeof symbol !== 'string' || !validateSymbol(symbol).ok);
  return index === -1 ? null : `Entry ${String(index + 1)} is not a valid symbol.`;
}

/** `GET /instruments`: a ranked search when `q` is given, otherwise the list ordered by symbol. */
export class InstrumentQuery {
  @Omittable()
  @IsString({ message: 'Search text must be text.' })
  @MaxLength(64, { message: 'Search text must be 64 characters or fewer.' })
  q?: string;

  @Omittable()
  @IsIn(ASSET_CLASSES, { message: 'Asset class must be stock, etf or crypto.' })
  assetClass?: AssetClass;

  @Omittable()
  @Type(() => Number)
  @IsInt({ message: `Limit must be a whole number from 1 to ${String(MAX_SEARCH_LIMIT)}.` })
  @Min(1, { message: `Limit must be a whole number from 1 to ${String(MAX_SEARCH_LIMIT)}.` })
  @Max(MAX_SEARCH_LIMIT, { message: `Limit must be a whole number from 1 to ${String(MAX_SEARCH_LIMIT)}.` })
  limit?: number;
}

/** A symbol in the path. Crypto pairs are sent encoded, e.g. `BTC%2FUSD`. */
export class InstrumentParams {
  @FollowsRule(symbolProblem)
  symbol!: string;
}

export class HistoryQuery {
  @IsIn(CHART_RANGES, { message: `Range must be one of ${CHART_RANGES.join(', ')}.` })
  range!: ChartRange;
}

export class QuotesQuery {
  @Transform(splitSymbols)
  @FollowsRule(quoteSymbolsProblem)
  symbols!: string[];
}

export class MoversQuery {
  @Omittable()
  @Type(() => Number)
  @IsInt({ message: `Limit must be a whole number from 1 to ${String(MAX_MOVERS_LIMIT)}.` })
  @Min(1, { message: `Limit must be a whole number from 1 to ${String(MAX_MOVERS_LIMIT)}.` })
  @Max(MAX_MOVERS_LIMIT, { message: `Limit must be a whole number from 1 to ${String(MAX_MOVERS_LIMIT)}.` })
  limit?: number;
}
