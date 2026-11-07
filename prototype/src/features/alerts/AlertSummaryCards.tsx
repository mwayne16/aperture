import { BellOff, BellRing, Zap } from 'lucide-react';
import type { ReactNode } from 'react';
import { useMemo } from 'react';
import { Skeleton } from '../../components/ui/Skeleton';
import { useNow } from '../shell/useNow';
import { summarizeAlerts } from './alertFilters';
import { useAlertStore } from './alertStore';

interface CardProps {
  icon: ReactNode;
  label: string;
  value: number | null;
  caption: string;
}

function SummaryCard({ icon, label, value, caption }: CardProps) {
  return (
    <div className="alerts-summary__card">
      <dt className="alerts-summary__label">
        <span className="alerts-summary__icon" aria-hidden="true">
          {icon}
        </span>
        {label}
      </dt>
      <dd className="alerts-summary__value num">
        {value ?? (
          <>
            <Skeleton width={32} height={24} />
            <span className="visually-hidden">Loading</span>
          </>
        )}
      </dd>
      <dd className="alerts-summary__caption">{caption}</dd>
    </div>
  );
}

/** Counts of active, triggered-today and disabled alerts. Placeholders until the list is known. */
export function AlertSummaryCards() {
  const alerts = useAlertStore((s) => s.alerts);
  // A count of 0 before the list has loaded would claim there are no alerts.
  const known = useAlertStore((s) => s.status === 'ready' || s.alerts.length > 0);
  const now = useNow();
  const summary = useMemo(() => summarizeAlerts(alerts, now), [alerts, now]);

  return (
    <dl className="alerts-summary" aria-label="Alert summary">
      <SummaryCard
        icon={<BellRing />}
        label="Active"
        value={known ? summary.active : null}
        caption={known ? `${summary.armed} armed · ${summary.waiting} waiting to re-arm` : 'Loading…'}
      />
      <SummaryCard
        icon={<Zap />}
        label="Triggered today"
        value={known ? summary.triggeredToday : null}
        caption="Alerts that fired since midnight ET"
      />
      <SummaryCard
        icon={<BellOff />}
        label="Disabled"
        value={known ? summary.disabled : null}
        caption="Not evaluated until enabled"
      />
    </dl>
  );
}
