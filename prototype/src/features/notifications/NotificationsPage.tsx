import { BellRing, Check, CheckCheck, Inbox, Network, Trash2, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'wouter';
import { paths } from '../../app/routes';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { cx } from '../../components/ui/cx';
import { EmptyState } from '../../components/ui/EmptyState';
import { IconButton } from '../../components/ui/IconButton';
import { PageHeader } from '../../components/ui/PageHeader';
import { Tabs } from '../../components/ui/Tabs';
import { useConnectionStore } from '../../data/connectionStore';
import { formatAge } from '../../lib/format';
import { useNow } from '../shell/useNow';
import {
  filterNotifications,
  NOTIFICATION_FILTERS,
  unreadCounts,
  type NotificationFilter,
} from './notificationFilters';
import type { AppNotification } from './notificationRules';
import { useNotificationStore } from './notificationStore';
import './notifications.css';

const EMPTY_COPY: Record<NotificationFilter, { title: string; description: string }> = {
  all: { title: 'No notifications yet', description: 'Alert triggers and connection changes will appear here.' },
  alert: { title: 'No alert notifications', description: 'When an alert triggers, it appears here.' },
  connection: { title: 'No connection notifications', description: 'Connection drops and recoveries appear here.' },
};

const absoluteTime = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'medium' });

const notificationStore = () => useNotificationStore.getState();

/** The notification inbox: alert triggers and connection changes, kept on this device. */
export function NotificationsPage() {
  const notifications = useNotificationStore((s) => s.notifications);
  const [filter, setFilter] = useState<NotificationFilter>('all');
  const [confirmingClear, setConfirmingClear] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const focusPanelOnEmpty = useRef(false);
  const counts = useMemo(() => unreadCounts(notifications), [notifications]);
  const visible = useMemo(() => filterNotifications(notifications, filter), [notifications, filter]);
  const simulated = useConnectionStore((s) => s.connection.simulated);
  const now = useNow();

  // ** Clearing disables the button that opened the confirmation, so focus would fall to <body>.
  useEffect(() => {
    if (focusPanelOnEmpty.current && notifications.length === 0) {
      focusPanelOnEmpty.current = false;
      panelRef.current?.focus();
    }
  }, [notifications]);

  const tabs = NOTIFICATION_FILTERS.map(({ value, label }) => ({
    value,
    label,
    badge: counts[value] > 0 ? counts[value] : undefined,
  }));
  const filterLabel = NOTIFICATION_FILTERS.find((f) => f.value === filter)?.label ?? 'All';

  return (
    <div className="page notifications-page">
      <PageHeader
        title="Notifications"
        meta={
          simulated && (
            <Badge tone="warning" size="sm" title="Alert triggers come from the simulated feed, not a real market">
              Simulated
            </Badge>
          )
        }
        description="Alert triggers and connection changes, kept on this device."
        actions={
          <>
            <Button
              icon={<CheckCheck />}
              disabled={counts.all === 0}
              onClick={() => {
                notificationStore().markAllRead();
              }}
            >
              Mark all read
            </Button>
            <Button
              variant="ghost"
              icon={<Trash2 />}
              aria-haspopup="dialog"
              disabled={notifications.length === 0}
              onClick={() => {
                setConfirmingClear(true);
              }}
            >
              Clear all…
            </Button>
          </>
        }
      />

      <section className="notifications-card" aria-label="Inbox">
        <div className="notifications-card__header">
          <Tabs<NotificationFilter> aria-label="Filter notifications" value={filter} onChange={setFilter} tabs={tabs} />
        </div>
        <div ref={panelRef} className="notifications-card__panel" role="tabpanel" aria-label={filterLabel} tabIndex={-1}>
          {visible.length === 0 ? (
            <EmptyState icon={<Inbox />} {...EMPTY_COPY[filter]} />
          ) : (
            <ul className="notice-list" aria-label={`${filterLabel} notifications, newest first`}>
              {visible.map((notification) => (
                <NotificationItem key={notification.id} notification={notification} now={now} />
              ))}
            </ul>
          )}
        </div>
      </section>

      <ConfirmDialog
        open={confirmingClear}
        title="Clear all notifications?"
        message={`All ${notifications.length} notifications are removed from this device. This can't be undone.`}
        confirmLabel="Clear all"
        tone="danger"
        onCancel={() => {
          setConfirmingClear(false);
        }}
        onConfirm={() => {
          focusPanelOnEmpty.current = true;
          setConfirmingClear(false);
          notificationStore().clear();
        }}
      />
    </div>
  );
}

/** After an entry is removed, focus moves to the same control on a neighboring entry, or the list's panel. */
function focusNeighborAfterRemoval(item: HTMLElement): void {
  const neighbor = item.nextElementSibling ?? item.previousElementSibling;
  const target =
    neighbor?.querySelector<HTMLElement>('[data-notice-remove]') ?? item.closest<HTMLElement>('[role="tabpanel"]');
  target?.focus();
}

function NotificationItem({ notification: n, now }: { notification: AppNotification; now: number }) {
  const markRead = () => {
    notificationStore().markRead(n.id);
  };
  const Icon = n.kind === 'alert' ? BellRing : Network;

  return (
    <li
      className={cx('notice', !n.read && 'is-unread')}
      data-kind={n.kind}
      // ** A click anywhere on an entry counts as opening it. The link and buttons inside stay the
      // keyboard path.
      onClick={markRead}
    >
      <span className="notice__icon" aria-hidden="true">
        <Icon />
      </span>
      <div className="notice__content">
        <p className="notice__title">
          {!n.read && <span className="visually-hidden">Unread: </span>}
          {n.kind === 'alert' && n.symbol !== null ? (
            <Link href={paths.symbol(n.symbol)} className="notice__link" onClick={markRead}>
              {n.title}
            </Link>
          ) : (
            n.title
          )}
        </p>
        <p className="notice__body">{n.body}</p>
      </div>
      <time className="notice__time num" dateTime={new Date(n.at).toISOString()} title={absoluteTime.format(n.at)}>
        {formatAge(n.at, now)}
      </time>
      <div className="notice__actions">
        {!n.read && (
          <IconButton
            size="sm"
            label="Mark as read"
            icon={<Check />}
            onClick={(event) => {
              // ** The button disappears once the entry is read, so focus moves to its neighbor.
              event.currentTarget
                .closest('.notice')
                ?.querySelector<HTMLElement>('[data-notice-remove]')
                ?.focus();
              markRead();
            }}
          />
        )}
        <IconButton
          size="sm"
          label="Remove notification"
          icon={<X />}
          data-notice-remove
          onClick={(event) => {
            event.stopPropagation();
            const item = event.currentTarget.closest<HTMLElement>('.notice');
            if (item) focusNeighborAfterRemoval(item);
            notificationStore().remove(n.id);
          }}
        />
      </div>
    </li>
  );
}
