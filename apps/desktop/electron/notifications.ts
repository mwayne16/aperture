import type { DesktopNotification } from './bridge';

const MAX_ID_LENGTH = 100;
const MAX_TITLE_LENGTH = 120;
const MAX_BODY_LENGTH = 300;
/** Symbols as the app writes them, e.g. "AAPL", "BRK.B" or "BTC/USD". */
const SYMBOL = /^[A-Z0-9][A-Z0-9./]{0,15}$/;

function text(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed.slice(0, max);
}

/**
 * Checks a notification request from the renderer. It crosses a process boundary, so every field is
 * checked: text is trimmed and capped, and a symbol must look like one. Returns null for anything else.
 */
export function parseNotification(payload: unknown): DesktopNotification | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const fields = payload as Record<string, unknown>;
  const id = text(fields.id, MAX_ID_LENGTH);
  const title = text(fields.title, MAX_TITLE_LENGTH);
  const body = text(fields.body, MAX_BODY_LENGTH) ?? '';
  const symbol =
    fields.symbol === null ? null : typeof fields.symbol === 'string' ? fields.symbol : undefined;
  if (id === null || title === null || symbol === undefined) return null;
  if (symbol !== null && !SYMBOL.test(symbol)) return null;
  return { id, title, body, symbol };
}
