/** Adversarial long-run checks of the simulated price model against the spec's bounds. */
import { describe, expect, it } from 'vitest';
import { INSTRUMENTS, type InstrumentProfile } from './instruments';
import { createInitialState, stepPrice, type PriceState } from './priceModel';

function decimals(value: number): number {
  const text = String(value);
  return text.includes('.') ? (text.split('.')[1]?.length ?? 0) : 0;
}

/** Returns the spec violations of one state, or [] (cheap: no expect() per step). */
function violations(s: PriceState): string[] {
  const out: string[] = [];
  if (!(s.last > 0)) out.push('last <= 0');
  if (!(s.bid > 0)) out.push('bid <= 0');
  if (!(s.bid < s.ask)) out.push('crossed book');
  if (decimals(s.last) > (s.last >= 1 ? 2 : 4)) out.push(`last not tick-rounded: ${s.last}`);
  if (decimals(s.bid) > 4 || decimals(s.ask) > 4) out.push('book not rounded');
  if (s.bidSize % 100 !== 0 || s.askSize % 100 !== 0 || s.bidSize <= 0 || s.askSize <= 0)
    out.push('sizes not round lots');
  if (s.high < s.last || s.low > s.last) out.push('range does not contain last');
  // "stays within roughly ±6% of prevClose over hours"
  if (Math.abs(s.last / s.prevClose - 1) > 0.0605) out.push(`outside ±6%: ${s.last} vs ${s.prevClose}`);
  return out;
}

function checkState(s: PriceState): void {
  const found = violations(s);
  if (found.length > 0) expect(`${s.symbol} trade ${s.tradeCount}: ${found.join(', ')}`).toBe('');
}

describe('price model over a long session', () => {
  it('keeps every instrument positive, tick-rounded, uncrossed and within ±6% for 3000 trades', () => {
    for (const profile of INSTRUMENTS) {
      let s = createInitialState(profile);
      checkState(s);
      // The opening gap is "small".
      expect(Math.abs(s.open / s.prevClose - 1)).toBeLessThanOrEqual(0.03);
      let volume = s.volume;
      for (let i = 0; i < 3000; i++) {
        s = stepPrice(s);
        checkState(s);
        if (s.volume <= volume) expect(`${s.symbol}: volume did not grow`).toBe('');
        volume = s.volume;
      }
    }
  }, 60_000);

  it('handles sub-dollar and high-volatility profiles', () => {
    const penny: InstrumentProfile = {
      symbol: 'PNNY',
      name: 'Penny Test',
      exchange: 'NASDAQ',
      assetClass: 'stock',
      referencePrice: 0.42,
      volatility: 3,
      averageVolume: 1_000_000,
      listedYear: 2020,
    };
    let s = createInitialState(penny);
    for (let i = 0; i < 20_000; i++) {
      s = stepPrice(s);
      checkState(s);
    }
  }, 60_000);

  it('is deterministic: two fresh states for the same symbol walk identical paths', () => {
    const profile = INSTRUMENTS.find((p) => p.symbol === 'TSLA')!;
    let a = createInitialState(profile);
    let b = createInitialState(profile);
    for (let i = 0; i < 500; i++) {
      a = stepPrice(a);
      b = stepPrice(b);
      expect(a.last).toBe(b.last);
      expect(a.bid).toBe(b.bid);
      expect(a.askSize).toBe(b.askSize);
    }
  });
});
