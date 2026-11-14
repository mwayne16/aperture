import { describe, expect, it } from 'vitest';
import { evaluateAlert, isConditionMet } from './alertEngine';
import type { AlertCondition, PriceAlert } from './types';

/**
 * Round-3 adversarial tests for alertEngine, derived only from the doc-comment rules.
 * A long seeded simulation drives the engine the way a store would (price ticks, disable/enable,
 * target/condition edits that re-arm) and checks every step against an independent reference model
 * and against invariants that must hold for any implementation.
 */

type AlertState = Pick<PriceAlert, 'enabled' | 'armed' | 'condition' | 'targetPrice'>;

/** mulberry32: small deterministic PRNG so failures reproduce. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Reference model written straight from the rules, sharing no code with the implementation. */
function reference(
  alert: AlertState,
  price: number,
): { satisfied: boolean; triggered: boolean; armed: boolean } {
  const finite = (n: number) =>
    typeof n === 'number' && !Number.isNaN(n) && n !== Infinity && n !== -Infinity;
  if (!finite(price)) return { satisfied: false, triggered: false, armed: alert.armed };
  const satisfied = alert.condition === 'above' ? !(price < alert.targetPrice) : !(price > alert.targetPrice);
  if (!alert.enabled) return { satisfied, triggered: false, armed: alert.armed };
  if (satisfied && alert.armed) return { satisfied, triggered: true, armed: false };
  if (satisfied) return { satisfied, triggered: false, armed: false };
  return { satisfied, triggered: false, armed: true };
}

const SPECIAL_PRICES = [NaN, Infinity, -Infinity];

describe('evaluateAlert seeded store simulation (round 3)', () => {
  it.each([1, 7, 42, 1337, 20261023])('matches the reference across 5000 mixed events (seed %i)', (seed) => {
    const r = rng(seed);
    let alert: AlertState = { enabled: true, armed: true, condition: 'above', targetPrice: 100 };
    let fires = 0;
    let lastFinitePrice: number | null = null;

    for (let step = 0; step < 5000; step++) {
      const roll = r();
      if (roll < 0.05) {
        // Toggle enabled. Re-enabling starts armed (store rule from the doc comment).
        alert = alert.enabled ? { ...alert, enabled: false } : { ...alert, enabled: true, armed: true };
        continue;
      }
      if (roll < 0.08) {
        // Edit target or condition: starts armed.
        const condition: AlertCondition = r() < 0.5 ? 'above' : 'below';
        const targetPrice = Math.round((90 + r() * 20) * 100) / 100;
        alert = { ...alert, condition, targetPrice, armed: true };
        continue;
      }
      let price: number;
      if (roll < 0.11) price = SPECIAL_PRICES[Math.floor(r() * SPECIAL_PRICES.length)]!;
      else if (roll < 0.2)
        price = alert.targetPrice; // exact equality is common in real feeds
      else price = Math.round((85 + r() * 30) * 100) / 100;

      const before = { ...alert };
      const got = evaluateAlert(alert, price);
      const want = reference(alert, price);
      expect(got, `seed ${seed} step ${step} alert ${JSON.stringify(before)} price ${price}`).toEqual(want);

      // Invariants that hold for any correct implementation.
      expect(evaluateAlert(before, price)).toEqual(got); // pure: same input, same output
      expect(alert).toEqual(before); // the input object is not mutated
      if (got.triggered) {
        expect(before.enabled && before.armed && got.satisfied).toBe(true);
        expect(got.armed).toBe(false);
        expect(got.satisfied).toBe(isConditionMet(before.condition, price, before.targetPrice));
        fires++;
      }
      if (!before.enabled) expect(got.armed).toBe(before.armed);
      if (Number.isFinite(price)) lastFinitePrice = price;

      alert = { ...alert, armed: got.armed };
    }
    // The simulation must actually exercise firing (guards against a vacuous run).
    expect(fires).toBeGreaterThan(20);
    expect(lastFinitePrice).not.toBeNull();
  });

  it('two consecutive fires are always separated by at least one non-satisfying finite price or a re-arm', () => {
    const r = rng(99);
    const alert: AlertState = { enabled: true, armed: true, condition: 'below', targetPrice: 50 };
    let armed = alert.armed;
    let sawLeaveSinceFire = true;
    for (let i = 0; i < 20000; i++) {
      const price = r() < 0.05 ? NaN : Math.round((45 + r() * 10) * 10) / 10;
      const res = evaluateAlert({ ...alert, armed }, price);
      if (res.triggered) {
        expect(sawLeaveSinceFire).toBe(true);
        sawLeaveSinceFire = false;
      }
      if (Number.isFinite(price) && !isConditionMet('below', price, 50)) sawLeaveSinceFire = true;
      armed = res.armed;
    }
  });

  it('a NaN tick between leaving and re-entering does not swallow the re-arm', () => {
    let a: AlertState = { enabled: true, armed: true, condition: 'above', targetPrice: 10 };
    const seq: [number, boolean][] = [
      [10, true], // fires at equality
      [11, false],
      [9.99, false], // leaves -> re-arm
      [NaN, false], // ignored, must keep armed=true
      [10, true], // fires again
      [Infinity, false],
      [-Infinity, false],
      [10.5, false], // still satisfied, quiet
    ];
    for (const [price, fires] of seq) {
      const res = evaluateAlert(a, price);
      expect(res.triggered, `price ${price}`).toBe(fires);
      a = { ...a, armed: res.armed };
    }
  });

  it('a disabled alert that saw the price leave is still disarmed when re-enabled without the store re-arming', () => {
    // Disabled alerts leave armed unchanged, even when the price leaves the condition.
    const disarmedDisabled: AlertState = {
      enabled: false,
      armed: false,
      condition: 'above',
      targetPrice: 10,
    };
    const left = evaluateAlert(disarmedDisabled, 5);
    expect(left).toEqual({ satisfied: false, triggered: false, armed: false });
    const armedDisabled: AlertState = { enabled: false, armed: true, condition: 'above', targetPrice: 10 };
    expect(evaluateAlert(armedDisabled, 50)).toEqual({ satisfied: true, triggered: false, armed: true });
  });

  it('returns a fresh plain object with exactly the three documented keys', () => {
    const res = evaluateAlert({ enabled: true, armed: true, condition: 'above', targetPrice: 1 }, 2);
    expect(Object.keys(res).sort()).toEqual(['armed', 'satisfied', 'triggered']);
    for (const v of Object.values(res)) expect(typeof v).toBe('boolean');
  });
});
