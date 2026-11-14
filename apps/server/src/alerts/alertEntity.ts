import type { AlertCondition, AlertField, AlertTag } from '@aperture/shared/alerts';
import { Check, Column, Entity, PrimaryColumn } from 'typeorm';

/** A price alert as stored. Prices are USD; `double precision` round-trips JavaScript numbers exactly. */
@Entity({ name: 'alerts' })
@Check('alerts_condition_check', `"condition" IN ('above', 'below')`)
@Check('alerts_tag_check', `"tag" IN ('buy', 'sell')`)
@Check('alerts_field_check', `"field" = 'last'`)
@Check('alerts_target_price_check', '"target_price" > 0')
@Check('alerts_trigger_count_check', '"trigger_count" >= 0')
export class AlertEntity {
  @PrimaryColumn({ type: 'uuid', primaryKeyConstraintName: 'alerts_pkey' })
  id!: string;

  @Column({ type: 'varchar', length: 16 })
  symbol!: string;

  @Column({ type: 'varchar', length: 8 })
  condition!: AlertCondition;

  @Column({ name: 'target_price', type: 'double precision' })
  targetPrice!: number;

  @Column({ type: 'varchar', length: 8 })
  tag!: AlertTag;

  @Column({ type: 'varchar', length: 8 })
  field!: AlertField;

  @Column({ type: 'boolean' })
  enabled!: boolean;

  @Column({ type: 'boolean' })
  armed!: boolean;

  @Column({ type: 'varchar', length: 500, nullable: true })
  note!: string | null;

  @Column({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @Column({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  @Column({ name: 'last_triggered_at', type: 'timestamptz', nullable: true })
  lastTriggeredAt!: Date | null;

  @Column({ name: 'last_triggered_price', type: 'double precision', nullable: true })
  lastTriggeredPrice!: number | null;

  @Column({ name: 'trigger_count', type: 'integer' })
  triggerCount!: number;
}
