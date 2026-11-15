import type { NewsItem } from '@aperture/shared/news';

/**
 * The news feed's filtering, de-duplication, scoring and assembly (plan section 2.6), as pure functions.
 * The weights are starting values to tune against real data; they all live in NEWS_WEIGHTS.
 */

export const NEWS_WEIGHTS = {
  /** Articles older than this are dropped. */
  windowHours: 48,
  /** Headlines this similar (word-set Jaccard), published this close together, are one story. */
  duplicateSimilarity: 0.8,
  duplicateWindowHours: 6,
  symbolScore: { match: 0.4, move: 0.25, volume: 0.2, event: 0.15 },
  /** A day's move of this many percent or more scores in full. */
  moveCapPct: 5,
  /** Volume this many times above normal (beyond 1x) scores in full. */
  volumeExcessCap: 2,
  recencyHalfLifeHours: 6,
  coverageBonusPerSource: 0.1,
  coverageBonusMaxSources: 3,
  impact: { coverage: 0.4, macro: 0.3, active: 0.3 },
  /** Coverage by this many sources gives the full coverage part of a market story's impact. */
  fullImpactCoverage: 4,
  /** No symbol takes more than this many of the first `capWindow` places. */
  perSymbolCap: 3,
  capWindow: 10,
  /** Weight per publisher (lower-case), between 0.5 and 1. Unlisted publishers weigh 1. */
  sourceWeights: {} as Readonly<Record<string, number>>,
} as const;

/** An article as a news source delivers it, already checked at the boundary. */
export interface Article {
  /** Namespaced by source, e.g. "alpaca:123", so ids never collide across sources. */
  id: string;
  headline: string;
  summary: string;
  /** Publisher, e.g. "Benzinga". */
  source: string;
  /** Symbols as the provider tagged them, upper-case. */
  symbols: string[];
  /** Epoch ms. */
  publishedAt: number;
  /** An http(s) link, or null. */
  url: string | null;
  /** The provider's category tags, when it sends any. */
  tags: string[];
}

/** One story after de-duplication: the most complete article of its group, with the group's symbols and reach. */
export interface Story extends Article {
  /** How many distinct publishers carried the story. */
  coverage: number;
}

/** Market conditions that make a story more relevant. Any value may be missing; it then scores 0. */
export interface MarketInputs {
  /** Today's percent change per symbol, e.g. 1.25 for +1.25%. */
  changePct: ReadonlyMap<string, number>;
  /** Today's volume over the 20-day average daily volume, from the same feed. */
  volumeRatio: ReadonlyMap<string, number>;
  /** Symbols on today's most-active list. */
  mostActive: ReadonlySet<string>;
  /** Company names, for recognizing a story about a company by its headline. */
  names: ReadonlyMap<string, string>;
}

export const NO_MARKET_INPUTS: MarketInputs = {
  changePct: new Map(),
  volumeRatio: new Map(),
  mostActive: new Set(),
  names: new Map(),
};

const HOUR_MS = 3_600_000;

/** Crypto pairs are "BTC/USD" here but "BTCUSD" in news tags, so symbols are compared without the slash. */
export const symbolKey = (symbol: string) => symbol.replace('/', '').toUpperCase();

const TRACKING_PARAM = /^(utm_[a-z]+|fbclid|gclid|mc_cid|mc_eid|cmpid|ocid)$/i;

/** The URL without tracking parameters, fragment or trailing slash, host lower-cased; null if it isn't http(s). */
export function canonicalUrl(url: string | null): string | null {
  if (url === null) return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
  for (const name of [...parsed.searchParams.keys()]) {
    if (TRACKING_PARAM.test(name)) parsed.searchParams.delete(name);
  }
  parsed.searchParams.sort();
  const path = parsed.pathname.replace(/\/+$/, '');
  const query = parsed.searchParams.toString();
  return `${parsed.protocol}//${parsed.host.toLowerCase()}${path}${query === '' ? '' : `?${query}`}`;
}

function words(headline: string): Set<string> {
  return new Set(
    headline
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((word) => word !== ''),
  );
}

/** Word-set Jaccard similarity of two headlines; 0 when either has no words. */
export function headlineSimilarity(a: string, b: string): number {
  const left = words(a);
  const right = words(b);
  if (left.size === 0 || right.size === 0) return 0;
  let shared = 0;
  for (const word of left) if (right.has(word)) shared += 1;
  return shared / (left.size + right.size - shared);
}

/** Headlines of paid or promotional pieces, which add noise rather than news. */
const PROMOTIONAL = /\b(sponsored|advertorial|paid (post|content|promotion)|press release)\b/i;

/** Keeps articles with a headline, published within the window and not in the future, that aren't promotional. */
export function filterArticles(articles: readonly Article[], now: number): Article[] {
  const oldest = now - NEWS_WEIGHTS.windowHours * HOUR_MS;
  return articles.filter(
    (article) =>
      article.headline.trim() !== '' &&
      article.publishedAt <= now &&
      article.publishedAt >= oldest &&
      !PROMOTIONAL.test(article.headline) &&
      !article.tags.some((tag) => PROMOTIONAL.test(tag)),
  );
}

function isDuplicate(a: Article, b: Article): boolean {
  const urlA = canonicalUrl(a.url);
  if (urlA !== null && urlA === canonicalUrl(b.url)) return true;
  const close = Math.abs(a.publishedAt - b.publishedAt) <= NEWS_WEIGHTS.duplicateWindowHours * HOUR_MS;
  return close && headlineSimilarity(a.headline, b.headline) >= NEWS_WEIGHTS.duplicateSimilarity;
}

/** Higher for an article with more to show: a summary, a link, tagged symbols. */
const completeness = (article: Article) =>
  (article.summary.trim() === '' ? 0 : 2) +
  (article.url === null ? 0 : 1) +
  (article.symbols.length > 0 ? 1 : 0);

/**
 * Groups duplicates (same canonical URL, or near-identical headlines within six hours) and keeps one story
 * per group: the most complete article, then the earliest, then the lowest id. Its symbols become the
 * group's, and coverage counts the group's distinct publishers. The grouping is transitive, so the result
 * doesn't depend on input order.
 */
export function dedupe(articles: readonly Article[]): Story[] {
  const sorted = [...articles].sort((a, b) => a.publishedAt - b.publishedAt || a.id.localeCompare(b.id));
  const parent = sorted.map((_, index) => index);
  const root = (index: number): number => {
    let current = index;
    while (parent[current] !== current) current = parent[current] ?? current;
    return current;
  };
  for (let i = 0; i < sorted.length; i++) {
    for (let j = i + 1; j < sorted.length; j++) {
      const a = sorted[i];
      const b = sorted[j];
      if (a && b && isDuplicate(a, b)) parent[root(j)] = root(i);
    }
  }
  const groups = new Map<number, Article[]>();
  sorted.forEach((article, index) => {
    const key = root(index);
    groups.set(key, [...(groups.get(key) ?? []), article]);
  });
  return [...groups.values()].map((group) => {
    const best = group.reduce((kept, article) =>
      completeness(article) > completeness(kept) ? article : kept,
    );
    const symbols = [...new Set(group.flatMap((article) => article.symbols))].sort();
    const coverage = new Set(group.map((article) => article.source.trim().toLowerCase())).size;
    return { ...best, symbols, coverage };
  });
}

const EVENT_TAG =
  /\b(earnings|guidance|m&a|mergers?|acquisitions?|analyst ratings?|upgrades?|downgrades?|legal|regulatory|halts?)\b/i;
const EVENT_HEADLINE = new RegExp(
  [
    String.raw`\bearnings\b`,
    String.raw`\beps\b`,
    String.raw`\bq[1-4]\b.*\b(results|revenue|sales)\b`,
    String.raw`\b(raises|cuts|lowers|reaffirms|issues)\b.*\b(guidance|outlook|forecast)\b`,
    String.raw`\bguidance\b`,
    String.raw`\b(acquire|acquires|acquisition|merger|merge|buyout|takeover|to buy)\b`,
    String.raw`\b(upgrades?|downgrades?|upgraded|downgraded|price target|initiates coverage|reiterates)\b`,
    String.raw`\b(sec|fda|ftc|doj|antitrust|lawsuit|sued|probe|investigation|settlement|recall)\b`,
    String.raw`\b(trading halt|halted)\b`,
  ].join('|'),
  'i',
);
const COMMENTARY =
  /\b(stocks? to watch|market (wrap|recap|update)|what to (know|watch)|top \d+|week ahead|preview)\b/i;

/** 1 for a market-moving event, 0.5 for other company news, 0 for general commentary. Tags first, then keywords. */
export function eventWeight(story: Article): number {
  if (story.tags.some((tag) => EVENT_TAG.test(tag))) return 1;
  if (EVENT_HEADLINE.test(story.headline)) return 1;
  if (story.symbols.length === 0 || COMMENTARY.test(story.headline)) return 0;
  return 0.5;
}

const MACRO = new RegExp(
  [
    String.raw`\b(fed|federal reserve|fomc|powell)\b`,
    String.raw`\b(interest rates?|rate (cut|hike)s?)\b`,
    String.raw`\b(inflation|cpi|ppi|pce)\b`,
    String.raw`\b(jobs report|nonfarm|payrolls|unemployment|jobless claims|gdp)\b`,
    String.raw`\b(s&p 500|nasdaq composite|dow jones|russell 2000|treasury yields?)\b`,
    String.raw`\bearnings season\b`,
  ].join('|'),
  'i',
);

/** True for broad-market topics: rates and the Fed, inflation and jobs data, index moves, earnings season. */
export const isMacro = (story: Article) => MACRO.test(`${story.headline} ${story.summary}`);

const NAME_SUFFIX =
  /[,.]?\s+(inc|incorporated|corp|corporation|co|company|holdings?|group|ltd|limited|plc|sa|nv|ag|class [a-z]|common stock|ordinary shares)\.?$/i;

/** "Apple Inc. Common Stock" becomes "Apple", for spotting a company in a headline. */
function shortName(name: string): string {
  let short = name.trim();
  for (let previous = ''; previous !== short;) {
    previous = short;
    short = short.replace(NAME_SUFFIX, '').trim();
  }
  return short;
}

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);

/** A symbol is a primary subject when the headline names its ticker or company, or the story tags at most two symbols. */
function isPrimary(story: Story, symbol: string, inputs: MarketInputs): boolean {
  if (story.symbols.length <= 2) return true;
  if (new RegExp(String.raw`\b${escape(symbolKey(symbol))}\b`).test(story.headline)) return true;
  const name = inputs.names.get(symbol);
  const short = name === undefined ? '' : shortName(name);
  return short.length >= 3 && new RegExp(String.raw`\b${escape(short)}\b`, 'i').test(story.headline);
}

/** How strongly a story concerns one watched symbol, from 0 to 1. */
export function symbolScore(story: Story, symbol: string, inputs: MarketInputs): number {
  const weights = NEWS_WEIGHTS.symbolScore;
  const match = isPrimary(story, symbol, inputs) ? 1 : 0.5;
  const move = Math.min(Math.abs(inputs.changePct.get(symbol) ?? 0) / NEWS_WEIGHTS.moveCapPct, 1);
  const ratio = inputs.volumeRatio.get(symbol) ?? 1;
  const volume = Math.min(Math.max(ratio - 1, 0) / NEWS_WEIGHTS.volumeExcessCap, 1);
  return (
    weights.match * match + weights.move * move + weights.volume * volume + weights.event * eventWeight(story)
  );
}

/** The watched symbols a story covers, in watch order. */
function coveredSymbols(story: Story, watched: readonly string[]): string[] {
  const tagged = new Set(story.symbols.map(symbolKey));
  return watched.filter((symbol) => tagged.has(symbolKey(symbol)));
}

const recency = (story: Story, now: number) =>
  0.5 ** (Math.max(0, now - story.publishedAt) / HOUR_MS / NEWS_WEIGHTS.recencyHalfLifeHours);

function sourceWeight(story: Story): number {
  const weight = NEWS_WEIGHTS.sourceWeights[story.source.trim().toLowerCase()] ?? 1;
  return Math.min(Math.max(weight, 0.5), 1);
}

const coverageBonus = (story: Story) =>
  NEWS_WEIGHTS.coverageBonusPerSource * Math.min(story.coverage - 1, NEWS_WEIGHTS.coverageBonusMaxSources);

interface Ranked {
  story: Story;
  score: number;
  /** The watched symbol the story is most about, or null for a market story. */
  about: string | null;
}

/** Highest score first, then newest, then by id, so the order is stable between refreshes. */
const byRank = (a: Ranked, b: Ranked) =>
  b.score - a.score || b.story.publishedAt - a.story.publishedAt || a.story.id.localeCompare(b.story.id);

function rankForWatchlist(
  story: Story,
  watched: readonly string[],
  inputs: MarketInputs,
  now: number,
): Ranked | null {
  let best: { symbol: string; score: number } | null = null;
  for (const symbol of coveredSymbols(story, watched)) {
    const score = symbolScore(story, symbol, inputs);
    if (best === null || score > best.score) best = { symbol, score };
  }
  if (best === null) return null;
  return {
    story,
    score: best.score * recency(story, now) * sourceWeight(story) + coverageBonus(story),
    about: best.symbol,
  };
}

function rankForMarket(story: Story, inputs: MarketInputs, now: number): Ranked {
  const weights = NEWS_WEIGHTS.impact;
  const active = story.symbols.some((symbol) => inputs.mostActive.has(symbolKey(symbol))) ? 1 : 0;
  const impact =
    weights.coverage * Math.min(story.coverage / NEWS_WEIGHTS.fullImpactCoverage, 1) +
    weights.macro * (isMacro(story) ? 1 : 0) +
    weights.active * active;
  return {
    story,
    score: impact * recency(story, now) * sourceWeight(story) + coverageBonus(story),
    about: null,
  };
}

/** Splits ranked watchlist stories into those allowed in the first places (each symbol up to its cap) and the overflow. */
function capPerSymbol(ranked: readonly Ranked[]): { top: Ranked[]; rest: Ranked[] } {
  const top: Ranked[] = [];
  const rest: Ranked[] = [];
  const counts = new Map<string, number>();
  for (const entry of ranked) {
    const key = entry.about ?? '';
    const count = counts.get(key) ?? 0;
    if (top.length < NEWS_WEIGHTS.capWindow && count < NEWS_WEIGHTS.perSymbolCap) {
      top.push(entry);
      counts.set(key, count + 1);
    } else {
      rest.push(entry);
    }
  }
  return { top, rest };
}

/** A story in the API's shape. Symbols tagged in news form ("BTCUSD") show as the watched pair ("BTC/USD"). */
function toNewsItem(story: Story, reason: string, watched: readonly string[]): NewsItem {
  const display = new Map(watched.map((symbol) => [symbolKey(symbol), symbol]));
  return {
    id: story.id,
    headline: story.headline,
    summary: story.summary,
    source: story.source,
    symbols: story.symbols.map((symbol) => display.get(symbolKey(symbol)) ?? symbol),
    publishedAt: new Date(story.publishedAt).toISOString(),
    url: story.url,
    simulated: false,
    reason,
  };
}

/**
 * The dashboard feed: stories about watched symbols ranked by watchlist relevance, then market stories ranked
 * by impact, cut to `limit`. One symbol takes at most 3 of the first 10 places: when the cap leaves places
 * free, market stories fill them before the watchlist's overflow. An empty watchlist gives market stories
 * alone, and a quiet watchlist is topped up by them. Each story says why it is there.
 */
export function assembleFeed(
  stories: readonly Story[],
  watched: readonly string[],
  inputs: MarketInputs,
  now: number,
  limit: number,
): NewsItem[] {
  const aboutWatchlist = stories
    .map((story) => rankForWatchlist(story, watched, inputs, now))
    .filter((entry): entry is Ranked => entry !== null)
    .sort(byRank);
  const taken = new Set(aboutWatchlist.map((entry) => entry.story.id));
  const market = stories
    .filter((story) => !taken.has(story.id))
    .map((story) => rankForMarket(story, inputs, now))
    .sort(byRank);
  const { top, rest } = capPerSymbol(aboutWatchlist);
  const fill = market.slice(0, Math.max(0, NEWS_WEIGHTS.capWindow - top.length));
  return [...top, ...fill, ...rest, ...market.slice(fill.length)]
    .slice(0, limit)
    .map((entry) =>
      toNewsItem(entry.story, entry.about === null ? 'Top market story' : `About ${entry.about}`, watched),
    );
}

/** News for a stock page: stories about any of `symbols`, newest first. */
export function storiesAbout(
  stories: readonly Story[],
  symbols: readonly string[],
  limit: number,
): NewsItem[] {
  return stories
    .flatMap((story) => {
      const about = coveredSymbols(story, symbols)[0];
      return about === undefined ? [] : [{ story, about }];
    })
    .sort((a, b) => b.story.publishedAt - a.story.publishedAt || a.story.id.localeCompare(b.story.id))
    .slice(0, limit)
    .map(({ story, about }) => toNewsItem(story, `About ${about}`, symbols));
}
