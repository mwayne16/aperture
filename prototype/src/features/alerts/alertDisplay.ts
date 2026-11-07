import { isConditionMet } from '../../domain/alertEngine';
import type { AlertCondition, AlertEvent, AlertTag, PriceAlert } from '../../domain/types';
import { formatClock, formatDateTime, formatPercent, formatPrice } from '../../lib/format';

/**
 * How alerts read in the UI. Every alert compares the latest trade price (Last) with its target,
 * and market times show in US Eastern time to match the exchange clock.
 */

export const ALERT_TIME_ZONE = 'America/New_York';

const OPERATOR: Record<AlertCondition, string> = { above: '≥', below: '≤' };
const DIRECTION: Record<AlertCondition, string> = { above: 'above', below: 'below' };
const OPPOSITE: Record<AlertCondition, string> = { above: 'below', below: 'above' };

/** "Last ≥ 200.00" or "Last ≤ 200.00". */
export function conditionText(condition: AlertCondition, targetPrice: number): string {
  return `Last ${OPERATOR[condition]} ${formatPrice(targetPrice)}`;
}

/** "Above" or "Below". */
export function conditionLabel(condition: AlertCondition): string {
  return condition === 'above' ? 'Above' : 'Below';
}

/** "Buy" or "Sell". The tag is a label only; it never places an order. */
export function tagLabel(tag: AlertTag): string {
  return tag === 'buy' ? 'Buy' : 'Sell';
}

export type AlertStatus = 'armed' | 'waiting' | 'disabled';

/**
 * Armed: fires on the next trade that meets the condition. Waiting: it fired and stays quiet until
 * Last leaves the condition. Disabled: not evaluated.
 */
export function alertStatus(alert: Pick<PriceAlert, 'enabled' | 'armed'>): AlertStatus {
  if (!alert.enabled) return 'disabled';
  return alert.armed ? 'armed' : 'waiting';
}

export const ALERT_STATUS_LABEL: Record<AlertStatus, string> = {
  armed: 'Armed',
  waiting: 'Triggered, waiting to re-arm',
  disabled: 'Disabled',
};

/** One sentence on what the alert does next, for the status tooltip. */
export function statusHint(
  alert: Pick<PriceAlert, 'enabled' | 'armed' | 'condition' | 'targetPrice'>,
): string {
  const target = formatPrice(alert.targetPrice);
  switch (alertStatus(alert)) {
    case 'armed':
      return `Fires on the next trade ${alert.condition === 'above' ? 'at or above' : 'at or below'} ${target}.`;
    case 'waiting':
      return `Re-arms once Last moves back ${OPPOSITE[alert.condition]} ${target}, then can fire again.`;
    case 'disabled':
      return 'Not evaluated while disabled.';
  }
}

export interface TargetDistance {
  /** Move from Last to the target as a percent of Last (+ means the target is higher), or null without a price. */
  percent: number | null;
  /** Whether Last already meets the condition. */
  met: boolean;
}

export function targetDistance(
  condition: AlertCondition,
  targetPrice: number,
  last: number | null | undefined,
): TargetDistance {
  if (typeof last !== 'number' || !Number.isFinite(last) || last <= 0 || !Number.isFinite(targetPrice)) {
    return { percent: null, met: false };
  }
  return { percent: ((targetPrice - last) / last) * 100, met: isConditionMet(condition, last, targetPrice) };
}

/** Table order: by symbol, then "above" before "below", then by target price. */
export function sortAlerts(alerts: readonly PriceAlert[]): PriceAlert[] {
  return [...alerts].sort(
    (a, b) =>
      a.symbol.localeCompare(b.symbol) ||
      a.condition.localeCompare(b.condition) ||
      a.targetPrice - b.targetPrice ||
      a.createdAt.localeCompare(b.createdAt),
  );
}

/** "Oct 30, 14:05:09 · 3×", or "Never" for an alert that hasn't fired. */
export function lastTriggeredText(alert: Pick<PriceAlert, 'lastTriggeredAt' | 'triggerCount'>): string {
  if (alert.lastTriggeredAt === null) return 'Never';
  return `${formatDateTime(alert.lastTriggeredAt, ALERT_TIME_ZONE)} · ${alert.triggerCount}×`;
}

/** Toast copy for a trigger, e.g. "AAPL above 200.00 · Buy" / "Last trade 200.12 at 14:05:09 ET (simulated)". */
export function triggerNotice(event: AlertEvent, simulated: boolean): { title: string; description: string } {
  const at = formatClock(Date.parse(event.triggeredAt), ALERT_TIME_ZONE);
  return {
    title: `${event.symbol} ${DIRECTION[event.condition]} ${formatPrice(event.targetPrice)} · ${tagLabel(event.tag)}`,
    description: `Last trade ${formatPrice(event.price)} at ${at} ET${simulated ? ' (simulated)' : ''}`,
  };
}

/**
 * What the condition means for the current price, shown in the alert dialog. Null when the price or
 * target is unknown. `met` is true when Last already satisfies the condition. `armedAfterSave` is
 * false only when editing an alert that already fired and the edit doesn't re-arm it.
 */
export function conditionPreview(options: {
  condition: AlertCondition;
  targetPrice: number;
  last: number | null | undefined;
  enabled: boolean;
  armedAfterSave: boolean;
}): { text: string; met: boolean } | null {
  const { condition, targetPrice, last, enabled, armedAfterSave } = options;
  if (!Number.isFinite(targetPrice) || targetPrice <= 0) return null;
  const distance = targetDistance(condition, targetPrice, last);
  if (distance.percent === null) return null;
  const target = formatPrice(targetPrice);

  if (!distance.met) {
    const move = condition === 'above' ? 'rises' : 'falls';
    const text = `Triggers when Last ${move} to ${target} (${formatPercent(distance.percent)} from ${formatPrice(last)}).`;
    return { text, met: false };
  }
  const where = last === targetPrice ? `at ${target}` : `${DIRECTION[condition]} ${target}`;
  let text = `Last is already ${where}, so this alert triggers on the next trade.`;
  if (!enabled) text = `Last is already ${where}. Once enabled, this alert triggers on the next trade.`;
  else if (!armedAfterSave) {
    text = `Last is already ${where}. This alert has triggered and re-arms once Last moves back ${OPPOSITE[condition]} ${target}.`;
  }
  return { text, met: true };
}
