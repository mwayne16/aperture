import { Check, Column, Entity, ForeignKey, PrimaryColumn, Unique } from 'typeorm';

/** The id of the one watchlist row. The app has a single local user with a single watchlist. */
export const WATCHLIST_ID = 1;

/** The user's watchlist. Exactly one row exists; the first migration creates it. */
@Entity({ name: 'watchlists' })
@Check('watchlists_single_row', `"id" = ${WATCHLIST_ID}`)
export class WatchlistEntity {
  @PrimaryColumn({ type: 'smallint', primaryKeyConstraintName: 'watchlists_pkey' })
  id!: number;

  @Column({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}

/** One symbol in the watchlist. Rows sort by position, which may have gaps after removals. */
@Entity({ name: 'watchlist_symbols' })
// ** Deferred, so a reorder can swap positions within one transaction without a temporary clash.
@Unique('watchlist_symbols_position_key', ['watchlistId', 'position'], { deferrable: 'INITIALLY DEFERRED' })
@Check('watchlist_symbols_position_check', '"position" >= 0')
export class WatchlistSymbolEntity {
  @PrimaryColumn({
    name: 'watchlist_id',
    type: 'smallint',
    primaryKeyConstraintName: 'watchlist_symbols_pkey',
  })
  @ForeignKey(() => WatchlistEntity, { name: 'watchlist_symbols_watchlist_id_fkey', onDelete: 'CASCADE' })
  watchlistId!: number;

  @PrimaryColumn({ type: 'varchar', length: 16, primaryKeyConstraintName: 'watchlist_symbols_pkey' })
  symbol!: string;

  @Column({ type: 'integer' })
  position!: number;
}
