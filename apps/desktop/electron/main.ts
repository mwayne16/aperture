import { app, BrowserWindow, session, shell, type BrowserWindowConstructorOptions } from 'electron';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isAppUrl, isExternalWebUrl, isPopOutUrl } from './navigation';

/**
 * Electron main process: owns the windows and locks down what their pages may do. The renderer is a
 * plain web app with no Node access; it talks to the backend over HTTP and WebSocket and reaches the
 * desktop only through the small preload bridge.
 */

const DEV_RENDERER_URL = process.env.ELECTRON_RENDERER_URL;
const APP_URL = DEV_RENDERER_URL ?? pathToFileURL(fileURLToPath(new URL('../renderer/index.html', import.meta.url))).href;
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

/** What the smoke test reads from the renderer. */
interface RendererProbe {
  rootChildren: number;
  bridgePlatform: string | null;
}

const PROBE_SCRIPT = `({
  rootChildren: document.getElementById('root')?.childElementCount ?? 0,
  bridgePlatform: window.aperture?.platform ?? null,
})`;

const POP_OUT_SCRIPT = `window.open(location.href.split('#')[0] + '#/window/symbol/AAPL', 'aperture-smoke', 'popup') !== null`;

const wait = (ms: number) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/**
 * `APERTURE_SMOKE_TEST=1` loads the app and checks that the UI rendered without console errors, the
 * preload bridge is present and a pop-out opens as a second window. It exits with 0 on success, so a
 * script can prove a build works without a person watching.
 */
function runSmokeTest(window: BrowserWindow): void {
  const errors: string[] = [];
  window.webContents.on('console-message', (details) => {
    if (details.level === 'error') errors.push(details.message);
  });
  window.webContents.once('did-finish-load', () => {
    void (async () => {
      await wait(2000);
      const probe = (await window.webContents.executeJavaScript(PROBE_SCRIPT)) as RendererProbe;
      const opened = (await window.webContents.executeJavaScript(POP_OUT_SCRIPT, true)) as boolean;
      await wait(1500);
      const windows = BrowserWindow.getAllWindows().length;
      const failures = [
        probe.rootChildren > 0 ? null : 'the UI did not render',
        probe.bridgePlatform === process.platform ? null : 'the preload bridge is missing',
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
  const window = createMainWindow();
  if (process.env.APERTURE_SMOKE_TEST === '1') runSmokeTest(window);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
