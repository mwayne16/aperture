import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import {
  NOTIFICATION_CLICK_CHANNEL,
  NOTIFY_CHANNEL,
  type DesktopBridge,
  type NotificationClick,
} from './bridge';

// Runs sandboxed with context isolation: the renderer sees only this plain object, never Node or Electron.
const bridge: DesktopBridge = {
  platform: process.platform,
  versions: { electron: process.versions.electron, chrome: process.versions.chrome },
  notify(notification) {
    ipcRenderer.send(NOTIFY_CHANNEL, notification);
  },
  onNotificationClick(listener) {
    // ** The renderer gets the click, never the IPC event, which would expose the sender.
    const handler = (_event: IpcRendererEvent, click: NotificationClick) => {
      listener(click);
    };
    ipcRenderer.on(NOTIFICATION_CLICK_CHANNEL, handler);
    return () => {
      ipcRenderer.removeListener(NOTIFICATION_CLICK_CHANNEL, handler);
    };
  },
};

contextBridge.exposeInMainWorld('aperture', bridge);
