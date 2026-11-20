import type { AlertEvent, PriceAlert } from '@aperture/shared/alerts';
import type { AlertEntity } from './alertEntity.js';
import type { AlertEventEntity } from './alertEventEntity.js';

/** An alert in the API's shape. */
export function toPriceAlert(alert: AlertEntity): PriceAlert {
  return {
    id: alert.id,
    symbol: alert.symbol,
    condition: alert.condition,
    targetPrice: alert.targetPrice,
    tag: alert.tag,
    field: alert.field,
    enabled: alert.enabled,
    armed: alert.armed,
    note: alert.note,
    createdAt: alert.createdAt.toISOString(),
    updatedAt: alert.updatedAt.toISOString(),
    lastTriggeredAt: alert.lastTriggeredAt?.toISOString() ?? null,
    lastTriggeredPrice: alert.lastTriggeredPrice,
    triggerCount: alert.triggerCount,
  };
}

/** A trigger in the API's shape. */
export function toAlertEvent(event: AlertEventEntity): AlertEvent {
  return {
    id: event.id,
    alertId: event.alertId,
    symbol: event.symbol,
    condition: event.condition,
    targetPrice: event.targetPrice,
    tag: event.tag,
    field: event.field,
    price: event.price,
    triggeredAt: event.triggeredAt.toISOString(),
  };
}
