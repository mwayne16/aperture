import { BellPlus, Ellipsis, Pencil, Plus, RotateCw, SearchX, Trash2, TriangleAlert } from 'lucide-react';
import { memo, useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { useUiStore } from '../../app/uiStore';
import { Button } from '../../components/ui/Button';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { cx } from '../../components/ui/cx';
import { EmptyState } from '../../components/ui/EmptyState';
import { IconButton } from '../../components/ui/IconButton';
import { Menu } from '../../components/ui/Menu';
import { Skeleton } from '../../components/ui/Skeleton';
import { StatusDot } from '../../components/ui/StatusDot';
import { Switch } from '../../components/ui/Switch';
import { useQuote } from '../../data/quoteStore';
import type { AlertCondition, PriceAlert } from '../../domain/types';
import { changeDirection, formatDateTime, formatPercent, formatPrice } from '../../lib/format';
import {
  ALERT_STATUS_LABEL,
  ALERT_TIME_ZONE,
  alertStatus,
  conditionText,
  lastTriggeredText,
  sortAlerts,
  statusHint,
  targetDistance,
  type AlertStatus,
} from './alertDisplay';
import { filterAlerts, type StatusFilter } from './alertFilters';
import { useAlertStore } from './alertStore';
import { AlertSymbolLink } from './AlertSymbolLink';
import { AlertTagBadge } from './AlertTagBadge';

const STATUS_TONE: Record<AlertStatus, 'accent' | 'warning' | 'muted'> = {
  armed: 'accent',
  waiting: 'warning',
  disabled: 'muted',
};

const NO_IDS: ReadonlySet<string> = new Set();

/**
 * Opens the create dialog from the empty state. The empty state disappears once the alert exists and
 * the dialog returns focus to whatever opened it, so focus first moves to the page's New alert button.
 */
function openCreateFromEmptyState(): void {
  document.querySelector<HTMLElement>('[data-alerts-new]')?.focus();
  useUiStore.getState().openCreateAlert(null);
}

interface AlertsTableProps {
  status: StatusFilter;
  query: string;
  onClearFilters: () => void;
}

/** The alert table with its loading, error and empty states, filters, and delete confirmation. */
export function AlertsTable({ status, query, onClearFilters }: AlertsTableProps) {
  const loadStatus = useAlertStore((s) => s.status);
  const error = useAlertStore((s) => s.error);
  const alerts = useAlertStore((s) => s.alerts);
  const filterKey = `${status}|${query}`;
  // ** A row the user just toggled stays visible until the filters change, even if it no longer
  // matches the status filter, so the switch doesn't vanish (and drop focus) mid-click.
  const [kept, setKept] = useState<{ filterKey: string; ids: ReadonlySet<string> }>({ filterKey, ids: NO_IDS });
  // Any filter change forgets the kept rows, including a change that later returns to the same filters.
  if (kept.filterKey !== filterKey) setKept({ filterKey, ids: NO_IDS });
  const keepIds = kept.filterKey === filterKey ? kept.ids : NO_IDS;
  const visible = useMemo(
    () => sortAlerts(filterAlerts(alerts, { status, query, keep: keepIds })),
    [alerts, status, query, keepIds],
  );
  const [confirming, setConfirming] = useState<PriceAlert | null>(null);
  // Kept after the dialog closes so its message doesn't blank out while it animates away.
  const [lastConfirming, setLastConfirming] = useState<PriceAlert | null>(null);
  const focusAfterDelete = useRef<string | null>(null);
  const emptyActionRef = useRef<HTMLButtonElement>(null);

  const askDelete = useCallback((alert: PriceAlert) => {
    setConfirming(alert);
    setLastConfirming(alert);
  }, []);

  const keepVisible = useCallback(
    (id: string) => {
      setKept((current) => {
        const ids = new Set(current.filterKey === filterKey ? current.ids : NO_IDS);
        ids.add(id);
        return { filterKey, ids };
      });
    },
    [filterKey],
  );

  const confirmDelete = () => {
    if (!confirming) return;
    const index = visible.findIndex((a) => a.id === confirming.id);
    const neighbor = visible[index + 1] ?? visible[index - 1];
    focusAfterDelete.current = neighbor?.id ?? '';
    setConfirming(null);
    void useAlertStore.getState().remove(confirming.id);
  };

  // ** The deleted row's menu button opened the dialog, so focus would fall to <body> once the row is
  // gone. Move it to the neighboring row's actions, or to the empty state's action.
  useEffect(() => {
    const id = focusAfterDelete.current;
    if (id === null) return;
    focusAfterDelete.current = null;
    const target =
      id === ''
        ? (emptyActionRef.current ?? document.querySelector<HTMLElement>('[data-alerts-new]'))
        : document.querySelector<HTMLElement>(`[data-alert-actions="${CSS.escape(id)}"]`);
    target?.focus();
  }, [alerts]);

  const retry = (event: MouseEvent<HTMLButtonElement>) => {
    // ** Retry disappears while the list loads, so keep focus in the panel instead of dropping it to <body>.
    event.currentTarget.closest<HTMLElement>('[role="tabpanel"]')?.focus();
    void useAlertStore.getState().load();
  };

  let content;
  if ((loadStatus === 'idle' || loadStatus === 'loading') && alerts.length === 0) {
    content = <AlertsSkeleton />;
  } else if (loadStatus === 'error' && alerts.length === 0) {
    content = (
      <EmptyState
        icon={<TriangleAlert />}
        title="Couldn't load alerts"
        description={error ?? undefined}
        action={
          <Button size="sm" icon={<RotateCw />} onClick={retry}>
            Retry
          </Button>
        }
      />
    );
  } else if (alerts.length === 0) {
    content = (
      <EmptyState
        icon={<BellPlus />}
        title="No alerts yet"
        description="Get notified when a symbol's last trade crosses a price you choose."
        action={
          <Button ref={emptyActionRef} size="sm" variant="primary" icon={<Plus />} onClick={openCreateFromEmptyState}>
            New alert
          </Button>
        }
      />
    );
  } else {
    content = (
      <>
        {loadStatus === 'error' && (
          <div className="alerts-banner" role="alert">
            <TriangleAlert aria-hidden="true" />
            <span>Couldn&apos;t refresh alerts. {error}</span>
            <Button size="sm" variant="ghost" icon={<RotateCw />} onClick={retry}>
              Retry
            </Button>
          </div>
        )}
        {visible.length === 0 ? (
          <EmptyState
            icon={<SearchX />}
            title="No alerts match these filters"
            description="Try another status or symbol."
            action={
              <Button ref={emptyActionRef} size="sm" onClick={onClearFilters}>
                Clear filters
              </Button>
            }
          />
        ) : (
          <table className="ui-table alerts-table">
            <caption className="visually-hidden">Price alerts</caption>
            <thead>
              <tr>
                <th scope="col">Symbol</th>
                <th scope="col">Condition</th>
                <th scope="col" className="is-num">
                  Current
                </th>
                <th scope="col" className="is-num" title="Move from Current to the target">
                  To target
                </th>
                <th scope="col">Label</th>
                <th scope="col">Status</th>
                <th scope="col">Enabled</th>
                <th scope="col" className="is-num">
                  Last triggered (ET)
                </th>
                <th scope="col" className="is-num">
                  Updated (ET)
                </th>
                <th scope="col" className="alerts-table__note">
                  Note
                </th>
                <th scope="col" className="alerts-table__actions">
                  <span className="visually-hidden">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {visible.map((alert) => (
                <AlertRow key={alert.id} alert={alert} onDelete={askDelete} onToggle={keepVisible} />
              ))}
            </tbody>
          </table>
        )}
      </>
    );
  }

  return (
    <>
      {content}
      <ConfirmDialog
        open={confirming !== null}
        title="Delete alert?"
        message={
          lastConfirming && (
            <>
              <strong>
                {lastConfirming.symbol} {conditionText(lastConfirming.condition, lastConfirming.targetPrice)}
              </strong>{' '}
              will stop being monitored. This can&apos;t be undone.
            </>
          )
        }
        confirmLabel="Delete"
        tone="danger"
        onConfirm={confirmDelete}
        onCancel={() => {
          setConfirming(null);
        }}
      />
    </>
  );
}

function AlertsSkeleton() {
  return (
    <div className="alerts-skeleton" role="status">
      <span className="visually-hidden">Loading alerts…</span>
      {[0, 1, 2].map((row) => (
        <div key={row} className="alerts-skeleton__row">
          <Skeleton width={44} />
          <Skeleton width={96} />
          <Skeleton width={64} />
          <Skeleton width={52} />
          <Skeleton width={32} />
          <Skeleton width={120} />
        </div>
      ))}
    </div>
  );
}

interface AlertRowProps {
  alert: PriceAlert;
  onDelete: (alert: PriceAlert) => void;
  onToggle: (id: string) => void;
}

const AlertRow = memo(function AlertRow({ alert, onDelete, onToggle }: AlertRowProps) {
  const status = alertStatus(alert);
  const condition = conditionText(alert.condition, alert.targetPrice);
  const name = `${alert.symbol} ${condition}`;

  return (
    <tr data-status={status}>
      <td>
        <AlertSymbolLink symbol={alert.symbol} />
      </td>
      <td className="num alerts-table__condition">{condition}</td>
      <LiveCells
        symbol={alert.symbol}
        condition={alert.condition}
        targetPrice={alert.targetPrice}
        enabled={alert.enabled}
      />
      <td>
        <AlertTagBadge tag={alert.tag} />
      </td>
      <td title={statusHint(alert)}>
        <StatusDot tone={STATUS_TONE[status]} label={ALERT_STATUS_LABEL[status]} />
      </td>
      <td>
        <Switch
          checked={alert.enabled}
          onChange={(enabled) => {
            onToggle(alert.id);
            void useAlertStore.getState().setEnabled(alert.id, enabled);
          }}
          label={`Enabled: ${name}`}
          hideLabel
        />
      </td>
      <td className="is-num">{lastTriggeredText(alert)}</td>
      <td className="is-num">{formatDateTime(alert.updatedAt, ALERT_TIME_ZONE)}</td>
      <td className="alerts-table__note" title={alert.note ?? undefined}>
        {alert.note}
      </td>
      <td className="alerts-table__actions">
        <Menu
          align="end"
          trigger={(props) => (
            <IconButton
              {...props}
              label={`Actions for ${name}`}
              icon={<Ellipsis />}
              size="sm"
              data-alert-actions={alert.id}
            />
          )}
          items={[
            {
              id: 'edit',
              label: 'Edit',
              icon: <Pencil />,
              onSelect: () => {
                useUiStore.getState().openEditAlert(alert.id);
              },
            },
            {
              id: 'delete',
              label: 'Delete',
              icon: <Trash2 />,
              danger: true,
              onSelect: () => {
                onDelete(alert);
              },
            },
          ]}
        />
      </td>
    </tr>
  );
});

interface LiveCellsProps {
  symbol: string;
  condition: AlertCondition;
  targetPrice: number;
  enabled: boolean;
}

/** Current price and distance to target. Its own component so a tick re-renders only these cells. */
function LiveCells({ symbol, condition, targetPrice, enabled }: LiveCellsProps) {
  const quote = useQuote(symbol);
  const last = quote?.status === 'unavailable' ? null : (quote?.last ?? null);
  const stale = quote?.status === 'stale';
  const direction = changeDirection(quote?.change);
  const distance = targetDistance(condition, targetPrice, last);

  let priceTitle: string | undefined;
  if (last === null) priceTitle = enabled ? 'No price yet' : 'No live price while the alert is disabled';
  else if (stale) priceTitle = 'Stale: no recent trades';

  return (
    <>
      <td
        className={cx('is-num', stale ? 'is-muted' : direction > 0 ? 'is-gain' : direction < 0 && 'is-loss')}
        title={priceTitle}
      >
        {formatPrice(last)}
      </td>
      <td className="is-num" title={distance.met ? 'Last already meets the condition' : undefined}>
        {distance.met ? <span className="alerts-met">Met</span> : formatPercent(distance.percent)}
      </td>
    </>
  );
}
