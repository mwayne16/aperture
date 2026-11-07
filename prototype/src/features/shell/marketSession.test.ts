import { describe, expect, it } from 'vitest';
import { marketSession } from './marketSession';

const at = (iso: string) => Date.parse(iso);

describe('marketSession', () => {
  it('walks a weekday through every session in daylight time (EDT, UTC-4)', () => {
    expect(marketSession(at('2026-10-28T03:59:59-04:00'))).toBe('closed');
    expect(marketSession(at('2026-10-28T04:00:00-04:00'))).toBe('pre-market');
    expect(marketSession(at('2026-10-28T09:29:59-04:00'))).toBe('pre-market');
    expect(marketSession(at('2026-10-28T09:30:00-04:00'))).toBe('open');
    expect(marketSession(at('2026-10-28T15:59:59-04:00'))).toBe('open');
    expect(marketSession(at('2026-10-28T16:00:00-04:00'))).toBe('after-hours');
    expect(marketSession(at('2026-10-28T19:59:59-04:00'))).toBe('after-hours');
    expect(marketSession(at('2026-10-28T20:00:00-04:00'))).toBe('closed');
  });

  it('uses New York time in standard time (EST, UTC-5)', () => {
    // 14:29Z is 09:29 EST: still pre-market, though it would be open under EDT.
    expect(marketSession(at('2026-12-02T14:29:00Z'))).toBe('pre-market');
    expect(marketSession(at('2026-12-02T14:30:00Z'))).toBe('open');
    expect(marketSession(at('2026-12-02T21:00:00Z'))).toBe('after-hours');
  });

  it('follows the daylight-saving switch on the first trading day after it', () => {
    // DST starts Sunday 2026-03-08 and ends Sunday 2026-11-01.
    expect(marketSession(at('2026-03-09T13:30:00Z'))).toBe('open');
    expect(marketSession(at('2026-11-02T13:30:00Z'))).toBe('pre-market');
    expect(marketSession(at('2026-11-02T14:30:00Z'))).toBe('open');
  });

  it('is closed all weekend, judged by the New York day rather than the UTC day', () => {
    expect(marketSession(at('2026-10-31T12:00:00-04:00'))).toBe('closed');
    expect(marketSession(at('2026-11-01T12:00:00-05:00'))).toBe('closed');
    // Friday 19:30 EST is already Saturday in UTC, and still after hours in New York.
    expect(marketSession(at('2026-11-06T19:30:00-05:00'))).toBe('after-hours');
    // Sunday 23:30 ET is Monday in UTC, and still the weekend in New York.
    expect(marketSession(at('2026-11-01T23:30:00-05:00'))).toBe('closed');
  });

  it('treats an unusable timestamp as closed', () => {
    expect(marketSession(Number.NaN)).toBe('closed');
  });
});
