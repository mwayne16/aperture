import { describe, expect, it } from 'vitest';
import { evaluateAlert, isConditionMet } from './alertEngine.js';
import type { AlertCondition, PriceAlert } from './alerts.js';

/**
 * Adversarial tests derived from the alertEngine doc-comment spec, written independently of the
 * implementation. The reference model below is a literal transcription of the spec bullets.
 */

type AlertState = Pick<PriceAlert, 'enabled' | 'armed' | 'condition' | 'targetPrice'>;

const CONDITIONS: AlertCondition[] = ['above', 'below'];
const NON_FINITE = [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY];

/** xorshift32, a different PRNG from the builder's tests so the sequences differ. */
function xorshift(seed: number): () => number {
  let x = seed >>> 0 || 1;
  return () => {
    x ^= x << 13;
    x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5;
    x >>>= 0;
    return x / 4294967296;
  };
}

/** Spec reference model. */
function reference(
  state: AlertState,
  price: number,
): { satisfied: boolean; triggered: boolean; armed: boolean } {
  if (!Number.isFinite(price) || !Number.isFinite(state.targetPrice)) {
    return { satisfied: false, triggered: false, armed: state.armed };
  }
  const satisfied = state.condition === 'above' ? price >= state.targetPrice : price <= state.targetPrice;
  if (!state.enabled) return { satisfied, triggered: false, armed: state.armed };
  if (satisfied && state.armed) return { satisfied, triggered: true, armed: false };
  if (!satisfied) return { satisfied, triggered: false, armed: true };
  return { satisfied, triggered: false, armed: state.armed };
}

describe('isConditionMet (adversarial)', () => {
  it('equality satisfies both conditions for many magnitudes', () => {
    for (const t of [0, -0, 1e-9, 0.1 + 0.2, 1, 99.99, 12345.6789, 1e15, -42.5, Number.MAX_VALUE]) {
      expect(isConditionMet('above', t, t)).toBe(true);
      expect(isConditionMet('below', t, t)).toBe(true);
    }
  });

  it('is strictly one-sided away from the target', () => {
    expect(isConditionMet('above', Number.MIN_VALUE, 0)).toBe(true);
    expect(isConditionMet('below', Number.MIN_VALUE, 0)).toBe(false);
    expect(isConditionMet('above', -Number.MIN_VALUE, 0)).toBe(false);
    expect(isConditionMet('below', -Number.MIN_VALUE, 0)).toBe(true);
  });

  it('returns false (a boolean) for every non-finite price or target', () => {
    for (const c of CONDITIONS) {
      for (const bad of NON_FINITE) {
        expect(isConditionMet(c, bad, 100)).toBe(false);
        expect(isConditionMet(c, 100, bad)).toBe(false);
        expect(isConditionMet(c, bad, bad)).toBe(false);
      }
      // Infinity vs Infinity would be >= / <= true numerically; the spec says never match.
      expect(isConditionMet(c, Infinity, Infinity)).toBe(false);
      expect(isConditionMet(c, -Infinity, -Infinity)).toBe(false);
    }
  });
});

describe('evaluateAlert (adversarial)', () => {
  it('does not mutate its input', () => {
    const alert: AlertState = Object.freeze({
      enabled: true,
      armed: true,
      condition: 'above',
      targetPrice: 10,
    });
    expect(() => evaluateAlert(alert, 11)).not.toThrow();
    expect(alert).toEqual({ enabled: true, armed: true, condition: 'above', targetPrice: 10 });
  });

  it('returns exactly the three documented boolean fields', () => {
    const r = evaluateAlert({ enabled: true, armed: true, condition: 'below', targetPrice: 5 }, 5);
    expect(Object.keys(r).sort()).toEqual(['armed', 'satisfied', 'triggered']);
    for (const v of Object.values(r)) expect(typeof v).toBe('boolean');
  });

  it('non-finite prices never change state, even when enabled and disarmed (no re-arm)', () => {
    for (const c of CONDITIONS) {
      for (const bad of NON_FINITE) {
        for (const enabled of [true, false]) {
          for (const armed of [true, false]) {
            expect(evaluateAlert({ enabled, armed, condition: c, targetPrice: 100 }, bad)).toEqual({
              satisfied: false,
              triggered: false,
              armed,
            });
          }
        }
      }
    }
  });

  it('a non-finite target never fires and never re-arms', () => {
    for (const c of CONDITIONS) {
      for (const bad of NON_FINITE) {
        for (const armed of [true, false]) {
          const r = evaluateAlert({ enabled: true, armed, condition: c, targetPrice: bad }, 100);
          expect(r.triggered).toBe(false);
          expect(r.armed).toBe(armed);
          expect(r.satisfied).toBe(false);
        }
      }
    }
  });

  it('disabled alerts still report satisfied truthfully but never fire or change armed', () => {
    expect(evaluateAlert({ enabled: false, armed: true, condition: 'above', targetPrice: 10 }, 10)).toEqual({
      satisfied: true,
      triggered: false,
      armed: true,
    });
    expect(evaluateAlert({ enabled: false, armed: false, condition: 'above', targetPrice: 10 }, 9)).toEqual({
      satisfied: false,
      triggered: false,
      armed: false,
    });
  });

  it('walks the full lifecycle: fire, quiet, re-arm, fire again, disable, re-enable already satisfied', () => {
    let state: AlertState = { enabled: true, armed: true, condition: 'below', targetPrice: 50 };
    const step = (price: number) => {
      const r = evaluateAlert(state, price);
      state = { ...state, armed: r.armed };
      return r.triggered;
    };
    expect(step(60)).toBe(false); // outside, armed stays true
    expect(step(50)).toBe(true); // equality enters: fire
    expect(step(49)).toBe(false); // still inside: quiet
    expect(step(50)).toBe(false); // boundary, still inside: quiet
    expect(step(50.0001)).toBe(false); // leaves: re-arm
    expect(state.armed).toBe(true);
    expect(step(10)).toBe(true); // re-entry: fire again
    // Disabled while inside: nothing, armed preserved (false).
    state = { ...state, enabled: false };
    expect(step(70)).toBe(false);
    expect(state.armed).toBe(false);
    // Re-enabled: caller sets armed = true per spec; condition already satisfied -> next price fires.
    state = { ...state, enabled: true, armed: true };
    expect(step(40)).toBe(true);
  });

  it('matches the spec reference model over long seeded random sequences (with toggles and edits)', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const rand = xorshift(seed * 2654435761);
      const target = Math.round(rand() * 200) / 2;
      let state: AlertState = {
        enabled: rand() < 0.8,
        armed: rand() < 0.5,
        condition: rand() < 0.5 ? 'above' : 'below',
        targetPrice: target,
      };
      let fires = 0;
      let refFires = 0;
      for (let i = 0; i < 400; i++) {
        const roll = rand();
        let price: number;
        if (roll < 0.04) price = NON_FINITE[Math.floor(rand() * 3)]!;
        else if (roll < 0.2)
          price = state.targetPrice; // hit the boundary often
        else price = state.targetPrice + (rand() - 0.5) * 10;

        const actual = evaluateAlert(state, price);
        const expected = reference(state, price);
        expect(actual, `seed ${seed} step ${i} price ${price} state ${JSON.stringify(state)}`).toEqual(
          expected,
        );
        if (actual.triggered) fires++;
        if (expected.triggered) refFires++;
        // Invariants: a trigger implies satisfied and leaves the alert disarmed.
        if (actual.triggered) {
          expect(actual.satisfied).toBe(true);
          expect(actual.armed).toBe(false);
        }
        state = { ...state, armed: actual.armed };
        // Occasionally toggle enabled or edit, applying the caller's "starts armed" rule.
        const ev = rand();
        if (ev < 0.02)
          state = { ...state, enabled: !state.enabled, armed: !state.enabled ? true : state.armed };
        else if (ev < 0.03)
          state = { ...state, condition: state.condition === 'above' ? 'below' : 'above', armed: true };
      }
      expect(fires).toBe(refFires);
    }
  });

  it('never fires twice without an intervening unsatisfied finite price', () => {
    const rand = xorshift(987654321);
    let state: AlertState = { enabled: true, armed: true, condition: 'above', targetPrice: 100 };
    let sawUnsatisfiedSinceFire = true;
    for (let i = 0; i < 5000; i++) {
      const roll = rand();
      const price = roll < 0.05 ? Number.NaN : 100 + (rand() - 0.4) * 4;
      const r = evaluateAlert(state, price);
      if (r.triggered) {
        expect(sawUnsatisfiedSinceFire).toBe(true);
        sawUnsatisfiedSinceFire = false;
      } else if (Number.isFinite(price) && !r.satisfied) {
        sawUnsatisfiedSinceFire = true;
      }
      state = { ...state, armed: r.armed };
    }
  });
});
