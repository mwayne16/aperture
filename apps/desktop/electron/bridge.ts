/**
 * The only desktop capabilities the renderer can reach, exposed as `window.aperture` by the preload
 * script. Keep it small: market data and app state go through the backend's HTTP and WebSocket API.
 */
export interface DesktopBridge {
  /** Operating system, e.g. "win32", for platform-specific labels. */
  platform: string;
  /** Runtime versions shown in Settings → About. */
  versions: { electron: string; chrome: string };
  /**
   * Asks for a native notification. The main process shows it only while no app window is focused,
   * since the app shows its own toast otherwise, and ignores a malformed request.
   */
  notify(notification: DesktopNotification): void;
  /** Calls `listener` when the user clicks a notification. Returns a function that removes it. */
  onNotificationClick(listener: (click: NotificationClick) => void): () => void;
}

export interface DesktopNotification {
  /** The app's inbox id for this notification, returned when it is clicked. */
  id: string;
  title: string;
  body: string;
  /** The stock page to open on click, or null. */
  symbol: string | null;
}

export type NotificationClick = Pick<DesktopNotification, 'id' | 'symbol'>;

/** IPC channels between the preload script and the main process. */
export const NOTIFY_CHANNEL = 'aperture:notify';
export const NOTIFICATION_CLICK_CHANNEL = 'aperture:notification-click';
