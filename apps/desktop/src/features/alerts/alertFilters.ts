import dayjs from 'dayjs';
import timezone from 'dayjs/plugin/timezone';
import utc from 'dayjs/plugin/utc';
import type { AlertEvent, PriceAlert } from '../../domain/types';
import { ALERT_TIME_ZONE, alertStatus, type AlertStatus } from './alertDisplay';

dayjs.extend(utc);
dayjs.extend(timezone);

/** Filtering and counting for the alerts page. */

export type StatusFilter = 'all' | AlertStatus;

export const STATUS_FILTERS: readonly { value: StatusFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'armed', label: 'Armed' },
  { value: 'waiting', label: 'Waiting to re-arm' },
  { value: 'disabled', label: 'Disabled' },
];

/** Whether `symbol` contains the search text, ignoring case and surrounding spaces. Empty text matches all. */
function matchesSymbol(symbol: string, query: string): boolean {
  const text = query.trim().toUpperCase();
  return text === '' || symbol.toUpperCase().includes(text);
}

interface AlertFilter {
  status: StatusFilter;
  query: string;
  /** Ids that pass the status filter regardless, such as rows the user just toggled. */
  keep?: ReadonlySet<string>;
}

/** Alerts with the chosen status whose symbol matches the search, in their original order. */
export function filterAlerts(alerts: readonly PriceAlert[], filter: AlertFilter): PriceAlert[] {
  return alerts.filter(
    (alert) =>
      (filter.status === 'all' || alertStatus(alert) === filter.status || filter.keep?.has(alert.id) === true) &&
      matchesSymbol(alert.symbol, filter.query),
  );
}

/** Trigger events whose symbol matches the search, in their original order. */
export function filterEvents(events: readonly AlertEvent[], query: string): AlertEvent[] {
  return events.filter((event) => matchesSymbol(event.symbol, query));
}

export interface AlertSummary {
  /** Enabled alerts: armed plus waiting. */
  active: number;
  armed: number;
  waiting: number;
  disabled: number;
  /** Alerts whose last trigger fell on the current US Eastern calendar day. */
  triggeredToday: number;
}

function easternDay(epochMs: number): string {
  return dayjs(epochMs).tz(ALERT_TIME_ZONE).format('YYYY-MM-DD');
}

/** Counts for the summary cards. "Today" follows the exchange clock (US Eastern), like the alert times. */
export function summarizeAlerts(alerts: readonly PriceAlert[], now: number): AlertSummary {
  const summary: AlertSummary = { active: 0, armed: 0, waiting: 0, disabled: 0, triggeredToday: 0 };
  const today = easternDay(now);
  for (const alert of alerts) {
    const status = alertStatus(alert);
    summary[status] += 1;
    if (status !== 'disabled') summary.active += 1;
    const triggeredAt = alert.lastTriggeredAt === null ? Number.NaN : Date.parse(alert.lastTriggeredAt);
    if (Number.isFinite(triggeredAt) && easternDay(triggeredAt) === today) summary.triggeredToday += 1;
  }
  return summary;
}
