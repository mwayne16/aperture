import type { RedisConnection } from '../redis/redisConnection.js';
import { MemoryNewsCache, type NewsCache } from './newsCache.js';
import type { Article } from './newsRules.js';

/** Our own cached data, but read back from outside the process, so its shape is checked before use. */
function isArticle(value: unknown): value is Article {
  if (typeof value !== 'object' || value === null) return false;
  const article = value as Record<string, unknown>;
  return (
    typeof article.id === 'string' &&
    typeof article.headline === 'string' &&
    typeof article.summary === 'string' &&
    typeof article.source === 'string' &&
    Array.isArray(article.symbols) &&
    article.symbols.every((symbol) => typeof symbol === 'string') &&
    typeof article.publishedAt === 'number' &&
    (article.url === null || typeof article.url === 'string') &&
    Array.isArray(article.tags)
  );
}

function parse(raw: string): Article[] | null {
  try {
    const value: unknown = JSON.parse(raw);
    return Array.isArray(value) && value.every(isArticle) ? value : null;
  } catch {
    return null;
  }
}

/**
 * News kept in Redis, so a restart within the cache's lifetime doesn't fetch again, with a copy in memory.
 * When Redis is down or fails a command, the memory copy answers instead, so an outage never fails or
 * slows a news request.
 */
export class RedisNewsCache implements NewsCache {
  private readonly redis: RedisConnection;
  private readonly memory: NewsCache;

  constructor(redis: RedisConnection, memory: NewsCache = new MemoryNewsCache()) {
    this.redis = redis;
    this.memory = memory;
  }

  async get(key: string): Promise<Article[] | null> {
    if (this.redis.ready) {
      const raw = await this.redis.get(key).catch(() => null);
      const articles = raw === null ? null : parse(raw);
      if (articles !== null) return articles;
    }
    return this.memory.get(key);
  }

  async set(key: string, articles: Article[], ttlMs: number): Promise<void> {
    await this.memory.set(key, articles, ttlMs);
    if (this.redis.ready) await this.redis.set(key, JSON.stringify(articles), ttlMs).catch(() => undefined);
  }
}
