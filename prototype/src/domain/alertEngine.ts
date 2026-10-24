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

export function isConditionMet(_condition: AlertCondition, _price: number, _targetPrice: number): boolean {
  throw new Error('not implemented');
}

export function evaluateAlert(
  _alert: Pick<PriceAlert, 'enabled' | 'armed' | 'condition' | 'targetPrice'>,
  _price: number,
): AlertEvaluation {
  throw new Error('not implemented');
}
