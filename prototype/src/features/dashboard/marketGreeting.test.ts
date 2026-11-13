import { describe, expect, it } from 'vitest';
import { formatMarketDate, greetingFor, sessionView } from './marketGreeting';

function localTime(hour: number, minute = 0): Date {
  return new Date(2026, 10, 9, hour, minute);
}

describe('greetingFor', () => {
  it('greets by local hour, switching at 05:00, 12:00 and 18:00', () => {
    expect(greetingFor(localTime(4, 59))).toBe('Good evening');
    expect(greetingFor(localTime(5))).toBe('Good morning');
    expect(greetingFor(localTime(11, 59))).toBe('Good morning');
    expect(greetingFor(localTime(12))).toBe('Good afternoon');
    expect(greetingFor(localTime(17, 59))).toBe('Good afternoon');
    expect(greetingFor(localTime(18))).toBe('Good evening');
    expect(greetingFor(localTime(0))).toBe('Good evening');
  });
});

describe('sessionView', () => {
  it('labels each session and pulses only while the market is open', () => {
    expect(sessionView('open')).toMatchObject({ label: 'Market open', tone: 'gain', pulse: true });
    expect(sessionView('pre-market')).toMatchObject({ label: 'Pre-market', tone: 'warning', pulse: false });
    expect(sessionView('after-hours')).toMatchObject({ label: 'After hours', tone: 'warning', pulse: false });
    expect(sessionView('closed')).toMatchObject({ label: 'Market closed', tone: 'muted', pulse: false });
  });

  it('reminds that crypto keeps trading while stocks are closed', () => {
    expect(sessionView('closed').detail).toContain('Crypto trades around the clock');
  });
});

describe('formatMarketDate', () => {
  it('uses the New York calendar date', () => {
    // 03:30 UTC on Nov 10 is still the evening of Nov 9 in New York.
    expect(formatMarketDate(Date.UTC(2026, 10, 10, 3, 30))).toBe('Monday, November 9');
  });

  it('returns an empty string for an invalid time', () => {
    expect(formatMarketDate(Number.NaN)).toBe('');
  });
});
