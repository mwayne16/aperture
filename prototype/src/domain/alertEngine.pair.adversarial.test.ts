import { describe, expect, it } from 'vitest';
import { evaluateAlert, isConditionMet } from './alertEngine';
import type { AlertCondition, PriceAlert } from './types';

/**
 * Round-5 adversarial tests: an "above" and a "below" alert on the same target, driven by the same
 * price stream. Equality satisfies both, so both fire at the target. Fires are counted against an
 * independent rule: an enabled alert fires once per entry into its condition, where the first price
 * counts as an entry when the alert starts armed.
 */

type AlertState = Pick<PriceAlert, 'enabled' | 'armed' | 'condition' | 'targetPrice'>;

function drive(alert: AlertState, prices: readonly number[]): boolean[] {
  let state = { ...alert };
  return prices.map((price) => {
    const result = evaluateAlert(state, price);
    state = { ...state, armed: result.armed };
    return result.triggered;
  });
}

/** Fires on every price where the condition holds now but did not hold on the previous finite price. */
function entries(condition: AlertCondition, target: number, prices: readonly number[]): boolean[] {
  let previous = false; // a fresh armed alert behaves as if the condition was not met before
  return prices.map((price) => {
    if (!Number.isFinite(price)) return false;
    const now = condition === 'above' ? price >= target : price <= target;
    const fired = now && !previous;
    previous = now;
    return fired;
  });
}

function seededRandom(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

describe('above and below alerts on the same target', () => {
  it('both fire when the first price equals the target', () => {
    const above = drive({ enabled: true, armed: true, condition: 'above', targetPrice: 100 }, [100]);
    const below = drive({ enabled: true, armed: true, condition: 'below', targetPrice: 100 }, [100]);
    expect(above).toEqual([true]);
    expect(below).toEqual([true]);
  });

  it('sitting on the target keeps both quiet after the first fire', () => {
    const prices = [100, 100, 100, 100];
    expect(drive({ enabled: true, armed: true, condition: 'above', targetPrice: 100 }, prices)).toEqual([
      true,
      false,
      false,
      false,
    ]);
    expect(drive({ enabled: true, armed: true, condition: 'below', targetPrice: 100 }, prices)).toEqual([
      true,
      false,
      false,
      false,
    ]);
  });

  it('crossing through the target fires each side once per entry', () => {
    const prices = [99, 101, 99, 101];
    expect(drive({ enabled: true, armed: true, condition: 'above', targetPrice: 100 }, prices)).toEqual([
      false,
      true,
      false,
      true,
    ]);
    expect(drive({ enabled: true, armed: true, condition: 'below', targetPrice: 100 }, prices)).toEqual([
      true,
      false,
      true,
      false,
    ]);
  });

  it('a touch of the target from either side counts as an entry for both conditions', () => {
    // 99 -> 100 enters "above"; 101 -> 100 enters "below".
    expect(
      drive({ enabled: true, armed: true, condition: 'above', targetPrice: 100 }, [99, 100, 99, 100]),
    ).toEqual([false, true, false, true]);
    expect(
      drive({ enabled: true, armed: true, condition: 'below', targetPrice: 100 }, [101, 100, 101, 100]),
    ).toEqual([false, true, false, true]);
  });

  it('non-finite prices between entries do not count as leaving the condition', () => {
    const prices = [101, NaN, 101, Infinity, -Infinity, 101];
    expect(drive({ enabled: true, armed: true, condition: 'above', targetPrice: 100 }, prices)).toEqual([
      true,
      false,
      false,
      false,
      false,
      false,
    ]);
  });

  it('matches the entry-counting rule over long seeded walks for both conditions', () => {
    const rand = seededRandom(0x5eed_beef);
    for (let run = 0; run < 300; run++) {
      const target = Math.round(rand() * 20) + 90;
      let price = target;
      const prices: number[] = [];
      for (let i = 0; i < 200; i++) {
        const r = rand();
        if (r < 0.03) prices.push(NaN);
        else if (r < 0.05) prices.push(r < 0.04 ? Infinity : -Infinity);
        else if (r < 0.15)
          prices.push(target); // land exactly on the target often
        else {
          price = Math.round((price + (rand() - 0.5) * 6) * 100) / 100;
          prices.push(price);
        }
      }
      for (const condition of ['above', 'below'] as const) {
        const actual = drive({ enabled: true, armed: true, condition, targetPrice: target }, prices);
        expect(actual, `run ${run} ${condition}`).toEqual(entries(condition, target, prices));
      }
    }
  });

  it('isConditionMet treats -0 and 0 as the same target', () => {
    expect(isConditionMet('above', 0, -0)).toBe(true);
    expect(isConditionMet('below', -0, 0)).toBe(true);
  });

  it('returns a fresh result object with exactly the documented fields', () => {
    const alert: AlertState = { enabled: true, armed: true, condition: 'above', targetPrice: 1 };
    const a = evaluateAlert(alert, 2);
    const b = evaluateAlert(alert, 2);
    expect(a).not.toBe(b);
    expect(Object.keys(a).sort()).toEqual(['armed', 'satisfied', 'triggered']);
  });
});
