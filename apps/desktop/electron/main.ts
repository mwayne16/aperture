import {
  app,
  BrowserWindow,
  ipcMain,
  Notification,
  session,
  shell,
  type BrowserWindowConstructorOptions,
} from 'electron';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { NOTIFICATION_CLICK_CHANNEL, NOTIFY_CHANNEL, type DesktopNotification } from './bridge';
import { isAppUrl, isExternalWebUrl, isPopOutUrl } from './navigation';
import { parseNotification } from './notifications';

/**
 * Electron main process: owns the windows and locks down what their pages may do. The renderer is a
 * plain web app with no Node access; it talks to the backend over HTTP and WebSocket and reaches the
 * desktop only through the small preload bridge.
 */

const DEV_RENDERER_URL = process.env.ELECTRON_RENDERER_URL;
const APP_URL =
  DEV_RENDERER_URL ?? pathToFileURL(fileURLToPath(new URL('../renderer/index.html', import.meta.url))).href;
const PRELOAD_PATH = fileURLToPath(new URL('../preload/preload.cjs', import.meta.url));

/** Shared by the main window and pop-outs, so a pop-out is never less locked down than its opener. */
const WINDOW_OPTIONS: BrowserWindowConstructorOptions = {
  width: 1440,
  height: 900,
  minWidth: 960,
  minHeight: 640,
  title: 'Aperture',
  backgroundColor: '#0b0f14',
  show: false,
  webPreferences: {
    preload: PRELOAD_PATH,
    contextIsolation: true,
    sandbox: true,
    nodeIntegration: false,
    webSecurity: true,
  },
};

function createMainWindow(): BrowserWindow {
  const window = new BrowserWindow(WINDOW_OPTIONS);
  window.once('ready-to-show', () => {
    window.show();
  });
  void window.loadURL(APP_URL);
  return window;
}

/**
 * Every page, including pop-outs, may only show the app itself. App pop-out routes open as native
 * windows with the same settings, web links open in the system browser, and everything else is blocked.
 */
function hardenContents(): void {
  app.on('web-contents-created', (_event, contents) => {
    contents.setWindowOpenHandler(({ url }) => {
      if (isPopOutUrl(url, APP_URL)) return { action: 'allow', overrideBrowserWindowOptions: WINDOW_OPTIONS };
      if (isExternalWebUrl(url) && !isAppUrl(url, APP_URL)) void shell.openExternal(url);
      return { action: 'deny' };
    });
    // Pop-outs inherit `show: false`, so each one appears once its page is ready, like the main window.
    contents.on('did-create-window', (child) => {
      child.once('ready-to-show', () => {
        child.show();
      });
    });
    contents.on('will-navigate', (event, url) => {
      if (isAppUrl(url, APP_URL)) return;
      event.preventDefault();
      if (isExternalWebUrl(url)) void shell.openExternal(url);
    });
  });
  // The app needs no camera, microphone, location or other browser permissions.
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => {
    callback(false);
  });
}

/**
 * Windows shows notifications only for an app with an App User Model ID that matches a Start Menu
 * shortcut. The installer must create its shortcut with this id; a development run uses Electron's own
 * executable, which shows notifications once it is pinned to the Start Menu.
 */
const APP_USER_MODEL_ID = 'com.aperture.desktop';

/** Notifications still on screen. Holding them keeps their click handlers alive; the oldest go first. */
const onScreen = new Set<Notification>();
const MAX_ON_SCREEN = 20;

interface NotificationPolicy {
  /** True while an app window has focus; the app then shows its own toast instead. */
  appHasFocus(): boolean;
  /** Puts the notification on screen and calls `onClick` when the user clicks it. */
  present(notification: DesktopNotification, onClick: () => void): void;
}

function presentNative(request: DesktopNotification, onClick: () => void): void {
  if (!Notification.isSupported()) return;
  const notification = new Notification({ title: request.title, body: request.body });
  const forget = () => onScreen.delete(notification);
  notification.on('click', () => {
    forget();
    onClick();
  });
  notification.on('close', forget);
  notification.on('failed', (_event, error) => {
    forget();
    console.warn(`A desktop notification could not be shown: ${error}`);
  });
  onScreen.add(notification);
  for (const oldest of onScreen) {
    if (onScreen.size <= MAX_ON_SCREEN) break;
    onScreen.delete(oldest);
  }
  notification.show();
}

/**
 * Shows the notifications the renderer asks for. Requests are accepted only from the app's own pages and
 * checked field by field. A click brings the asking window forward and tells it which notification it was,
 * so it can open the stock page.
 */
function handleNotifications(policy: NotificationPolicy): void {
  ipcMain.on(NOTIFY_CHANNEL, (event, payload: unknown) => {
    if (!isAppUrl(event.senderFrame?.url ?? '', APP_URL)) return;
    const request = parseNotification(payload);
    if (request === null || policy.appHasFocus()) return;
    const window = BrowserWindow.fromWebContents(event.sender);
    policy.present(request, () => {
      if (!window || window.isDestroyed()) return;
      if (window.isMinimized()) window.restore();
      window.focus();
      window.webContents.send(NOTIFICATION_CLICK_CHANNEL, { id: request.id, symbol: request.symbol });
    });
  });
}

/** What the smoke test reads from the renderer. */
interface RendererProbe {
  rootChildren: number;
  bridgePlatform: string | null;
}

const PROBE_SCRIPT = `({
  rootChildren: document.getElementById('root')?.childElementCount ?? 0,
  bridgePlatform: window.aperture?.platform ?? null,
})`;

/** Asks for one valid and one malformed notification, as the renderer would. */
const NOTIFY_SCRIPT = `(() => {
  window.aperture.notify({ id: 'smoke:valid', title: 'Smoke test', body: '', symbol: 'MSFT' });
  window.aperture.notify({ id: 'smoke:invalid', title: 'Smoke test', body: '', symbol: 'not a symbol' });
  return true;
})()`;

const POP_OUT_SCRIPT = `window.open(location.href.split('#')[0] + '#/window/symbol/AAPL', 'aperture-smoke', 'popup') !== null`;

const wait = (ms: number) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/**
 * `APERTURE_SMOKE_TEST=1` loads the app and checks that the UI rendered without console errors, the
 * preload bridge is present, a notification request makes the round trip (the malformed one is refused,
 * and clicking the valid one opens its stock page) and a pop-out opens as a second window. It exits with
 * 0 on success, so a script can prove a build works without a person watching.
 */
function runSmokeTest(window: BrowserWindow, presented: readonly DesktopNotification[]): void {
  const errors: string[] = [];
  window.webContents.on('console-message', (details) => {
    if (details.level === 'error') errors.push(details.message);
  });
  window.webContents.once('did-finish-load', () => {
    void (async () => {
      await wait(2000);
      const probe = (await window.webContents.executeJavaScript(PROBE_SCRIPT)) as RendererProbe;
      await window.webContents.executeJavaScript(NOTIFY_SCRIPT);
      await wait(500);
      const hash = (await window.webContents.executeJavaScript('location.hash')) as string;
      const opened = (await window.webContents.executeJavaScript(POP_OUT_SCRIPT, true)) as boolean;
      await wait(1500);
      const windows = BrowserWindow.getAllWindows().length;
      const failures = [
        probe.rootChildren > 0 ? null : 'the UI did not render',
        probe.bridgePlatform === process.platform ? null : 'the preload bridge is missing',
        presented.map((n) => n.id).join() === 'smoke:valid'
          ? null
          : `notifications presented: ${presented.map((n) => n.id).join() || 'none'}`,
        hash === '#/symbol/MSFT' ? null : `a notification click opened ${hash || 'nothing'}`,
        opened && windows === 2 ? null : `the pop-out did not open (${String(windows)} windows)`,
        ...errors.map((error) => `console error: ${error}`),
      ].filter((failure) => failure !== null);
      console.log(failures.length === 0 ? 'Smoke test passed.' : `Smoke test failed: ${failures.join('; ')}`);
      app.exit(failures.length === 0 ? 0 : 1);
    })();
  });
}

void app.whenReady().then(() => {
  hardenContents();
  if (process.env.APERTURE_SMOKE_TEST === '1') {
    // ** The smoke test records notifications and clicks them at once instead of showing them.
    const presented: DesktopNotification[] = [];
    handleNotifications({
      appHasFocus: () => false,
      present: (notification, onClick) => {
        presented.push(notification);
        onClick();
      },
    });
    runSmokeTest(createMainWindow(), presented);
  } else {
    app.setAppUserModelId(app.isPackaged ? APP_USER_MODEL_ID : process.execPath);
    handleNotifications({
      appHasFocus: () => BrowserWindow.getFocusedWindow() !== null,
      present: presentNative,
    });
    createMainWindow();
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
