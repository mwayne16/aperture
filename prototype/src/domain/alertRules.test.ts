import { describe, expect, it } from 'vitest';
import { MAX_TARGET_PRICE, NOTE_MAX_LENGTH, validateAlertFields } from './alertRules';

const valid = { symbol: 'AAPL', condition: 'above', targetPrice: 200, tag: 'buy' } as const;

function fields(input: Parameters<typeof validateAlertFields>[0], mode: 'create' | 'update' = 'create') {
  return validateAlertFields(input, mode).map((error) => error.field);
}

describe('validateAlertFields', () => {
  it('accepts a complete alert', () => {
    expect(validateAlertFields(valid, 'create')).toEqual([]);
  });

  it('on create, reports every missing required field in form order', () => {
    expect(fields({})).toEqual(['symbol', 'condition', 'targetPrice', 'tag']);
  });

  it('on update, checks only the fields that are present', () => {
    expect(fields({}, 'update')).toEqual([]);
    expect(fields({ targetPrice: 0 }, 'update')).toEqual(['targetPrice']);
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY, '200'])('rejects target price %s', (targetPrice) => {
    expect(fields({ ...valid, targetPrice })).toEqual(['targetPrice']);
  });

  it('allows a target price up to the maximum', () => {
    expect(fields({ ...valid, targetPrice: MAX_TARGET_PRICE })).toEqual([]);
    expect(validateAlertFields({ ...valid, targetPrice: MAX_TARGET_PRICE + 0.01 }, 'create')[0]?.message).toBe(
      `Target price must be ${MAX_TARGET_PRICE} or less.`,
    );
  });

  it('measures the note after trimming, and allows a null note', () => {
    expect(fields({ ...valid, note: ` ${'x'.repeat(NOTE_MAX_LENGTH)} ` })).toEqual([]);
    expect(fields({ ...valid, note: 'x'.repeat(NOTE_MAX_LENGTH + 1) })).toEqual(['note']);
    expect(fields({ ...valid, note: null })).toEqual([]);
  });

  it('uses the symbol rules for the symbol message', () => {
    expect(validateAlertFields({ ...valid, symbol: 'TOOLONG' }, 'create')[0]?.message).toBe(
      'Use 1-5 letters with an optional class like ".B", or a pair like "BTC/USD".',
    );
  });
});
