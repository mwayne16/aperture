import { History } from 'lucide-react';
import { EmptyState } from '../../components/ui/EmptyState';
import { formatDateTime, formatPrice } from '../../lib/format';
import { ALERT_TIME_ZONE, conditionLabel } from './alertDisplay';
import { useAlertStore } from './alertStore';
import { AlertTagBadge } from './AlertTagBadge';

/** Trigger log tab: alert events received this session, newest first. */
export function TriggerLog() {
  const events = useAlertStore((s) => s.events);

  if (events.length === 0) {
    return (
      <EmptyState
        compact
        icon={<History />}
        title="No triggers yet"
        description="Alerts that fire while Aperture is open are listed here."
      />
    );
  }

  return (
    <table className="ui-table alerts-table">
      <caption className="visually-hidden">Trigger log, newest first</caption>
      <thead>
        <tr>
          <th scope="col" className="is-num alerts-table__time">
            Time (ET)
          </th>
          <th scope="col">Symbol</th>
          <th scope="col">Condition</th>
          <th scope="col" className="is-num">
            Target
          </th>
          <th scope="col" className="is-num">
            Trigger price
          </th>
          <th scope="col" className="alerts-table__fill">
            Tag
          </th>
        </tr>
      </thead>
      <tbody>
        {events.map((event) => (
          <tr key={event.id}>
            <td className="is-num alerts-table__time">
              {formatDateTime(event.triggeredAt, ALERT_TIME_ZONE)}
            </td>
            <td className="alerts-table__symbol">{event.symbol}</td>
            <td>Last {conditionLabel(event.condition).toLowerCase()}</td>
            <td className="is-num">{formatPrice(event.targetPrice)}</td>
            <td className="is-num">{formatPrice(event.price)}</td>
            <td className="alerts-table__fill">
              <AlertTagBadge tag={event.tag} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
