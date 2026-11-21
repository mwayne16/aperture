import { describe, expect, it } from 'vitest';
import { parseNotification } from './notifications';

const VALID = {
  id: 'alert:evt_1',
  title: 'AAPL above 200.00 · Buy',
  body: 'Last trade 201.00 at 10:01 ET',
  symbol: 'AAPL',
};

describe('parseNotification', () => {
  it('accepts a well-formed request, trimming its text', () => {
    expect(parseNotification({ ...VALID, title: '  AAPL above 200.00 · Buy  ' })).toEqual(VALID);
    expect(parseNotification({ ...VALID, symbol: 'BTC/USD' })?.symbol).toBe('BTC/USD');
    expect(parseNotification({ ...VALID, symbol: null })?.symbol).toBeNull();
    expect(parseNotification({ ...VALID, body: undefined })?.body).toBe('');
  });

  it('caps long text', () => {
    const parsed = parseNotification({ ...VALID, title: 'x'.repeat(500), body: 'y'.repeat(500) });
    expect([parsed?.title.length, parsed?.body.length]).toEqual([120, 300]);
  });

  it.each([
    ['not an object', 'hello'],
    ['null', null],
    ['no id', { ...VALID, id: undefined }],
    ['a blank title', { ...VALID, title: '   ' }],
    ['a missing symbol field', { ...VALID, symbol: undefined }],
    ['a symbol that is not one', { ...VALID, symbol: 'javascript:alert(1)' }],
    ['a lower-case symbol', { ...VALID, symbol: 'aapl' }],
    ['a numeric title', { ...VALID, title: 42 }],
  ])('rejects %s', (_case, payload) => {
    expect(parseNotification(payload)).toBeNull();
  });
});
