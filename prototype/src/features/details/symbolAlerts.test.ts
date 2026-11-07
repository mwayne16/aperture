import { describe, expect, it } from 'vitest';
import type { PriceAlert } from '../../domain/types';
import { alertsForSymbol } from './symbolAlerts';

function alert(id: string, symbol: string, condition: PriceAlert['condition'], targetPrice: number): PriceAlert {
  return {
    id,
    symbol,
    condition,
    targetPrice,
    tag: 'buy',
    field: 'last',
    enabled: true,
    armed: true,
    note: null,
    createdAt: '2026-11-01T10:00:00.000Z',
    updatedAt: '2026-11-01T10:00:00.000Z',
    lastTriggeredAt: null,
    lastTriggeredPrice: null,
    triggerCount: 0,
  };
}

describe('alertsForSymbol', () => {
  it("keeps only the symbol's alerts, above before below, then by target", () => {
    const alerts = [
      alert('a', 'AAPL', 'below', 150),
      alert('b', 'MSFT', 'above', 400),
      alert('c', 'AAPL', 'above', 220),
      alert('d', 'AAPL', 'above', 200),
    ];
    expect(alertsForSymbol(alerts, 'aapl').map((a) => a.id)).toEqual(['d', 'c', 'a']);
  });

  it('matches crypto pairs and returns nothing for a symbol without alerts', () => {
    const alerts = [alert('a', 'BTC/USD', 'above', 90_000)];
    expect(alertsForSymbol(alerts, 'BTC/USD')).toHaveLength(1);
    expect(alertsForSymbol(alerts, 'ETH/USD')).toEqual([]);
  });
});
