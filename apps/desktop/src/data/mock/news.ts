import type { NewsItem } from '../../domain/types';
import type { InstrumentProfile } from './instruments';
import { createPrng, hashString } from './random';

/**
 * Simulated news. Every headline is plainly sample text about the simulated session, so nothing reads
 * as a real report about a real company. Items are stable for an hour and spread over the last two
 * days, newest first.
 */

const HOUR_MS = 60 * 60_000;
const SOURCE = 'Simulated newswire';

const TEMPLATES: readonly ((name: string, symbol: string) => { headline: string; summary: string })[] = [
  (name, symbol) => ({
    headline: `Sample headline: ${name} is active in the simulated session`,
    summary: `${symbol} trading in this prototype is generated. Real news for ${symbol} appears here once a news feed is connected.`,
  }),
  (name, symbol) => ({
    headline: `Sample article: ${symbol} volume runs above its simulated average`,
    summary: `A placeholder story about ${name}. No real event is described.`,
  }),
  (name, symbol) => ({
    headline: `Placeholder: analysts' notes on ${name} would be listed here`,
    summary: `This item shows how a news story about ${symbol} is laid out. It is not real news.`,
  }),
  (name, symbol) => ({
    headline: `Sample headline: ${symbol} moves with the simulated market`,
    summary: `${name} prices in the prototype come from a simulation, and so does this headline.`,
  }),
];

/** Up to `limit` simulated items about `profiles`, newest first, as of `now`. */
export function simulatedNews(profiles: readonly InstrumentProfile[], limit: number, now: number): NewsItem[] {
  // ** Rounding to the hour keeps the list stable between requests instead of reshuffling each call.
  const hour = Math.floor(now / HOUR_MS) * HOUR_MS;
  const items: NewsItem[] = [];
  for (const profile of profiles) {
    const rng = createPrng(hashString(`news|${profile.symbol}|${hour}`));
    const stories = 1 + Math.floor(rng.next() * 2);
    for (let story = 0; story < stories; story++) {
      const template = TEMPLATES[Math.floor(rng.next() * TEMPLATES.length)] ?? TEMPLATES[0];
      if (!template) continue;
      const { headline, summary } = template(profile.name, profile.symbol);
      const publishedAt = hour - Math.floor(rng.next() * 48) * HOUR_MS - Math.floor(rng.next() * 60) * 60_000;
      items.push({
        id: `news-${hashString(`${profile.symbol}|${hour}|${story}`).toString(36)}`,
        headline,
        summary,
        source: SOURCE,
        symbols: [profile.symbol],
        publishedAt: new Date(publishedAt).toISOString(),
        url: null,
        simulated: true,
        reason: `About ${profile.symbol}`,
      });
    }
  }
  items.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt) || a.id.localeCompare(b.id));
  return items.slice(0, limit);
}
