import { describe, expect, it } from 'vitest';
import { ApiError } from '../../data/api';
import type { PriceAlert } from '../../domain/types';
import {
  armedAfterSave,
  createFormValues,
  editFormValues,
  errorsFromApi,
  parsePriceInput,
  toCreateInput,
  toUpdateInput,
  validateForm,
} from './alertForm';

const saved: PriceAlert = {
  id: 'a1',
  symbol: 'NVDA',
  condition: 'above',
  targetPrice: 1234.5,
  tag: 'buy',
  field: 'last',
  enabled: true,
  armed: false,
  note: 'Breakout',
  createdAt: '2026-10-30T13:00:00.000Z',
  updatedAt: '2026-10-30T13:00:00.000Z',
  lastTriggeredAt: null,
  lastTriggeredPrice: null,
  triggerCount: 0,
};

describe('parsePriceInput', () => {
  it('accepts plain, grouped, dollar-prefixed and partial decimals', () => {
    expect(parsePriceInput('200')).toBe(200);
    expect(parsePriceInput(' 1,234.50 ')).toBe(1234.5);
    expect(parsePriceInput('$12')).toBe(12);
    expect(parsePriceInput('.5')).toBe(0.5);
    expect(parsePriceInput('200.')).toBe(200);
  });

  it('returns NaN for blank or malformed text', () => {
    for (const text of ['', '  ', '.', 'abc', '12abc', '1,23', '-5', '1e3']) {
      expect(parsePriceInput(text), text).toBeNaN();
    }
  });
});

describe('validateForm', () => {
  it('passes a complete form', () => {
    expect(validateForm({ ...createFormValues('AAPL'), targetPrice: '200' })).toEqual({});
  });

  it('reports each invalid field with the shared rule messages', () => {
    const errors = validateForm({ ...createFormValues(null), symbol: 'TOOLONG1', note: 'x'.repeat(501) });
    expect(Object.keys(errors).sort()).toEqual(['note', 'symbol', 'targetPrice']);
    expect(errors.targetPrice).toBe('Enter a target price greater than 0.');
    expect(validateForm({ ...createFormValues(''), targetPrice: '1' }).symbol).toBe('Enter a symbol.');
  });
});

describe('toCreateInput', () => {
  it('normalizes the symbol, parses the price and drops a blank note', () => {
    expect(toCreateInput({ ...createFormValues(' brk.b '), targetPrice: '1,000', note: '   ' })).toEqual({
      symbol: 'BRK.B',
      condition: 'above',
      targetPrice: 1000,
      tag: 'buy',
      enabled: true,
      note: null,
    });
  });
});

describe('toUpdateInput', () => {
  it('is empty when nothing changed', () => {
    expect(toUpdateInput(saved, editFormValues(saved))).toEqual({});
  });

  it('sends only the changed fields, and null to clear the note', () => {
    expect(
      toUpdateInput(saved, { ...editFormValues(saved), targetPrice: '1,300', tag: 'sell', note: '' }),
    ).toEqual({ targetPrice: 1300, tag: 'sell', note: null });
    expect(toUpdateInput(saved, { ...editFormValues(saved), note: '  Breakout  ' })).toEqual({});
  });
});

describe('armedAfterSave', () => {
  it('is true for new alerts and alerts that are already armed', () => {
    expect(armedAfterSave(null, {})).toBe(true);
    expect(armedAfterSave({ ...saved, armed: true }, {})).toBe(true);
  });

  it('is true for a fired alert only when the edit re-arms it', () => {
    expect(armedAfterSave(saved, { note: 'x', tag: 'sell' })).toBe(false);
    expect(armedAfterSave(saved, { targetPrice: 1 })).toBe(true);
    expect(armedAfterSave(saved, { condition: 'below' })).toBe(true);
    expect(armedAfterSave({ ...saved, enabled: false }, { enabled: true })).toBe(true);
  });
});

describe('errorsFromApi', () => {
  it('maps details to form fields by the first path segment', () => {
    const error = new ApiError('VALIDATION_ERROR', 'Bad', 400, [
      { field: 'targetPrice', message: 'Too high.' },
      { field: 'note.0', message: 'Too long.' },
    ]);
    expect(errorsFromApi(error)).toEqual({
      fields: { targetPrice: 'Too high.', note: 'Too long.' },
      form: null,
    });
  });

  it('collects details without a form field into one message', () => {
    const error = new ApiError('VALIDATION_ERROR', 'Bad', 400, [{ field: 'limit', message: 'Bad limit.' }]);
    expect(errorsFromApi(error)).toEqual({ fields: {}, form: 'Bad limit.' });
  });

  it('uses the error message when there are no details', () => {
    expect(errorsFromApi(new ApiError('UNAVAILABLE', 'Try again.', 503))).toEqual({
      fields: {},
      form: 'Try again.',
    });
  });
});
