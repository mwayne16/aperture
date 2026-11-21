import type { DesktopBridge } from '../../electron/bridge';

declare global {
  interface Window {
    /** Set by the Electron preload script; absent when the app runs in a plain browser. */
    aperture?: DesktopBridge;
  }
}

/** The desktop bridge when the app runs in Electron, or null in a browser. */
export function desktopBridge(): DesktopBridge | null {
  return window.aperture ?? null;
}
