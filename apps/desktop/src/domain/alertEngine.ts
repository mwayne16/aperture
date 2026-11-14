import type { AlertCondition, PriceAlert } from './types';

/**
 * Alert evaluation rules (shared with the future backend Alert Service).
 *
 * - "above" is satisfied when price >= targetPrice. "below" is satisfied when price <= targetPrice.
 * - An alert fires only when it is enabled, armed, and the condition is satisfied.
 *   Firing disarms it (armed = false), so it stays quiet while the condition remains satisfied.
 * - A disarmed alert re-arms the first time it sees a price that does NOT satisfy the condition.
 *   It can then fire again when the price re-enters the condition.
 * - A new alert, or one that is re-enabled or edited (condition/target), starts armed. If the
 *   condition is already satisfied at that moment, the next price fires it.
 * - Disabled alerts never fire and their armed flag is left unchanged.
 * - Non-finite prices (NaN, Infinity) are ignored: no fire, no state change.
 */

export interface AlertEvaluation {
  /** Whether the price satisfies the condition. False for ignored (non-finite) prices. */
  satisfied: boolean;
  /** Whether this price fires the alert. */
  triggered: boolean;
  /** The armed flag after this evaluation. */
  armed: boolean;
}

/** Persisted alerts are untyped at runtime, so the condition may be any value. */
function isKnownCondition(condition: unknown): condition is AlertCondition {
  return condition === 'above' || condition === 'below';
}

/**
 * Reads a persisted boolean flag. Only `true` counts as set, so a corrupt value such as "false" or 1
 * can't fire an alert, and the result is always a real boolean.
 */
function isFlagSet(flag: unknown): boolean {
  return flag === true;
}

/**
 * Whether `price` satisfies the condition against `targetPrice`. Equality satisfies both conditions.
 * A non-finite number or an unknown condition never matches.
 */
export function isConditionMet(condition: AlertCondition, price: number, targetPrice: number): boolean {
  if (!Number.isFinite(price) || !Number.isFinite(targetPrice)) return false;
  switch (condition) {
    case 'above':
      return price >= targetPrice;
    case 'below':
      return price <= targetPrice;
    default:
      // ** Corrupt persisted data reaches this branch; return false rather than undefined.
      return false;
  }
}

export function evaluateAlert(
  alert: Pick<PriceAlert, 'enabled' | 'armed' | 'condition' | 'targetPrice'>,
  price: number,
): AlertEvaluation {
  const armed = isFlagSet(alert.armed);
  // ** A corrupt target or condition is ignored like a non-finite price. Treating it as "not satisfied"
  // would re-arm the alert.
  if (!Number.isFinite(price) || !Number.isFinite(alert.targetPrice) || !isKnownCondition(alert.condition)) {
    return { satisfied: false, triggered: false, armed };
  }

  const satisfied = isConditionMet(alert.condition, price, alert.targetPrice);

  if (!isFlagSet(alert.enabled)) return { satisfied, triggered: false, armed };
  if (!satisfied) return { satisfied, triggered: false, armed: true };
  // Fire once on entry, then stay quiet until the price leaves the condition.
  return { satisfied, triggered: armed, armed: false };
}
