import { Bell } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { EmptyState } from '../../components/ui/EmptyState';
import { PageHeader } from '../../components/ui/PageHeader';
import { formatDateTime } from '../../lib/format';
import { useNotificationStore } from './notificationStore';

/** Notification inbox. A first version: the notifications feature replaces it with the full inbox. */
export function NotificationsPage() {
  const notifications = useNotificationStore((s) => s.notifications);
  return (
    <div className="page">
      <PageHeader
        title="Notifications"
        description="Alert triggers and connection events."
        actions={
          <Button
            size="sm"
            disabled={notifications.every((n) => n.read)}
            onClick={() => {
              useNotificationStore.getState().markAllRead();
            }}
          >
            Mark all read
          </Button>
        }
      />
      {notifications.length === 0 ? (
        <EmptyState icon={<Bell />} title="No notifications yet" description="Alert triggers will appear here." />
      ) : (
        <ul>
          {notifications.map((n) => (
            <li key={n.id}>
              {n.title} · {formatDateTime(new Date(n.at).toISOString())}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
