import { describe, expect, it } from 'vitest';
import { type AlertEvaluation, evaluateAlert, isConditionMet } from './alertEngine.js';
import type { AlertCondition, PriceAlert } from './alerts.js';

type AlertState = Pick<PriceAlert, 'enabled' | 'armed' | 'condition' | 'targetPrice'>;

const NON_FINITE = [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY];
const CONDITIONS: AlertCondition[] = ['above', 'below'];
const BOOLS = [true, false];

/** Deterministic PRNG (mulberry32) so property-style runs are reproducible without new deps. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('isConditionMet', () => {
  it.each<[AlertCondition, number, number, boolean]>([
    ['above', 99.99, 100, false],
    ['above', 100, 100, true],
    ['above', 100.01, 100, true],
    ['below', 99.99, 100, true],
    ['below', 100, 100, true],
    ['below', 100.01, 100, false],
    // Equality with signed zero and tiny numbers.
    ['above', -0, 0, true],
    ['below', 0, -0, true],
    ['above', 0.0001, 0.0001, true],
    ['below', 0.0001, 0.0001, true],
    // Smallest representable step either side of the target.
    ['above', 100 - Number.EPSILON * 100, 100, false],
    ['below', 100 + Number.EPSILON * 100, 100, false],
    // Negative prices still compare numerically.
    ['above', -5, -10, true],
    ['below', -5, -10, false],
  ])('%s: price %d vs target %d -> %s', (condition, price, target, expected) => {
    expect(isConditionMet(condition, price, target)).toBe(expected);
  });

  it.each(CONDITIONS)('%s: equality at the target satisfies the condition', (condition) => {
    expect(isConditionMet(condition, 187.25, 187.25)).toBe(true);
  });

  it.each(CONDITIONS.flatMap((c) => NON_FINITE.map((p) => [c, p] as const)))(
    '%s: non-finite price %d never satisfies',
    (condition, price) => {
      expect(isConditionMet(condition, price, 100)).toBe(false);
    },
  );

  it.each(CONDITIONS.flatMap((c) => NON_FINITE.map((t) => [c, t] as const)))(
    '%s: non-finite target %d never satisfies',
    (condition, target) => {
      expect(isConditionMet(condition, 100, target)).toBe(false);
    },
  );

  // Persisted alerts are untyped at runtime: a corrupt condition must give a real boolean false.
  it.each(['ABOVE', 'Below', 'sideways', '', 'toString', '__proto__', null, undefined, 1])(
    'an unknown condition %j never satisfies and returns the boolean false',
    (condition) => {
      for (const [price, target] of [
        [10, 10],
        [11, 10],
        [9, 10],
      ] as const) {
        expect(isConditionMet(condition as AlertCondition, price, target)).toBe(false);
      }
    },
  );
});

describe('evaluateAlert: full state table', () => {
  const TARGET = 100;
  type Relation = 'outside' | 'at' | 'inside';
  /** A price that is outside / at / inside the condition for the given direction. */
  const priceFor = (condition: AlertCondition, relation: Relation): number => {
    const offset = relation === 'outside' ? -1 : relation === 'at' ? 0 : 1;
    return condition === 'above' ? TARGET + offset : TARGET - offset;
  };

  // enabled, armedBefore, relation -> expected evaluation (identical for both conditions).
  const table: [boolean, boolean, Relation, AlertEvaluation][] = [
    [true, true, 'outside', { satisfied: false, triggered: false, armed: true }],
    [true, true, 'at', { satisfied: true, triggered: true, armed: false }],
    [true, true, 'inside', { satisfied: true, triggered: true, armed: false }],
    [true, false, 'outside', { satisfied: false, triggered: false, armed: true }],
    [true, false, 'at', { satisfied: true, triggered: false, armed: false }],
    [true, false, 'inside', { satisfied: true, triggered: false, armed: false }],
    [false, true, 'outside', { satisfied: false, triggered: false, armed: true }],
    [false, true, 'at', { satisfied: true, triggered: false, armed: true }],
    [false, true, 'inside', { satisfied: true, triggered: false, armed: true }],
    [false, false, 'outside', { satisfied: false, triggered: false, armed: false }],
    [false, false, 'at', { satisfied: true, triggered: false, armed: false }],
    [false, false, 'inside', { satisfied: true, triggered: false, armed: false }],
  ];
  const rows = CONDITIONS.flatMap((condition) =>
    table.map(
      ([enabled, armed, relation, expected]) => [condition, enabled, armed, relation, expected] as const,
    ),
  );

  it.each(rows)('%s enabled=%s armed=%s price %s -> %o', (condition, enabled, armed, relation, expected) => {
    const alert: AlertState = { condition, enabled, armed, targetPrice: TARGET };
    expect(evaluateAlert(alert, priceFor(condition, relation))).toEqual(expected);
  });

  const ignoredRows = CONDITIONS.flatMap((condition) =>
    BOOLS.flatMap((enabled) =>
      BOOLS.flatMap((armed) => NON_FINITE.map((price) => [condition, enabled, armed, price] as const)),
    ),
  );

  it.each(ignoredRows)(
    '%s enabled=%s armed=%s: non-finite price %d is ignored',
    (condition, enabled, armed, price) => {
      const alert: AlertState = { condition, enabled, armed, targetPrice: TARGET };
      expect(evaluateAlert(alert, price)).toEqual({ satisfied: false, triggered: false, armed });
    },
  );

  it.each(BOOLS)('a non-finite target is ignored, never fires or re-arms (armed=%s)', (armed) => {
    for (const target of NON_FINITE) {
      for (const condition of CONDITIONS) {
        const alert: AlertState = { condition, enabled: true, armed, targetPrice: target };
        expect(evaluateAlert(alert, 100)).toEqual({ satisfied: false, triggered: false, armed });
      }
    }
  });

  it.each(BOOLS)('an unknown condition is ignored, never fires or re-arms (armed=%s)', (armed) => {
    for (const condition of ['ABOVE', 'sideways', '', 'toString', null]) {
      for (const enabled of BOOLS) {
        for (const price of [9, 10, 11]) {
          const alert: AlertState = {
            condition: condition as AlertCondition,
            enabled,
            armed,
            targetPrice: 10,
          };
          expect(evaluateAlert(alert, price)).toEqual({ satisfied: false, triggered: false, armed });
        }
      }
    }
  });

  // Persisted flags are untyped at runtime: only `true` counts, and the result is always a real boolean.
  it.each<unknown>([undefined, null, 0, 1, '', 'false', 'true'])(
    'a corrupt flag %j counts as false',
    (flag) => {
      const corrupt = flag as boolean;
      for (const condition of CONDITIONS) {
        const satisfied = priceFor(condition, 'inside');
        expect(
          evaluateAlert({ condition, enabled: true, armed: corrupt, targetPrice: TARGET }, satisfied),
        ).toEqual({ satisfied: true, triggered: false, armed: false });
        expect(
          evaluateAlert({ condition, enabled: corrupt, armed: true, targetPrice: TARGET }, satisfied),
        ).toEqual({ satisfied: true, triggered: false, armed: true });
        expect(
          evaluateAlert({ condition, enabled: false, armed: corrupt, targetPrice: TARGET }, Number.NaN),
        ).toEqual({ satisfied: false, triggered: false, armed: false });
      }
    },
  );

  it('does not mutate the alert it is given', () => {
    const alert: AlertState = Object.freeze({
      condition: 'above',
      enabled: true,
      armed: true,
      targetPrice: 100,
    });
    const result = evaluateAlert(alert, 150);
    expect(result.armed).toBe(false);
    expect(alert).toEqual({ condition: 'above', enabled: true, armed: true, targetPrice: 100 });
  });
});

/** Runs a price sequence through the engine, carrying `armed` forward like the Alert Service does. */
function run(
  start: AlertState,
  steps: readonly (number | { price: number; enabled: boolean })[],
): { fired: boolean[]; armed: boolean[] } {
  let state = { ...start };
  const fired: boolean[] = [];
  const armed: boolean[] = [];
  for (const step of steps) {
    const { price, enabled } = typeof step === 'number' ? { price: step, enabled: state.enabled } : step;
    state = { ...state, enabled };
    const result = evaluateAlert(state, price);
    state = { ...state, armed: result.armed };
    fired.push(result.triggered);
    armed.push(result.armed);
  }
  return { fired, armed };
}

describe('evaluateAlert: sequences', () => {
  const above: AlertState = { condition: 'above', enabled: true, armed: true, targetPrice: 100 };
  const below: AlertState = { condition: 'below', enabled: true, armed: true, targetPrice: 100 };

  it('fires once on entry, then stays quiet while the condition remains satisfied', () => {
    expect(run(above, [99, 100, 101, 105, 100]).fired).toEqual([false, true, false, false, false]);
  });

  it('disarms on fire, re-arms on leaving, and fires again on re-entry', () => {
    const { fired, armed } = run(above, [101, 102, 99, 98, 100, 99.5, 120]);
    expect(fired).toEqual([true, false, false, false, true, false, true]);
    expect(armed).toEqual([false, false, true, true, false, true, false]);
  });

  it('mirrors the behaviour for "below"', () => {
    expect(run(below, [101, 100, 99, 100, 100.01, 50]).fired).toEqual([
      false,
      true,
      false,
      false,
      false,
      true,
    ]);
  });

  it('a new or re-armed alert fires on the first price if the condition is already satisfied', () => {
    expect(run(above, [150]).fired).toEqual([true]);
    expect(run(below, [100]).fired).toEqual([true]);
  });

  it('a restarted, disarmed alert does not re-notify while the condition stays satisfied', () => {
    const persisted: AlertState = { ...above, armed: false };
    expect(run(persisted, [150, 151, 99, 150]).fired).toEqual([false, false, false, true]);
  });

  it('touching the target exactly counts as entry and leaving requires crossing past it', () => {
    // 100 is inside "above"; only 99.99 leaves it.
    expect(run(above, [100, 100, 100, 99.99, 100]).fired).toEqual([true, false, false, false, true]);
  });

  it('non-finite prices in the middle of a sequence neither fire nor re-arm', () => {
    const { fired, armed } = run(above, [
      101,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      102,
      Number.NaN,
      99,
      Number.NaN,
      101,
    ]);
    expect(fired).toEqual([true, false, false, false, false, false, false, true]);
    expect(armed).toEqual([false, false, false, false, false, true, true, false]);
  });

  it('Infinity never fires "above" and -Infinity never fires "below"', () => {
    expect(run(above, [Number.POSITIVE_INFINITY]).fired).toEqual([false]);
    expect(run(below, [Number.NEGATIVE_INFINITY]).fired).toEqual([false]);
  });

  it('a disabled alert never fires and keeps its armed flag through any prices', () => {
    const disabledArmed = run({ ...above, enabled: false }, [150, 50, 150, 100]);
    expect(disabledArmed.fired).toEqual([false, false, false, false]);
    expect(disabledArmed.armed).toEqual([true, true, true, true]);

    const disabledDisarmed = run({ ...above, enabled: false, armed: false }, [50, 150, 50]);
    expect(disabledDisarmed.fired).toEqual([false, false, false]);
    expect(disabledDisarmed.armed).toEqual([false, false, false]);
  });

  it('does not re-arm on its own when re-enabled; leaving the condition while disabled is not seen', () => {
    const { fired } = run(above, [
      { price: 150, enabled: true },
      { price: 50, enabled: false },
      { price: 150, enabled: true },
    ]);
    expect(fired).toEqual([true, false, false]);
  });

  it('fires on the next satisfying price once the caller re-arms a re-enabled alert', () => {
    // Re-enabling or editing an alert sets armed = true in the store, not in the engine.
    const fired = run({ ...above, armed: false }, [150]).fired;
    expect(fired).toEqual([false]);
    expect(run({ ...above, armed: true }, [150, 151]).fired).toEqual([true, false]);
  });
});

describe('evaluateAlert: random sequences vs a brute-force reference model', () => {
  interface Step {
    price: number;
    enabled: boolean;
  }

  /**
   * Independent closed-form model: an evaluation is "effective" when the alert is enabled and the price
   * and target are finite. Before an effective step the alert is armed iff the previous effective step
   * did NOT satisfy the condition (or, with no previous one, iff it started armed). It fires iff the
   * step is effective, satisfies the condition, and was armed. Scans the whole history every step.
   */
  function reference(condition: AlertCondition, target: number, initialArmed: boolean, steps: Step[]) {
    const meets = (p: number) => (condition === 'above' ? p >= target : p <= target);
    const effective = (s: Step) => s.enabled && Number.isFinite(s.price) && Number.isFinite(target);
    const armedBefore = (i: number): boolean => {
      for (let j = i - 1; j >= 0; j--) {
        const prev = steps[j]!;
        if (effective(prev)) return !meets(prev.price);
      }
      return initialArmed;
    };
    return steps.map((step, i) => {
      const before = armedBefore(i);
      if (!effective(step)) return { triggered: false, armed: before };
      const satisfied = meets(step.price);
      return { triggered: satisfied && before, armed: !satisfied };
    });
  }

  const SEEDS = Array.from({ length: 200 }, (_, i) => 0x5eed + i * 7919);

  it.each(SEEDS)('seed %i: engine matches the reference model', (seed) => {
    const rand = mulberry32(seed);
    const condition: AlertCondition = rand() < 0.5 ? 'above' : 'below';
    // Mostly finite targets, occasionally a corrupt one; prices on a coarse grid so equality is common.
    const target = rand() < 0.03 ? Number.NaN : Math.round(rand() * 20) * 0.25;
    const initialArmed = rand() < 0.8;
    const length = 50 + Math.floor(rand() * 250);
    const steps: Step[] = Array.from({ length }, () => {
      const r = rand();
      const price =
        r < 0.04
          ? Number.NaN
          : r < 0.06
            ? Number.POSITIVE_INFINITY
            : r < 0.08
              ? Number.NEGATIVE_INFINITY
              : (Number.isFinite(target) ? target : 2.5) + (Math.floor(rand() * 9) - 4) * 0.25;
      return { price, enabled: rand() < 0.85 };
    });

    let alert: AlertState = { condition, targetPrice: target, enabled: true, armed: initialArmed };
    const actual = steps.map((step) => {
      alert = { ...alert, enabled: step.enabled };
      const result = evaluateAlert(alert, step.price);
      alert = { ...alert, armed: result.armed };
      expect(result.satisfied).toBe(isConditionMet(condition, step.price, target));
      return { triggered: result.triggered, armed: result.armed };
    });

    expect(actual).toEqual(reference(condition, target, initialArmed, steps));
  });

  it('never fires twice without leaving the condition in between (invariant over all seeds)', () => {
    for (const seed of SEEDS) {
      const rand = mulberry32(seed);
      const target = 100;
      let alert: AlertState = { condition: 'above', targetPrice: target, enabled: true, armed: true };
      let firedSinceLeaving = false;
      for (let i = 0; i < 300; i++) {
        const price = target + (Math.floor(rand() * 7) - 3);
        const result = evaluateAlert(alert, price);
        if (result.triggered) {
          expect(firedSinceLeaving).toBe(false);
          firedSinceLeaving = true;
        }
        if (!result.satisfied) firedSinceLeaving = false;
        alert = { ...alert, armed: result.armed };
      }
    }
  });
});
