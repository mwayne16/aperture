import { History, SearchX } from 'lucide-react';
import { useMemo } from 'react';
import { Button } from '../../components/ui/Button';
import { EmptyState } from '../../components/ui/EmptyState';
import { formatDateTime, formatPrice } from '../../lib/format';
import { ALERT_TIME_ZONE, conditionLabel } from './alertDisplay';
import { filterEvents } from './alertFilters';
import { useAlertStore } from './alertStore';
import { AlertSymbolLink } from './AlertSymbolLink';
import { AlertTagBadge } from './AlertTagBadge';

interface TriggerHistoryProps {
  query: string;
  onClearFilters: () => void;
}

/** Alert triggers received this session, newest first, filtered by the symbol search. */
export function TriggerHistory({ query, onClearFilters }: TriggerHistoryProps) {
  const events = useAlertStore((s) => s.events);
  const visible = useMemo(() => filterEvents(events, query), [events, query]);

  if (events.length === 0) {
    return (
      <EmptyState
        icon={<History />}
        title="No triggers yet"
        description="Alerts that fire while Aperture is open are listed here for this session."
      />
    );
  }
  if (visible.length === 0) {
    return (
      <EmptyState
        icon={<SearchX />}
        title="No triggers match this symbol"
        action={
          <Button size="sm" onClick={onClearFilters}>
            Clear search
          </Button>
        }
      />
    );
  }

  return (
    <table className="ui-table alerts-table">
      <caption className="visually-hidden">Trigger history, newest first</caption>
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
            Label
          </th>
        </tr>
      </thead>
      <tbody>
        {visible.map((event) => (
          <tr key={event.id}>
            <td className="is-num alerts-table__time">{formatDateTime(event.triggeredAt, ALERT_TIME_ZONE)}</td>
            <td>
              <AlertSymbolLink symbol={event.symbol} />
            </td>
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
