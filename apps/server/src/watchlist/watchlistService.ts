import type { ApiErrorDetail } from '@aperture/shared/errors';
import { normalizeSymbol, validateSymbolForWatchlist } from '@aperture/shared/symbols';
import type { Watchlist } from '@aperture/shared/watchlist';
import type { DataSource, EntityManager } from 'typeorm';
import { nextUpdatedAt } from '../db/updatedAt.js';
import { ApiHttpError, validationError } from '../http/errors.js';
import { WATCHLIST_ID, WatchlistEntity, WatchlistSymbolEntity } from './watchlistEntities.js';

/**
 * The user's single watchlist. Each change runs in a transaction that locks the watchlist row, so
 * concurrent requests (two windows, a double click) apply one at a time to the latest list and can't
 * both slip past the size limit.
 */
export class WatchlistService {
  private readonly dataSource: DataSource;
  private readonly now: () => Date;

  constructor(dataSource: DataSource, now: () => Date = () => new Date()) {
    this.dataSource = dataSource;
    this.now = now;
  }

  get(): Promise<Watchlist> {
    // ** One snapshot, so the symbols and updatedAt always describe the same version of the list.
    return this.dataSource.transaction('REPEATABLE READ', (manager) => read(manager));
  }

  /** Appends a symbol. Rejects a duplicate with CONFLICT and a full list with VALIDATION_ERROR. */
  add(input: string): Promise<Watchlist> {
    return this.change(async (manager, symbols) => {
      const result = validateSymbolForWatchlist(input, symbols);
      if (!result.ok) {
        const detail = { field: 'symbol', message: result.reason };
        throw symbols.includes(normalizeSymbol(input))
          ? new ApiHttpError('CONFLICT', result.reason, [detail])
          : validationError([detail]);
      }
      const last = await manager.maximum(WatchlistSymbolEntity, 'position', { watchlistId: WATCHLIST_ID });
      await manager.insert(WatchlistSymbolEntity, {
        watchlistId: WATCHLIST_ID,
        symbol: result.value,
        position: last === null ? 0 : last + 1,
      });
    });
  }

  /** Rejects with NOT_FOUND when the symbol isn't in the watchlist. */
  remove(input: string): Promise<Watchlist> {
    return this.change(async (manager, symbols) => {
      const symbol = normalizeSymbol(input);
      if (!symbols.includes(symbol))
        throw new ApiHttpError('NOT_FOUND', `${symbol} is not in this watchlist.`);
      await manager.delete(WatchlistSymbolEntity, { watchlistId: WATCHLIST_ID, symbol });
    });
  }

  /** `input` must list every current symbol exactly once, or it rejects with VALIDATION_ERROR. */
  reorder(input: readonly string[]): Promise<Watchlist> {
    return this.change(async (manager, symbols) => {
      const ordered = input.map(normalizeSymbol);
      const details = permutationProblems(ordered, symbols);
      if (details.length > 0) throw validationError(details);
      await manager.query(
        `UPDATE "watchlist_symbols" AS w SET "position" = o.ordinality - 1
         FROM unnest($1::varchar[]) WITH ORDINALITY AS o(symbol, ordinality)
         WHERE w."watchlist_id" = $2 AND w."symbol" = o.symbol`,
        [ordered, WATCHLIST_ID],
      );
    });
  }

  /** Locks the watchlist, applies one change to it and bumps its updatedAt. */
  private change(
    apply: (manager: EntityManager, symbols: readonly string[]) => Promise<void>,
  ): Promise<Watchlist> {
    return this.dataSource.transaction(async (manager) => {
      const watchlist = await manager.findOne(WatchlistEntity, {
        where: { id: WATCHLIST_ID },
        lock: { mode: 'pessimistic_write' },
      });
      if (!watchlist) throw new Error('The watchlist row is missing. Have the database migrations run?');
      await apply(manager, await readSymbols(manager));
      await manager.update(WatchlistEntity, WATCHLIST_ID, {
        updatedAt: nextUpdatedAt(this.now(), watchlist.updatedAt),
      });
      return read(manager);
    });
  }
}

async function readSymbols(manager: EntityManager): Promise<string[]> {
  const rows = await manager.find(WatchlistSymbolEntity, {
    select: { symbol: true },
    where: { watchlistId: WATCHLIST_ID },
    order: { position: 'ASC' },
  });
  return rows.map((row) => row.symbol);
}

async function read(manager: EntityManager): Promise<Watchlist> {
  const watchlist = await manager.findOneByOrFail(WatchlistEntity, { id: WATCHLIST_ID });
  return { symbols: await readSymbols(manager), updatedAt: watchlist.updatedAt.toISOString() };
}

/** One problem per bad entry (unknown or repeated), plus one listing the symbols left out. */
function permutationProblems(ordered: readonly string[], current: readonly string[]): ApiErrorDetail[] {
  const details: ApiErrorDetail[] = [];
  const seen = new Set<string>();
  ordered.forEach((symbol, index) => {
    const field = `symbols.${String(index)}`;
    if (!current.includes(symbol)) {
      details.push({ field, message: `${symbol || 'This entry'} is not in this watchlist.` });
    } else if (seen.has(symbol)) {
      details.push({ field, message: `${symbol} appears more than once.` });
    }
    seen.add(symbol);
  });
  const missing = current.filter((symbol) => !seen.has(symbol));
  if (missing.length > 0) {
    details.push({ field: 'symbols', message: `The new order is missing ${missing.join(', ')}.` });
  }
  return details;
}
