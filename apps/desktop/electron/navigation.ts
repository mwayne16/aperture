/**
 * Where the app's windows may go. The renderer loads one document (the Vite dev server in development,
 * the bundled index.html in a packaged build) and routes with the URL hash, so anything outside that
 * document is either an external web page for the system browser or something to block.
 */

/** True when `url` is the app's own document, whatever its hash route. */
export function isAppUrl(url: string, appUrl: string): boolean {
  const target = parse(url);
  const app = parse(appUrl);
  if (!target || !app) return false;
  // ** File URLs have no meaningful origin, so the bundled app is matched by its exact file.
  if (app.protocol === 'file:') return target.protocol === 'file:' && target.pathname === app.pathname;
  return target.origin === app.origin && target.pathname === app.pathname;
}

/** True when `url` is a pop-out page of the app, which opens as its own native window. */
export function isPopOutUrl(url: string, appUrl: string): boolean {
  return isAppUrl(url, appUrl) && (parse(url)?.hash.startsWith('#/window/') ?? false);
}

/** True for web pages that belong in the system browser, such as a news article. */
export function isExternalWebUrl(url: string): boolean {
  const target = parse(url);
  return target?.protocol === 'https:' || target?.protocol === 'http:';
}

function parse(url: string): URL | null {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}
