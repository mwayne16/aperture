import { alertFieldRules } from '@aperture/shared/alertRules';
import {
  MAX_ALERT_EVENTS_LIMIT,
  type AlertCondition,
  type AlertTag,
  type CreateAlertInput,
  type UpdateAlertInput,
} from '@aperture/shared/alerts';
import { Type } from 'class-transformer';
import { IsInt, IsUUID, Max, Min } from 'class-validator';
import { FollowsRule, Omittable } from '../validation/rules.js';

export class CreateAlertBody implements CreateAlertInput {
  @FollowsRule(alertFieldRules.symbol)
  symbol!: string;

  @FollowsRule(alertFieldRules.condition)
  condition!: AlertCondition;

  @FollowsRule(alertFieldRules.targetPrice)
  targetPrice!: number;

  @FollowsRule(alertFieldRules.tag)
  tag!: AlertTag;

  @Omittable()
  @FollowsRule(alertFieldRules.enabled)
  enabled?: boolean;

  @Omittable()
  @FollowsRule(alertFieldRules.note)
  note?: string | null;
}

/** Every field may be omitted to leave it unchanged. Only `note` accepts null, which clears it. */
export class UpdateAlertBody implements UpdateAlertInput {
  @Omittable()
  @FollowsRule(alertFieldRules.condition)
  condition?: AlertCondition;

  @Omittable()
  @FollowsRule(alertFieldRules.targetPrice)
  targetPrice?: number;

  @Omittable()
  @FollowsRule(alertFieldRules.tag)
  tag?: AlertTag;

  @Omittable()
  @FollowsRule(alertFieldRules.enabled)
  enabled?: boolean;

  @Omittable()
  @FollowsRule(alertFieldRules.note)
  note?: string | null;
}

export class AlertIdParams {
  @IsUUID('all', { message: 'Alert id must be a UUID.' })
  id!: string;
}

const EVENTS_LIMIT_MESSAGE = `Limit must be a whole number from 1 to ${String(MAX_ALERT_EVENTS_LIMIT)}.`;

/** `GET /alerts/events`. */
export class AlertEventsQuery {
  @Omittable()
  @Type(() => Number)
  @IsInt({ message: EVENTS_LIMIT_MESSAGE })
  @Min(1, { message: EVENTS_LIMIT_MESSAGE })
  @Max(MAX_ALERT_EVENTS_LIMIT, { message: EVENTS_LIMIT_MESSAGE })
  limit?: number;
}
