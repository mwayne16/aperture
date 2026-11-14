import type { Quote } from '../../domain/types';
import { changeDirection } from '../../lib/format';

/** Pure rules behind the watchlist page's summary strip and its "as of" time. */

export interface Mover {
  symbol: string;
  last: number | null;
  change: number | null;
  changePct: number;
}

export interface QuoteSummary {
  up: number;
  down: number;
  unchanged: number;
  /** Largest percent change today, or null without current quotes. */
  best: Mover | null;
  /** Smallest percent change today. Null when it would repeat `best`, as with a single quote. */
  worst: Mover | null;
}

/** Live and delayed quotes count; stale or missing ones would describe a market that has moved on. */
function isCurrent(quote: Quote | undefined): quote is Quote & { changePct: number } {
  return (
    quote !== undefined &&
    (quote.status === 'live' || quote.status === 'delayed') &&
    typeof quote.changePct === 'number' &&
    Number.isFinite(quote.changePct)
  );
}

function toMover(quote: Quote & { changePct: number }): Mover {
  return { symbol: quote.symbol, last: quote.last, change: quote.change, changePct: quote.changePct };
}

/** How many current quotes are up, down or unchanged today, and which moved most in each direction. */
export function summarizeQuotes(quotes: readonly (Quote | undefined)[]): QuoteSummary {
  const summary: QuoteSummary = { up: 0, down: 0, unchanged: 0, best: null, worst: null };
  let best: (Quote & { changePct: number }) | null = null;
  let worst: (Quote & { changePct: number }) | null = null;
  for (const quote of quotes) {
    if (!isCurrent(quote)) continue;
    const direction = changeDirection(quote.change);
    if (direction > 0) summary.up += 1;
    else if (direction < 0) summary.down += 1;
    else summary.unchanged += 1;
    if (best === null || quote.changePct > best.changePct) best = quote;
    if (worst === null || quote.changePct < worst.changePct) worst = quote;
  }
  summary.best = best && toMover(best);
  summary.worst = worst && worst !== best ? toMover(worst) : null;
  return summary;
}

/** Epoch ms of the newest market data among `quotes`: a trade, else a quote. Null when there is none. */
export function newestDataTime(quotes: readonly (Quote | undefined)[]): number | null {
  let newest: number | null = null;
  for (const quote of quotes) {
    const time = quote ? (quote.lastTradeAt ?? quote.quoteAt) : null;
    if (time !== null && (newest === null || time > newest)) newest = time;
  }
  return newest;
}
