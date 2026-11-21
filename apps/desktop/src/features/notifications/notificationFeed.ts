import { useConnectionStore } from '../../data/connectionStore';
import { realtime } from '../../data/dataLayer';
import type { AlertEvent } from '../../domain/types';
import { triggerNotice } from '../alerts/alertDisplay';
import { outageNotification, trackOutage, type Outage } from './connectionNotices';
import { listenForNotificationClicks, showDesktopNotification } from './desktopNotifications';
import type { AppNotification } from './notificationRules';
import { useNotificationStore } from './notificationStore';

/** The inbox entry for one alert trigger. The event id keeps a re-delivered trigger from adding a second entry. */
function alertNotification(event: AlertEvent, simulated: boolean): Omit<AppNotification, 'read'> {
  const { title, description } = triggerNotice(event, simulated);
  const at = Date.parse(event.triggeredAt);
  return {
    id: `alert:${event.id}`,
    kind: 'alert',
    title,
    body: description,
    at: Number.isFinite(at) ? at : Date.now(),
    symbol: event.symbol,
  };
}

let users = 0;
let stopWiring: (() => void) | null = null;
let outageSeq = 0;

function createOutageId(): string {
  outageSeq += 1;
  return `connection:${Date.now()}-${outageSeq}`;
}

function wire(): () => void {
  let outage: Outage | null = null;
  const offAlert = realtime.onAlert((event) => {
    const { simulated } = useConnectionStore.getState().connection;
    const notification = alertNotification(event, simulated);
    const inbox = useNotificationStore.getState();
    // ** A re-delivered trigger is already in the inbox and was already shown on the desktop.
    const isNew = !inbox.notifications.some((n) => n.id === notification.id);
    inbox.add(notification);
    if (isNew) showDesktopNotification(notification, simulated);
  });
  const offClicks = listenForNotificationClicks();
  const offConnection = useConnectionStore.subscribe((state, previous) => {
    if (state.connection.state === previous.connection.state) return;
    const next = trackOutage(outage, previous.connection.state, state.connection, Date.now(), createOutageId);
    if (next === outage || next === null) return;
    outage = next;
    useNotificationStore.getState().upsert(outageNotification(next));
  });
  return () => {
    offAlert();
    offClicks();
    offConnection();
  };
}

/**
 * Fills the notification inbox from alert triggers and connection changes. Idempotent: extra calls
 * never add a second listener, and each call returns its own teardown. The feed stops once every
 * caller has torn down, which suits StrictMode double mounts and a second host mounting it.
 * New alert triggers are also shown as desktop notifications in the Electron app.
 */
export function startNotificationFeed(): () => void {
  users += 1;
  stopWiring ??= wire();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    users -= 1;
    if (users === 0 && stopWiring) {
      const stop = stopWiring;
      stopWiring = null;
      stop();
    }
  };
}
