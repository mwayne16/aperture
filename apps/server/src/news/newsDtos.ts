import { MAX_NEWS_LIMIT } from '@aperture/shared/news';
import { validateSymbol } from '@aperture/shared/symbols';
import { Transform, Type } from 'class-transformer';
import { IsInt, Max, Min } from 'class-validator';
import { FollowsRule, Omittable } from '../validation/rules.js';

/** A stock page asks about one symbol; a few more is allowed, the whole watchlist isn't the point. */
const MAX_NEWS_SYMBOLS = 10;
const LIMIT_MESSAGE = `Limit must be a whole number from 1 to ${String(MAX_NEWS_LIMIT)}.`;

/** `symbols=AAPL,MSFT` and `symbols=AAPL&symbols=MSFT` both become one trimmed list. */
function splitSymbols({ value }: { value: unknown }): unknown {
  if (value === undefined) return undefined;
  const parts = Array.isArray(value) ? value : [value];
  if (!parts.every((part) => typeof part === 'string')) return value;
  return parts
    .flatMap((part) => part.split(','))
    .map((symbol) => symbol.trim())
    .filter((symbol) => symbol !== '');
}

function newsSymbolsProblem(value: unknown): string | null {
  if (!Array.isArray(value)) return 'Symbols must be a comma-separated list.';
  if (value.length === 0) return 'Enter at least one symbol.';
  if (value.length > MAX_NEWS_SYMBOLS)
    return `Ask for news about at most ${String(MAX_NEWS_SYMBOLS)} symbols.`;
  const index = value.findIndex((symbol) => typeof symbol !== 'string' || !validateSymbol(symbol).ok);
  return index === -1 ? null : `Entry ${String(index + 1)} is not a valid symbol.`;
}

/** `GET /news`: the curated feed, or news about `symbols` for a stock page. */
export class NewsQuery {
  @Omittable()
  @Transform(splitSymbols)
  @FollowsRule(newsSymbolsProblem)
  symbols?: string[];

  @Omittable()
  @Type(() => Number)
  @IsInt({ message: LIMIT_MESSAGE })
  @Min(1, { message: LIMIT_MESSAGE })
  @Max(MAX_NEWS_LIMIT, { message: LIMIT_MESSAGE })
  limit?: number;
}
