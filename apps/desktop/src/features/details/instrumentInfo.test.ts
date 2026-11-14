import { describe, expect, it } from 'vitest';
import { assetClassLabel, dataSourceNote, sessionNow, tradingHours } from './instrumentInfo';

// Wednesday Nov 4, 2026 in New York (EST, UTC-5).
const at = (hour: number, minute = 0) => Date.UTC(2026, 10, 4, hour + 5, minute);
const SATURDAY_NOON = Date.UTC(2026, 10, 7, 17);

describe('assetClassLabel', () => {
  it('names each asset class', () => {
    expect(assetClassLabel('stock')).toBe('Stock');
    expect(assetClassLabel('etf')).toBe('ETF');
    expect(assetClassLabel('crypto')).toBe('Crypto');
  });
});

describe('tradingHours', () => {
  it('is around the clock for crypto and the regular session otherwise', () => {
    expect(tradingHours('crypto')).toBe('24/7, every day');
    expect(tradingHours('stock')).toBe('9:30–16:00 ET, Monday to Friday');
    expect(tradingHours('etf')).toBe(tradingHours('stock'));
  });
});

describe('sessionNow', () => {
  it('follows the US session for stocks and ETFs', () => {
    expect(sessionNow('stock', at(10))).toEqual({ label: 'Open', open: true });
    expect(sessionNow('etf', at(8))).toEqual({ label: 'Pre-market', open: false });
    expect(sessionNow('stock', at(17))).toEqual({ label: 'After hours', open: false });
    expect(sessionNow('stock', SATURDAY_NOON)).toEqual({ label: 'Closed', open: false });
  });

  it('keeps crypto open at night and on weekends', () => {
    expect(sessionNow('crypto', at(23))).toEqual({ label: 'Open', open: true });
    expect(sessionNow('crypto', SATURDAY_NOON)).toEqual({ label: 'Open', open: true });
  });
});

describe('dataSourceNote', () => {
  it('says the data is simulated in the prototype and names the future feed', () => {
    expect(dataSourceNote(true)).toMatch(/^Simulated/);
    expect(dataSourceNote(true)).toContain('Alpaca IEX');
  });

  it('is honest about the IEX feed: one exchange, IEX-only volume', () => {
    expect(dataSourceNote(false)).toContain('IEX-only volume');
  });
});
