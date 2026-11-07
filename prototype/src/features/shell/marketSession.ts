import dayjs from 'dayjs';
import timezone from 'dayjs/plugin/timezone';
import utc from 'dayjs/plugin/utc';

dayjs.extend(utc);
dayjs.extend(timezone);

const MARKET_TIME_ZONE = 'America/New_York';

export type MarketSession = 'pre-market' | 'open' | 'after-hours' | 'closed';

export const MARKET_SESSION_LABELS: Readonly<Record<MarketSession, string>> = {
  'pre-market': 'Pre-market',
  open: 'Open',
  'after-hours': 'After hours',
  closed: 'Closed',
};

const PRE_MARKET_START = 4 * 60;
const REGULAR_START = 9 * 60 + 30;
const REGULAR_END = 16 * 60;
const AFTER_HOURS_END = 20 * 60;

/**
 * US equity trading session at `epochMs`, read from New York wall-clock time so daylight saving is
 * handled: pre-market 04:00-09:30, open 09:30-16:00, after hours 16:00-20:00, and closed otherwise
 * and all weekend. Each window includes its start minute and excludes its end.
 *
 * Exchange holidays and early closes are not modeled, so on those days this reports a normal weekday.
 */
export function marketSession(epochMs: number): MarketSession {
  if (!Number.isFinite(epochMs)) return 'closed';
  const newYork = dayjs(epochMs).tz(MARKET_TIME_ZONE);
  const weekday = newYork.day();
  if (weekday === 0 || weekday === 6) return 'closed';
  const minute = newYork.hour() * 60 + newYork.minute();
  if (minute < PRE_MARKET_START) return 'closed';
  if (minute < REGULAR_START) return 'pre-market';
  if (minute < REGULAR_END) return 'open';
  if (minute < AFTER_HOURS_END) return 'after-hours';
  return 'closed';
}
