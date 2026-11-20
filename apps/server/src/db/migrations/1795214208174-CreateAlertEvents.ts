import type { MigrationInterface, QueryRunner } from 'typeorm';

/** The alert trigger history: one row each time an alert fires. */
export class CreateAlertEvents1795214208174 implements MigrationInterface {
  name = 'CreateAlertEvents1795214208174';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            CREATE TABLE "alert_events" (
                "id" uuid NOT NULL,
                "alert_id" uuid NOT NULL,
                "symbol" character varying(16) NOT NULL,
                "condition" character varying(8) NOT NULL,
                "target_price" double precision NOT NULL,
                "tag" character varying(8) NOT NULL,
                "field" character varying(8) NOT NULL,
                "price" double precision NOT NULL,
                "triggered_at" TIMESTAMP WITH TIME ZONE NOT NULL,
                CONSTRAINT "alert_events_price_check" CHECK ("price" > 0),
                CONSTRAINT "alert_events_target_price_check" CHECK ("target_price" > 0),
                CONSTRAINT "alert_events_field_check" CHECK ("field" = 'last'),
                CONSTRAINT "alert_events_tag_check" CHECK ("tag" IN ('buy', 'sell')),
                CONSTRAINT "alert_events_condition_check" CHECK ("condition" IN ('above', 'below')),
                CONSTRAINT "alert_events_pkey" PRIMARY KEY ("id")
            )
        `);
    await queryRunner.query(`
            CREATE INDEX "alert_events_alert_id_idx" ON "alert_events" ("alert_id")
        `);
    await queryRunner.query(`
            CREATE INDEX "alert_events_triggered_at_idx" ON "alert_events" ("triggered_at", "id")
        `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            DROP INDEX "public"."alert_events_triggered_at_idx"
        `);
    await queryRunner.query(`
            DROP INDEX "public"."alert_events_alert_id_idx"
        `);
    await queryRunner.query(`
            DROP TABLE "alert_events"
        `);
  }
}
