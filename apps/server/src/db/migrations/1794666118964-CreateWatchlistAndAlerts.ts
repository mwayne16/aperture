import type { MigrationInterface, QueryRunner } from 'typeorm';

/** The watchlist with its symbols, and price alerts. Creates the single watchlist row. */
export class CreateWatchlistAndAlerts1794666118964 implements MigrationInterface {
  name = 'CreateWatchlistAndAlerts1794666118964';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            CREATE TABLE "alerts" (
                "id" uuid NOT NULL,
                "symbol" character varying(16) NOT NULL,
                "condition" character varying(8) NOT NULL,
                "target_price" double precision NOT NULL,
                "tag" character varying(8) NOT NULL,
                "field" character varying(8) NOT NULL,
                "enabled" boolean NOT NULL,
                "armed" boolean NOT NULL,
                "note" character varying(500),
                "created_at" TIMESTAMP WITH TIME ZONE NOT NULL,
                "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL,
                "last_triggered_at" TIMESTAMP WITH TIME ZONE,
                "last_triggered_price" double precision,
                "trigger_count" integer NOT NULL,
                CONSTRAINT "alerts_trigger_count_check" CHECK ("trigger_count" >= 0),
                CONSTRAINT "alerts_target_price_check" CHECK ("target_price" > 0),
                CONSTRAINT "alerts_field_check" CHECK ("field" = 'last'),
                CONSTRAINT "alerts_tag_check" CHECK ("tag" IN ('buy', 'sell')),
                CONSTRAINT "alerts_condition_check" CHECK ("condition" IN ('above', 'below')),
                CONSTRAINT "alerts_pkey" PRIMARY KEY ("id")
            )
        `);
    await queryRunner.query(`
            CREATE TABLE "watchlists" (
                "id" smallint NOT NULL,
                "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL,
                CONSTRAINT "watchlists_single_row" CHECK ("id" = 1),
                CONSTRAINT "watchlists_pkey" PRIMARY KEY ("id")
            )
        `);
    await queryRunner.query(`
            CREATE TABLE "watchlist_symbols" (
                "watchlist_id" smallint NOT NULL,
                "symbol" character varying(16) NOT NULL,
                "position" integer NOT NULL,
                CONSTRAINT "watchlist_symbols_position_key" UNIQUE ("watchlist_id", "position") DEFERRABLE INITIALLY DEFERRED,
                CONSTRAINT "watchlist_symbols_position_check" CHECK ("position" >= 0),
                CONSTRAINT "watchlist_symbols_pkey" PRIMARY KEY ("watchlist_id", "symbol")
            )
        `);
    await queryRunner.query(`
            INSERT INTO "watchlists" ("id", "updated_at") VALUES (1, now())
        `);
    await queryRunner.query(`
            ALTER TABLE "watchlist_symbols"
            ADD CONSTRAINT "watchlist_symbols_watchlist_id_fkey" FOREIGN KEY ("watchlist_id") REFERENCES "watchlists"("id") ON DELETE CASCADE ON UPDATE NO ACTION
        `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            ALTER TABLE "watchlist_symbols" DROP CONSTRAINT "watchlist_symbols_watchlist_id_fkey"
        `);
    await queryRunner.query(`
            DROP TABLE "watchlist_symbols"
        `);
    await queryRunner.query(`
            DROP TABLE "watchlists"
        `);
    await queryRunner.query(`
            DROP TABLE "alerts"
        `);
  }
}
