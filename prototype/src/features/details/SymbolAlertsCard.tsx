import { BellPlus, BellRing, Pencil, RotateCw, TriangleAlert } from 'lucide-react';
import { useMemo } from 'react';
import { useUiStore } from '../../app/uiStore';
import { Button } from '../../components/ui/Button';
import { EmptyState } from '../../components/ui/EmptyState';
import { IconButton } from '../../components/ui/IconButton';
import { Skeleton } from '../../components/ui/Skeleton';
import { StatusDot } from '../../components/ui/StatusDot';
import { Switch } from '../../components/ui/Switch';
import type { PriceAlert } from '../../domain/types';
import {
  ALERT_STATUS_LABEL,
  alertStatus,
  conditionText,
  lastTriggeredText,
  statusHint,
  type AlertStatus,
} from '../alerts/alertDisplay';
import { useAlertStore } from '../alerts/alertStore';
import { AlertTagBadge } from '../alerts/AlertTagBadge';
import { StockCard } from './StockCard';
import { alertsForSymbol } from './symbolAlerts';
import './stockPage.css';

const STATUS_TONE: Record<AlertStatus, 'accent' | 'warning' | 'muted'> = {
  armed: 'accent',
  waiting: 'warning',
  disabled: 'muted',
};

function openCreate(symbol: string) {
  useUiStore.getState().openCreateAlert(symbol);
}

/** This symbol's price alerts, with their status, an enable switch and the alert dialog for edits. */
export function SymbolAlertsCard({ symbol }: { symbol: string }) {
  const alerts = useAlertStore((s) => s.alerts);
  const status = useAlertStore((s) => s.status);
  const error = useAlertStore((s) => s.error);
  const mine = useMemo(() => alertsForSymbol(alerts, symbol), [alerts, symbol]);

  return (
    <StockCard
      title={`Alerts for ${symbol}`}
      className="symbol-alerts-card"
      actions={
        <Button
          size="sm"
          icon={<BellPlus />}
          onClick={() => {
            openCreate(symbol);
          }}
        >
          New alert
        </Button>
      }
    >
      <AlertsBody symbol={symbol} alerts={mine} status={status} error={error} />
      <p className="stock-card__footnote">
        Checked against the latest trade price. Buy and Sell tags are labels only; Aperture never places trades.
      </p>
    </StockCard>
  );
}

interface AlertsBodyProps {
  symbol: string;
  alerts: PriceAlert[];
  status: 'idle' | 'loading' | 'ready' | 'error';
  error: string | null;
}

function AlertsBody({ symbol, alerts, status, error }: AlertsBodyProps) {
  if (alerts.length === 0 && (status === 'idle' || status === 'loading')) {
    return (
      <div className="symbol-alerts__loading" aria-busy="true">
        <span className="visually-hidden">Loading alerts</span>
        <Skeleton height={16} />
        <Skeleton height={16} width="70%" />
      </div>
    );
  }
  if (alerts.length === 0 && status === 'error') {
    return (
      <EmptyState
        compact
        icon={<TriangleAlert />}
        title="Couldn't load alerts"
        description={error ?? undefined}
        action={
          <Button
            size="sm"
            icon={<RotateCw />}
            onClick={() => {
              void useAlertStore.getState().load({ force: true });
            }}
          >
            Retry
          </Button>
        }
      />
    );
  }
  if (alerts.length === 0) {
    return (
      <EmptyState
        compact
        icon={<BellRing />}
        title={`No alerts for ${symbol}`}
        description="Get notified when the price crosses a level you choose."
      />
    );
  }
  return (
    <ul className="symbol-alerts">
      {alerts.map((alert) => (
        <AlertRow key={alert.id} alert={alert} />
      ))}
    </ul>
  );
}

function AlertRow({ alert }: { alert: PriceAlert }) {
  const status = alertStatus(alert);
  const condition = conditionText(alert.condition, alert.targetPrice);
  return (
    <li className="symbol-alert">
      <div className="symbol-alert__main">
        <span className="symbol-alert__condition num">{condition}</span>
        <AlertTagBadge tag={alert.tag} />
      </div>
      <div className="symbol-alert__meta">
        <span title={statusHint(alert)}>
          <StatusDot tone={STATUS_TONE[status]} label={ALERT_STATUS_LABEL[status]} />
        </span>
        <span className="symbol-alert__last">Last triggered: {lastTriggeredText(alert)}</span>
      </div>
      <div className="symbol-alert__actions">
        <Switch
          checked={alert.enabled}
          onChange={(enabled) => {
            void useAlertStore.getState().setEnabled(alert.id, enabled);
          }}
          label={`Enabled: ${condition}`}
          hideLabel
        />
        <IconButton
          size="sm"
          label={`Edit alert ${condition}`}
          icon={<Pencil />}
          onClick={() => {
            useUiStore.getState().openEditAlert(alert.id);
          }}
        />
      </div>
    </li>
  );
}
