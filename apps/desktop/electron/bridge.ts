/**
 * The only desktop capabilities the renderer can reach, exposed as `window.aperture` by the preload
 * script. Keep it small: market data and app state go through the backend's HTTP and WebSocket API.
 */
export interface DesktopBridge {
  /** Operating system, e.g. "win32", for platform-specific labels. */
  platform: string;
  /** Runtime versions shown in Settings → About. */
  versions: { electron: string; chrome: string };
}
