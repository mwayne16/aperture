/**
 * Opens an app page in its own window. In the browser this is a popup; the desktop app will turn the
 * same request into a native window.
 */

const POPUP_FEATURES = 'popup,width=1280,height=860';

/**
 * The address of `path` (a router path such as "/symbol/AAPL") in this app: the current document
 * with the hash replaced, so it also works when the app is loaded from a local file.
 */
export function popOutUrl(path: string, currentHref: string): string {
  const hashAt = currentHref.indexOf('#');
  const document = hashAt === -1 ? currentHref : currentHref.slice(0, hashAt);
  return `${document}#${path}`;
}

/** Window name for `path`, so popping out the same page again reuses its window. */
export function popOutWindowName(path: string): string {
  return `aperture${path.replace(/[^A-Za-z0-9]+/g, '-')}`;
}

/** Opens `path` in a separate window. False when the browser blocked it. */
export function openPopOut(path: string): boolean {
  const opened = window.open(popOutUrl(path, window.location.href), popOutWindowName(path), POPUP_FEATURES);
  if (!opened) return false;
  opened.focus();
  return true;
}
