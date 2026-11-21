import { desktopBridge } from '../../app/desktopBridge';
import { paths } from '../../app/routes';
import { useSettingsStore } from '../settings/settingsStore';
import type { AppNotification } from './notificationRules';
import { useNotificationStore } from './notificationStore';

/**
 * Asks the desktop app to show an alert trigger as a system notification, when desktop notifications are
 * on in Settings. Simulated triggers say so in the title. Outside Electron there is no bridge and nothing
 * happens; the main process also skips it while an app window is focused, where the app shows a toast.
 */
export function showDesktopNotification(
  notification: Omit<AppNotification, 'read'>,
  simulated: boolean,
): void {
  const bridge = desktopBridge();
  if (!bridge || !useSettingsStore.getState().settings.desktopNotifications) return;
  bridge.notify({
    id: notification.id,
    title: simulated ? `Simulated · ${notification.title}` : notification.title,
    body: notification.body,
    symbol: notification.symbol,
  });
}

/** Opens the stock page of a clicked notification and marks its inbox entry read. Returns a remover. */
export function listenForNotificationClicks(): () => void {
  const bridge = desktopBridge();
  if (!bridge) return () => undefined;
  return bridge.onNotificationClick(({ id, symbol }) => {
    useNotificationStore.getState().markRead(id);
    if (symbol !== null) window.location.hash = paths.symbol(symbol);
  });
}
