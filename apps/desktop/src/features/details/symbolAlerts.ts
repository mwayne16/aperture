import { normalizeSymbol } from '../../domain/symbols';
import type { PriceAlert } from '../../domain/types';
import { sortAlerts } from '../alerts/alertDisplay';

/** One symbol's alerts in the alerts table's order: above before below, then by target price. */
export function alertsForSymbol(alerts: readonly PriceAlert[], symbol: string): PriceAlert[] {
  const key = normalizeSymbol(symbol);
  return sortAlerts(alerts.filter((alert) => normalizeSymbol(alert.symbol) === key));
}
