import { afterEach, describe, expect, it, vi } from 'vitest';
import { formatClock, formatDateTime } from './format';

/**
 * Round-6 adversarial tests. formatDateTime defaults to the local zone, which is whatever the system
 * zone is at call time. A desktop app stays open while the user travels or changes the OS zone, so
 * the output must follow the current zone rather than the one seen on the first call.
 */

const ISO = '2026-10-23T18:05:09.000Z';

/** Reference output built from a fresh formatter in the current local zone. */
function freshLocal(iso: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(iso));
  const get = (type: Intl.DateTimeFormatPartTypes): string => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('month')} ${get('day')}, ${get('hour')}:${get('minute')}:${get('second')}`;
}

describe('formatDateTime follows a change of the local time zone', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('fixture sanity: changing TZ changes the runtime local zone', () => {
    vi.stubEnv('TZ', 'UTC');
    expect(new Date(ISO).getHours()).toBe(18);
    vi.stubEnv('TZ', 'Asia/Tokyo');
    expect(new Date(ISO).getHours()).toBe(3);
  });

  it('uses the new zone after the system zone changes', () => {
    vi.stubEnv('TZ', 'UTC');
    expect(formatDateTime(ISO)).toBe('Oct 23, 18:05:09');
    vi.stubEnv('TZ', 'Asia/Tokyo');
    expect(formatDateTime(ISO)).toBe('Oct 24, 03:05:09');
    vi.stubEnv('TZ', 'America/Los_Angeles');
    expect(formatDateTime(ISO)).toBe('Oct 23, 11:05:09');
  });

  it('matches a fresh local formatter and the Date local fields after each change', () => {
    for (const tz of ['UTC', 'Europe/Berlin', 'Asia/Kolkata', 'America/New_York', 'Pacific/Auckland']) {
      vi.stubEnv('TZ', tz);
      const out = formatDateTime(ISO);
      expect(out, tz).toBe(freshLocal(ISO));
      // ** Half-hour zones such as Asia/Kolkata shift the minutes too, so read both from the local Date.
      const local = new Date(ISO);
      const pad = (n: number) => String(n).padStart(2, '0');
      expect(out.endsWith(`${pad(local.getHours())}:${pad(local.getMinutes())}:09`), tz).toBe(true);
    }
  });

  it('a no-offset ISO string and its rendering agree on the same local zone', () => {
    vi.stubEnv('TZ', 'UTC');
    formatDateTime(ISO);
    vi.stubEnv('TZ', 'Asia/Tokyo');
    // Parsed as Tokyo local time, so it must render back as the same wall-clock time.
    expect(formatDateTime('2026-10-23T14:05:09')).toBe('Oct 23, 14:05:09');
  });

  it('explicit zones and the New York clock are unaffected by the system zone', () => {
    vi.stubEnv('TZ', 'Asia/Tokyo');
    expect(formatDateTime(ISO, 'UTC')).toBe('Oct 23, 18:05:09');
    expect(formatClock(Date.parse(ISO))).toBe('14:05:09');
    vi.stubEnv('TZ', 'UTC');
    expect(formatDateTime(ISO, 'Asia/Tokyo')).toBe('Oct 24, 03:05:09');
    expect(formatClock(Date.parse(ISO))).toBe('14:05:09');
  });
});
