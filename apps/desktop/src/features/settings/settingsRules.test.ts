import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, isChartRange, parseStoredSettings, validPatch } from './settingsRules';

describe('parseStoredSettings', () => {
  it('gives the defaults when nothing is stored or the JSON is unreadable', () => {
    expect(parseStoredSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(parseStoredSettings('{not json')).toEqual(DEFAULT_SETTINGS);
    expect(parseStoredSettings('')).toEqual(DEFAULT_SETTINGS);
  });

  it('gives the defaults for JSON that is not an object', () => {
    for (const text of ['null', '42', '"1W"', '[]', 'true']) {
      expect(parseStoredSettings(text), text).toEqual(DEFAULT_SETTINGS);
    }
  });

  it('keeps valid fields and replaces each invalid one with its default', () => {
    const stored = JSON.stringify({ defaultChartRange: '5Y', chartStyle: 'bars', triggerToasts: 'no' });
    expect(parseStoredSettings(stored)).toEqual({ ...DEFAULT_SETTINGS, defaultChartRange: '5Y' });
  });

  it('reads a complete stored copy and ignores unknown keys', () => {
    const stored = JSON.stringify({
      defaultChartRange: 'YTD',
      chartStyle: 'line',
      triggerToasts: false,
      desktopNotifications: false,
      theme: 'x',
    });
    expect(parseStoredSettings(stored)).toEqual({
      defaultChartRange: 'YTD',
      chartStyle: 'line',
      triggerToasts: false,
      desktopNotifications: false,
    });
  });

  it('returns a fresh object, never the shared defaults', () => {
    const settings = parseStoredSettings(null);
    expect(settings).not.toBe(DEFAULT_SETTINGS);
    expect(Object.isFrozen(DEFAULT_SETTINGS)).toBe(true);
  });

  it('does not read inherited properties as settings', () => {
    expect(parseStoredSettings('{"__proto__":{"chartStyle":"line"}}').chartStyle).toBe('candles');
  });
});

describe('validPatch', () => {
  it('drops unknown keys and invalid values', () => {
    expect(
      validPatch({ chartStyle: 'line', defaultChartRange: '2D', triggerToasts: 1, extra: true }),
    ).toEqual({
      chartStyle: 'line',
    });
    expect(validPatch(null)).toEqual({});
    expect(validPatch(['line'])).toEqual({});
  });

  it('keeps false, which is a real value for a switch', () => {
    expect(validPatch({ triggerToasts: false })).toEqual({ triggerToasts: false });
  });
});

describe('isChartRange', () => {
  it('accepts only the supported ranges', () => {
    expect(isChartRange('1D')).toBe(true);
    expect(isChartRange('ALL')).toBe(true);
    expect(isChartRange('1d')).toBe(false);
    expect(isChartRange(undefined)).toBe(false);
  });
});
