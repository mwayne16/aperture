/** Inbox entries and the rules for keeping and storing them. */

const NOTIFICATION_KINDS = ['alert', 'connection'] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

export interface AppNotification {
  id: string;
  kind: NotificationKind;
  title: string;
  body: string;
  /** Epoch ms of the latest event the entry describes. */
  at: number;
  read: boolean;
  /** Symbol the notification is about, so the inbox can link to its page. */
  symbol: string | null;
}

/** Most notifications kept; older ones drop off the end. */
export const MAX_NOTIFICATIONS = 200;

const STORAGE_VERSION = 1;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNotification(value: unknown): value is AppNotification {
  if (!isRecord(value)) return false;
  const { id, kind, title, body, at, read, symbol } = value;
  return (
    typeof id === 'string' &&
    id !== '' &&
    (NOTIFICATION_KINDS as readonly unknown[]).includes(kind) &&
    typeof title === 'string' &&
    typeof body === 'string' &&
    typeof at === 'number' &&
    Number.isFinite(at) &&
    typeof read === 'boolean' &&
    (symbol === null || (typeof symbol === 'string' && symbol !== ''))
  );
}

/** Newest first, unique by id (the newest copy wins), at most MAX_NOTIFICATIONS. */
export function normalizeInbox(notifications: readonly AppNotification[]): AppNotification[] {
  const seen = new Set<string>();
  const kept: AppNotification[] = [];
  for (const n of [...notifications].sort((a, b) => b.at - a.at)) {
    if (seen.has(n.id)) continue;
    seen.add(n.id);
    kept.push(n);
    if (kept.length === MAX_NOTIFICATIONS) break;
  }
  return kept;
}

export function serializeInbox(notifications: readonly AppNotification[]): string {
  return JSON.stringify({ version: STORAGE_VERSION, notifications });
}

/**
 * The inbox from stored JSON. Entries that don't match the current shape are dropped one by one, and
 * unreadable JSON or an unknown version gives an empty inbox.
 */
export function parseStoredInbox(text: string | null): AppNotification[] {
  if (text === null) return [];
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return [];
  }
  if (!isRecord(raw) || raw.version !== STORAGE_VERSION || !Array.isArray(raw.notifications)) return [];
  const valid = (raw.notifications as unknown[]).filter(isNotification).map(
    // ** Copy only known fields, so stray stored properties never reach the UI.
    ({ id, kind, title, body, at, read, symbol }) => ({ id, kind, title, body, at, read, symbol }),
  );
  return normalizeInbox(valid);
}
