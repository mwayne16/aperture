import { describe, expect, it } from 'vitest';
import { evaluateAlert } from './alertEngine.js';
import type { AlertCondition, PriceAlert } from './alerts.js';

/**
 * Round-4 adversarial tests for evaluateAlert. The implementation treats persisted alerts as untyped at
 * runtime, so a corrupt `armed` flag must still produce a real boolean result, as AlertEvaluation
 * declares. A caller writing `armed` back to storage would otherwise persist `undefined`.
 */

type AlertState = Pick<PriceAlert, 'enabled' | 'armed' | 'condition' | 'targetPrice'>;

const CORRUPT_ARMED: unknown[] = [undefined, null, 0, 1, '', 'false', 'true'];
const CONDITIONS: AlertCondition[] = ['above', 'below'];

function alert(condition: AlertCondition, armed: unknown, enabled = true): AlertState {
  return { enabled, armed: armed as boolean, condition, targetPrice: 100 };
}

describe('evaluateAlert with a corrupt persisted armed flag', () => {
  it.each(CORRUPT_ARMED)('returns boolean triggered and armed for armed=%j', (armed) => {
    for (const condition of CONDITIONS) {
      for (const price of [100, 50, 150]) {
        const result = evaluateAlert(alert(condition, armed), price);
        expect(typeof result.triggered, `${condition} @ ${price}`).toBe('boolean');
        expect(typeof result.armed, `${condition} @ ${price}`).toBe('boolean');
        expect(typeof result.satisfied, `${condition} @ ${price}`).toBe('boolean');
      }
    }
  });

  it('a satisfying price fires only when armed is exactly true', () => {
    expect(evaluateAlert(alert('above', true), 100).triggered).toBe(true);
    expect(evaluateAlert(alert('above', false), 100).triggered).toBe(false);
  });
});

describe('evaluateAlert state machine: edits and re-enables start armed', () => {
  it('re-enabling with armed=true while satisfied fires on the next price', () => {
    // A disabled alert keeps its flag; the caller re-arms on re-enable per the spec.
    const disabled = evaluateAlert(alert('below', false, false), 90);
    expect(disabled).toEqual({ satisfied: true, triggered: false, armed: false });
    const reEnabled = evaluateAlert(alert('below', true, true), 90);
    expect(reEnabled).toEqual({ satisfied: true, triggered: true, armed: false });
  });

  it('a disabled alert never changes armed for any finite price sequence', () => {
    for (const armed of [true, false]) {
      let state = armed;
      for (const price of [10, 100, 1000, 100, 99.99, 100.01]) {
        const r = evaluateAlert(alert('above', state, false), price);
        expect(r.triggered).toBe(false);
        expect(r.armed).toBe(armed);
        state = r.armed;
      }
    }
  });
});
