import { alertFieldRules } from '@aperture/shared/alertRules';
import type { AlertCondition, AlertTag, CreateAlertInput, UpdateAlertInput } from '@aperture/shared/alerts';
import { IsUUID } from 'class-validator';
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
