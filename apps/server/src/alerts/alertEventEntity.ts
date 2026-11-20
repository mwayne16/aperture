import type { AlertCondition, AlertField, AlertTag } from '@aperture/shared/alerts';
import { Check, Column, Entity, Index, PrimaryColumn } from 'typeorm';

/**
 * One time an alert fired, with the alert's settings at that moment. It is an append-only log: there is no
 * foreign key, so the history outlives an edited or deleted alert, as it does in the app.
 */
@Entity({ name: 'alert_events' })
@Check('alert_events_condition_check', `"condition" IN ('above', 'below')`)
@Check('alert_events_tag_check', `"tag" IN ('buy', 'sell')`)
@Check('alert_events_field_check', `"field" = 'last'`)
@Check('alert_events_target_price_check', '"target_price" > 0')
@Check('alert_events_price_check', '"price" > 0')
@Index('alert_events_triggered_at_idx', ['triggeredAt', 'id'])
@Index('alert_events_alert_id_idx', ['alertId'])
export class AlertEventEntity {
  @PrimaryColumn({ type: 'uuid', primaryKeyConstraintName: 'alert_events_pkey' })
  id!: string;

  @Column({ name: 'alert_id', type: 'uuid' })
  alertId!: string;

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

  @Column({ type: 'double precision' })
  price!: number;

  @Column({ name: 'triggered_at', type: 'timestamptz' })
  triggeredAt!: Date;
}
