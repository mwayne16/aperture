import { describe, expect, it } from 'vitest';
import { evaluateAlert, isConditionMet } from './alertEngine.js';
import type { AlertCondition, PriceAlert } from './alerts.js';

/**
 * Round-2 adversarial tests for alertEngine, derived from the doc-comment spec:
 * exhaustive truth table, signed zero, extreme finite magnitudes, and corrupt persisted data.
 */

type AlertState = Pick<PriceAlert, 'enabled' | 'armed' | 'condition' | 'targetPrice'>;

const CONDITIONS: AlertCondition[] = ['above', 'below'];

describe('isConditionMet contract (round 2)', () => {
  it('signed zero: -0 and 0 are equal, so both conditions are satisfied', () => {
    for (const c of CONDITIONS) {
      expect(isConditionMet(c, -0, 0)).toBe(true);
      expect(isConditionMet(c, 0, -0)).toBe(true);
    }
  });

  it('extreme finite magnitudes are compared normally (not treated as non-finite)', () => {
    expect(isConditionMet('above', Number.MAX_VALUE, Number.MAX_VALUE)).toBe(true);
    expect(isConditionMet('below', -Number.MAX_VALUE, 0)).toBe(true);
    expect(isConditionMet('above', Number.MIN_VALUE, 0)).toBe(true);
    expect(isConditionMet('below', Number.MIN_VALUE, 0)).toBe(false);
    expect(isConditionMet('above', 100 + 1e-12, 100)).toBe(true);
    expect(isConditionMet('below', 100 + 1e-12, 100)).toBe(false);
  });

  it('works for negative targets', () => {
    expect(isConditionMet('above', -1, -2)).toBe(true);
    expect(isConditionMet('below', -3, -2)).toBe(true);
    expect(isConditionMet('above', -3, -2)).toBe(false);
  });

  // The declared return type is boolean, and the doc says corrupt input "can never match".
  // Persisted alerts are untyped at runtime; a corrupt condition must not produce `undefined`.
  it.each(['ABOVE', 'sideways', '', 'toString'])(
    'returns false (a real boolean) for a corrupt persisted condition %j',
    (condition) => {
      const result = isConditionMet(condition as AlertCondition, 10, 10);
      expect(typeof result).toBe('boolean');
      expect(result).toBe(false);
    },
  );
});

describe('evaluateAlert contract (round 2)', () => {
  it('a corrupt condition never fires and reports satisfied as the boolean false', () => {
    for (const armed of [true, false]) {
      const result = evaluateAlert(
        { enabled: true, armed, condition: 'sideways' as AlertCondition, targetPrice: 10 },
        10,
      );
      expect(typeof result.satisfied).toBe('boolean');
      expect(result.satisfied).toBe(false);
      expect(result.triggered).toBe(false);
      expect(typeof result.armed).toBe('boolean');
    }
  });

  it('exhaustive truth table over enabled x armed x condition x price position', () => {
    const target = 50;
    const prices: { price: number; side: 'lt' | 'eq' | 'gt' | 'ignored' }[] = [
      { price: 49.99, side: 'lt' },
      { price: 50, side: 'eq' },
      { price: 50.01, side: 'gt' },
      { price: Number.NaN, side: 'ignored' },
      { price: Number.POSITIVE_INFINITY, side: 'ignored' },
      { price: Number.NEGATIVE_INFINITY, side: 'ignored' },
    ];
    for (const enabled of [true, false]) {
      for (const armed of [true, false]) {
        for (const condition of CONDITIONS) {
          for (const { price, side } of prices) {
            const state: AlertState = { enabled, armed, condition, targetPrice: target };
            const satisfied =
              side === 'ignored'
                ? false
                : side === 'eq' || (condition === 'above' ? side === 'gt' : side === 'lt');
            let expected: { satisfied: boolean; triggered: boolean; armed: boolean };
            if (side === 'ignored') expected = { satisfied: false, triggered: false, armed };
            else if (!enabled) expected = { satisfied, triggered: false, armed };
            else if (!satisfied) expected = { satisfied, triggered: false, armed: true };
            else if (armed) expected = { satisfied, triggered: true, armed: false };
            else expected = { satisfied, triggered: false, armed: false };
            expect(evaluateAlert(state, price), JSON.stringify({ state, price })).toEqual(expected);
          }
        }
      }
    }
  });

  it('price sitting exactly at the target fires once, then stays quiet', () => {
    for (const condition of CONDITIONS) {
      let state: AlertState = { enabled: true, armed: true, condition, targetPrice: 7 };
      let fires = 0;
      for (let i = 0; i < 20; i++) {
        const r = evaluateAlert(state, 7);
        if (r.triggered) fires++;
        state = { ...state, armed: r.armed };
      }
      expect(fires).toBe(1);
      expect(state.armed).toBe(false);
    }
  });

  it('a disabled period does not re-arm, even when the price leaves the condition meanwhile', () => {
    let state: AlertState = { enabled: true, armed: true, condition: 'above', targetPrice: 100 };
    const step = (price: number): boolean => {
      const r = evaluateAlert(state, price);
      state = { ...state, armed: r.armed };
      return r.triggered;
    };
    expect(step(101)).toBe(true);
    state = { ...state, enabled: false };
    expect(step(90)).toBe(false); // would re-arm if enabled; disabled leaves armed unchanged
    expect(state.armed).toBe(false);
    state = { ...state, enabled: true }; // caller did NOT re-arm on enable here
    expect(step(105)).toBe(false);
    expect(step(95)).toBe(false);
    expect(state.armed).toBe(true);
    expect(step(100)).toBe(true);
  });
});
