import { BellRing, ChevronRight } from 'lucide-react';
import { Link } from 'wouter';
import { paths } from '../../app/routes';
import { Badge } from '../../components/ui/Badge';
import { EmptyState } from '../../components/ui/EmptyState';
import type { AlertEvent } from '../../domain/types';
import { formatAge, formatDateTime, formatPrice } from '../../lib/format';
import { ALERT_TIME_ZONE, conditionText, tagLabel } from '../alerts/alertDisplay';
import { useAlertStore } from '../alerts/alertStore';
import { SimulatedBadge } from '../discover/SimulatedBadge';
import { useNow } from '../shell/useNow';
import { CardError, DashboardCard, SkeletonRows } from './DashboardCard';

const MAX_EVENTS = 5;

function reloadAlerts(): void {
  void useAlertStore.getState().load({ force: true });
}

/** The latest alert triggers of this session, newest first, linking to the alerts page. */
export function AlertsCard() {
  const events = useAlertStore((s) => s.events);
  const status = useAlertStore((s) => s.status);
  const error = useAlertStore((s) => s.error);
  const armed = useAlertStore((s) => s.alerts.filter((a) => a.enabled && a.armed).length);
  const total = useAlertStore((s) => s.alerts.length);

  let body;
  if (events.length > 0) {
    body = <EventList events={events.slice(0, MAX_EVENTS)} />;
  } else if (status === 'error') {
    body = (
      <CardError
        title="Couldn't load alerts"
        message={error ?? 'Something went wrong.'}
        onRetry={reloadAlerts}
      />
    );
  } else if (status === 'idle' || status === 'loading') {
    body = <SkeletonRows count={3} />;
  } else {
    body = (
      <EmptyState
        compact
        icon={<BellRing />}
        title="No alerts have fired yet"
        description={
          total === 0
            ? 'Create an alert from any symbol page to hear when a price crosses your target.'
            : `${armed} of ${total} ${total === 1 ? 'alert is' : 'alerts are'} armed. Triggers show up here as they happen.`
        }
      />
    );
  }

  return (
    <DashboardCard
      title="Recent alerts"
      className="dash-alerts"
      meta={
        events.length > 0 && <SimulatedBadge title="Triggered by simulated prices, not real market data." />
      }
      actions={
        <Link href={paths.alerts} className="dash-card__link">
          All alerts
          <ChevronRight aria-hidden="true" />
        </Link>
      }
    >
      {body}
    </DashboardCard>
  );
}

function EventList({ events }: { events: readonly AlertEvent[] }) {
  const now = useNow();
  return (
    <ul className="dash-list">
      {events.map((event) => (
        <li key={event.id}>
          <Link href={paths.symbol(event.symbol)} className="dash-row dash-row--alert">
            <span className="dash-row__label">
              <span className="dash-row__symbol">{event.symbol}</span>{' '}
              <span className="dash-row__name">{conditionText(event.condition, event.targetPrice)}</span>
            </span>{' '}
            <span className="dash-row__value num">
              <span className="visually-hidden">triggered at </span>
              {formatPrice(event.price)}
            </span>{' '}
            <span className="dash-row__badge">
              <Badge
                tone={event.tag === 'buy' ? 'gain' : 'loss'}
                size="sm"
                title="Label only. Aperture never places trades."
              >
                {tagLabel(event.tag)}
              </Badge>
            </span>{' '}
            <time
              className="dash-row__time num"
              dateTime={event.triggeredAt}
              title={`${formatDateTime(event.triggeredAt, ALERT_TIME_ZONE)} ET`}
            >
              {formatAge(Date.parse(event.triggeredAt), now)}
            </time>
          </Link>
        </li>
      ))}
    </ul>
  );
}
