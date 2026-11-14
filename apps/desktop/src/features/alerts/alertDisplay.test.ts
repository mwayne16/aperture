import { describe, expect, it } from 'vitest';
import type { AlertEvent, PriceAlert } from '../../domain/types';
import {
  alertStatus,
  conditionPreview,
  conditionText,
  lastTriggeredText,
  sortAlerts,
  statusHint,
  targetDistance,
  triggerNotice,
} from './alertDisplay';

function alert(patch: Partial<PriceAlert>): PriceAlert {
  return {
    id: 'a1',
    symbol: 'AAPL',
    condition: 'above',
    targetPrice: 200,
    tag: 'buy',
    field: 'last',
    enabled: true,
    armed: true,
    note: null,
    createdAt: '2026-10-30T13:00:00.000Z',
    updatedAt: '2026-10-30T13:00:00.000Z',
    lastTriggeredAt: null,
    lastTriggeredPrice: null,
    triggerCount: 0,
    ...patch,
  };
}

describe('conditionText', () => {
  it('names the Last field and formats the target', () => {
    expect(conditionText('above', 200)).toBe('Last ≥ 200.00');
    expect(conditionText('below', 1234.5)).toBe('Last ≤ 1,234.50');
  });
});

describe('alertStatus', () => {
  it('distinguishes armed, triggered-and-waiting, and disabled', () => {
    expect(alertStatus({ enabled: true, armed: true })).toBe('armed');
    expect(alertStatus({ enabled: true, armed: false })).toBe('waiting');
    expect(alertStatus({ enabled: false, armed: true })).toBe('disabled');
    expect(alertStatus({ enabled: false, armed: false })).toBe('disabled');
  });

  it('explains when a waiting alert re-arms', () => {
    expect(statusHint(alert({ armed: false }))).toBe(
      'Re-arms once Last moves back below 200.00, then can fire again.',
    );
    expect(statusHint(alert({ condition: 'below', armed: false }))).toMatch(/back above 200\.00/);
    expect(statusHint(alert({}))).toBe('Fires on the next trade at or above 200.00.');
  });
});

describe('targetDistance', () => {
  it('is the move from Last to the target as a percent of Last', () => {
    expect(targetDistance('above', 110, 100)).toEqual({ percent: 10, met: false });
    expect(targetDistance('below', 90, 100)).toEqual({ percent: -10, met: false });
  });

  it('reports a met condition, including equality', () => {
    expect(targetDistance('above', 100, 100).met).toBe(true);
    expect(targetDistance('above', 95, 100).met).toBe(true);
    expect(targetDistance('below', 105, 100).met).toBe(true);
  });

  it('has no distance without a usable price', () => {
    expect(targetDistance('above', 100, null)).toEqual({ percent: null, met: false });
    expect(targetDistance('above', 100, undefined)).toEqual({ percent: null, met: false });
    expect(targetDistance('above', 100, 0)).toEqual({ percent: null, met: false });
  });
});

describe('sortAlerts', () => {
  it('orders by symbol, then condition, then target, without mutating the input', () => {
    const input = [
      alert({ id: 'b', symbol: 'TSLA' }),
      alert({ id: 'c', symbol: 'AAPL', condition: 'below', targetPrice: 150 }),
      alert({ id: 'd', symbol: 'AAPL', targetPrice: 250 }),
      alert({ id: 'a', symbol: 'AAPL', targetPrice: 210 }),
    ];
    expect(sortAlerts(input).map((a) => a.id)).toEqual(['a', 'd', 'c', 'b']);
    expect(input[0]?.id).toBe('b');
  });
});

describe('lastTriggeredText', () => {
  it('shows the time in ET with the trigger count', () => {
    expect(lastTriggeredText(alert({}))).toBe('Never');
    expect(lastTriggeredText(alert({ lastTriggeredAt: '2026-10-30T18:05:09.000Z', triggerCount: 3 }))).toBe(
      'Oct 30, 14:05:09 · 3×',
    );
  });
});

describe('triggerNotice', () => {
  const event: AlertEvent = {
    id: 'e1',
    alertId: 'a1',
    symbol: 'AAPL',
    condition: 'above',
    targetPrice: 200,
    tag: 'buy',
    field: 'last',
    price: 200.12,
    triggeredAt: '2026-10-30T18:05:09.000Z',
  };

  it('names the symbol, condition, target and tag, and marks simulated prices', () => {
    expect(triggerNotice(event, true)).toEqual({
      title: 'AAPL above 200.00 · Buy',
      description: 'Last trade 200.12 at 14:05:09 ET (simulated)',
    });
    expect(triggerNotice({ ...event, condition: 'below', tag: 'sell' }, false)).toEqual({
      title: 'AAPL below 200.00 · Sell',
      description: 'Last trade 200.12 at 14:05:09 ET',
    });
  });
});

describe('conditionPreview', () => {
  const base = { condition: 'above' as const, targetPrice: 200, enabled: true, armedAfterSave: true };
  const preview = (patch: Partial<Parameters<typeof conditionPreview>[0]>) =>
    conditionPreview({ ...base, last: null, ...patch })?.text ?? null;

  it('says an armed alert whose condition is already met fires on the next trade', () => {
    expect(conditionPreview({ ...base, last: 201 })).toEqual({
      text: 'Last is already above 200.00, so this alert triggers on the next trade.',
      met: true,
    });
    expect(preview({ last: 200 })).toMatch(/^Last is already at 200\.00/);
    expect(preview({ condition: 'below', last: 150 })).toMatch(/^Last is already below 200\.00/);
  });

  it('describes the move still needed when the condition is not met', () => {
    expect(conditionPreview({ ...base, last: 160 })).toEqual({
      text: 'Triggers when Last rises to 200.00 (+25.00% from 160.00).',
      met: false,
    });
    expect(preview({ condition: 'below', targetPrice: 150, last: 200 })).toBe(
      'Triggers when Last falls to 150.00 (−25.00% from 200.00).',
    );
  });

  it('does not promise a trigger for a disabled or still-disarmed alert', () => {
    expect(preview({ last: 201, enabled: false })).toMatch(/Once enabled/);
    expect(preview({ last: 201, armedAfterSave: false })).toMatch(/re-arms once Last moves back below/);
  });

  it('stays quiet without a price or a valid target', () => {
    expect(preview({ last: null })).toBeNull();
    expect(preview({ targetPrice: Number.NaN, last: 200 })).toBeNull();
    expect(preview({ targetPrice: 0, last: 200 })).toBeNull();
  });
});
