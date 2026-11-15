import type { MarketDataClient } from '@alpacahq/alpaca-trade-api';
import { validateSymbol } from '@aperture/shared/symbols';
import type { Article } from '../../news/newsRules.js';
import type { NewsSource } from '../../news/newsSource.js';
import { toProviderError } from './alpacaErrors.js';
import { time } from './alpacaPayloads.js';

/** Alpaca serves news in pages of at most 50. */
const PAGE_SIZE = 50;

/** How Alpaca's lower-case source names are shown. */
const PUBLISHERS: Readonly<Record<string, string>> = { benzinga: 'Benzinga' };

type Fields = Record<string, unknown>;
const fields = (value: unknown): Fields =>
  typeof value === 'object' && value !== null ? (value as Fields) : {};
const text = (value: unknown) => (typeof value === 'string' ? value.trim() : '');

/** Only http(s) links reach the app, which opens them in the system browser. */
function link(value: unknown): string | null {
  const url = text(value);
  try {
    const protocol = new URL(url).protocol;
    return protocol === 'http:' || protocol === 'https:' ? url : null;
  } catch {
    return null;
  }
}

/** Alpaca tags crypto news with compact pairs ("BTCUSD", "ETHUSDT"); the app writes them "BTC/USD". */
const COMPACT_PAIR = /^([A-Z]{2,10}?)(USDT|USDC|USD|BTC)$/;

/** A tagged symbol in the app's form, or null when neither it nor its pair reading passes the shared rules. */
function newsSymbol(value: unknown): string | null {
  const direct = validateSymbol(text(value));
  if (direct.ok) return direct.value;
  const pair = COMPACT_PAIR.exec(text(value).toUpperCase());
  if (!pair) return null;
  const result = validateSymbol(`${pair[1] ?? ''}/${pair[2] ?? ''}`);
  return result.ok ? result.value : null;
}

function publisher(value: unknown): string {
  const name = text(value);
  if (name === '') return 'Alpaca';
  return PUBLISHERS[name.toLowerCase()] ?? name.charAt(0).toUpperCase() + name.slice(1);
}

/** One Alpaca article, or null when it has no id, headline or valid time. Symbols the shared rules reject are dropped. */
function normalizeNews(raw: unknown): Article | null {
  const news = fields(raw);
  const id = typeof news.id === 'number' || typeof news.id === 'string' ? String(news.id) : '';
  const headline = text(news.headline);
  const publishedAt = time(news.createdAt);
  if (id === '' || headline === '' || publishedAt === null) return null;
  const symbols = Array.isArray(news.symbols)
    ? news.symbols.flatMap((symbol: unknown) => newsSymbol(symbol) ?? [])
    : [];
  return {
    id: `alpaca:${id}`,
    headline,
    summary: text(news.summary),
    source: publisher(news.source),
    symbols,
    publishedAt,
    url: link(news.url),
    tags: [],
  };
}

/**
 * Alpaca's news (from Benzinga on the free plan), newest first. It reads pages only until it has `limit`
 * articles, and asks for crypto pairs in Alpaca's news form ("BTCUSD").
 */
export function createAlpacaNewsSource(data: MarketDataClient): NewsSource {
  return {
    id: 'alpaca',
    async fetch({ symbols, since, limit }) {
      const articles: Article[] = [];
      let read = 0;
      try {
        for await (const raw of data.iterateNews({
          start: since,
          sort: 'desc',
          limit: PAGE_SIZE,
          symbols: symbols?.map((symbol) => symbol.replace('/', '')),
          includeContent: false,
        })) {
          read += 1;
          const article = normalizeNews(raw);
          if (article) articles.push(article);
          if (read >= limit) break;
        }
      } catch (error) {
        throw toProviderError(error);
      }
      return articles;
    },
  };
}
