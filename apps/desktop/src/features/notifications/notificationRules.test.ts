import { describe, expect, it } from 'vitest';
import {
  MAX_NOTIFICATIONS,
  normalizeInbox,
  parseStoredInbox,
  serializeInbox,
  type AppNotification,
} from './notificationRules';

function entry(id: string, at: number, patch: Partial<AppNotification> = {}): AppNotification {
  return { id, kind: 'alert', title: `Title ${id}`, body: 'Body', at, read: false, symbol: 'AAPL', ...patch };
}

describe('normalizeInbox', () => {
  it('sorts newest first and keeps the newest copy of a repeated id', () => {
    const list = normalizeInbox([entry('a', 1), entry('b', 3), entry('a', 5, { title: 'newer' })]);
    expect(list.map((n) => [n.id, n.at])).toEqual([
      ['a', 5],
      ['b', 3],
    ]);
    expect(list[0]?.title).toBe('newer');
  });

  it('caps the inbox, dropping the oldest entries', () => {
    const many = Array.from({ length: MAX_NOTIFICATIONS + 5 }, (_, i) => entry(`n${i}`, i));
    const list = normalizeInbox(many);
    expect(list).toHaveLength(MAX_NOTIFICATIONS);
    expect(list[0]?.id).toBe(`n${MAX_NOTIFICATIONS + 4}`);
    expect(list.at(-1)?.id).toBe('n5');
  });
});

describe('parseStoredInbox', () => {
  it('round-trips what serializeInbox writes', () => {
    const inbox = [entry('b', 2, { read: true }), entry('a', 1, { kind: 'connection', symbol: null })];
    expect(parseStoredInbox(serializeInbox(inbox))).toEqual(inbox);
  });

  it('gives an empty inbox for missing, unreadable or unknown data', () => {
    for (const text of [null, '', '{', 'null', '[]', '{"version":2,"notifications":[]}', '{"version":1}']) {
      expect(parseStoredInbox(text), String(text)).toEqual([]);
    }
  });

  it('drops malformed entries one by one and keeps the rest', () => {
    const valid = entry('ok', 10);
    const text = JSON.stringify({
      version: 1,
      notifications: [
        valid,
        { ...valid, id: '' },
        { ...valid, id: 'kind', kind: 'system' },
        { ...valid, id: 'at', at: 'yesterday' },
        { ...valid, id: 'nan', at: null },
        { ...valid, id: 'read', read: 'no' },
        { ...valid, id: 'symbol', symbol: 42 },
        { ...valid, id: 'blank-symbol', symbol: '' },
        { ...valid, id: 'title', title: undefined },
        'not an object',
        null,
      ],
    });
    expect(parseStoredInbox(text)).toEqual([valid]);
  });

  it('copies only known fields', () => {
    const text = JSON.stringify({ version: 1, notifications: [{ ...entry('a', 1), html: '<b>x</b>' }] });
    expect(parseStoredInbox(text)[0]).toEqual(entry('a', 1));
  });

  it('applies the cap and order to stored data too', () => {
    const many = Array.from({ length: MAX_NOTIFICATIONS + 1 }, (_, i) => entry(`n${i}`, i));
    const list = parseStoredInbox(serializeInbox(many));
    expect(list).toHaveLength(MAX_NOTIFICATIONS);
    expect(list[0]?.id).toBe(`n${MAX_NOTIFICATIONS}`);
  });
});
