import type { MarketSession } from '../shell/marketSession';

/** Wording for the dashboard header: a greeting by local time and a sentence on the US session. */

const MARKET_TIME_ZONE = 'America/New_York';

/** "Good morning" from 05:00, "Good afternoon" from 12:00, "Good evening" from 18:00 until 05:00, local time. */
export function greetingFor(date: Date): string {
  const hour = date.getHours();
  if (hour >= 5 && hour < 12) return 'Good morning';
  if (hour >= 12 && hour < 18) return 'Good afternoon';
  return 'Good evening';
}

export interface SessionView {
  label: string;
  tone: 'gain' | 'warning' | 'muted';
  /** The dot pulses only while regular trading is live. */
  pulse: boolean;
  detail: string;
}

const SESSION_VIEWS: Readonly<Record<MarketSession, SessionView>> = {
  open: {
    label: 'Market open',
    tone: 'gain',
    pulse: true,
    detail: 'US stock markets are open until 16:00 ET.',
  },
  'pre-market': {
    label: 'Pre-market',
    tone: 'warning',
    pulse: false,
    detail: 'Regular trading opens at 09:30 ET.',
  },
  'after-hours': {
    label: 'After hours',
    tone: 'warning',
    pulse: false,
    detail: 'Regular trading closed at 16:00 ET. After-hours trading runs until 20:00 ET.',
  },
  closed: {
    label: 'Market closed',
    tone: 'muted',
    pulse: false,
    detail: 'US stock markets are closed. Crypto trades around the clock.',
  },
};

export function sessionView(session: MarketSession): SessionView {
  return SESSION_VIEWS[session];
}

const MARKET_DATE = new Intl.DateTimeFormat('en-US', {
  weekday: 'long',
  month: 'long',
  day: 'numeric',
  timeZone: MARKET_TIME_ZONE,
});

/** The New York calendar date, e.g. "Saturday, November 7", or "" for an invalid time. */
export function formatMarketDate(epochMs: number): string {
  const date = new Date(epochMs);
  return Number.isNaN(date.getTime()) ? '' : MARKET_DATE.format(date);
}
