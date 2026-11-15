import type { Article } from './newsRules.js';

/** Where fetched articles wait between refreshes, so requests read them instead of calling the provider. */
export interface NewsCache {
  /** The cached articles, or null when missing or expired. Never rejects. */
  get(key: string): Promise<Article[] | null>;
  /** Keeps the articles for `ttlMs`. Never rejects. */
  set(key: string, articles: Article[], ttlMs: number): Promise<void>;
}

/** Bounds memory: only a handful of keys exist (the two feed pools and recently opened stock pages). */
const MAX_ENTRIES = 50;

/** An in-process cache that drops the oldest key beyond its size. */
export class MemoryNewsCache implements NewsCache {
  private readonly entries = new Map<string, { articles: Article[]; expiresAt: number }>();
  private readonly now: () => number;

  constructor(now: () => number = Date.now) {
    this.now = now;
  }

  get(key: string): Promise<Article[] | null> {
    const entry = this.entries.get(key);
    if (!entry || entry.expiresAt <= this.now()) return Promise.resolve(null);
    return Promise.resolve(entry.articles);
  }

  set(key: string, articles: Article[], ttlMs: number): Promise<void> {
    this.entries.delete(key);
    this.entries.set(key, { articles, expiresAt: this.now() + ttlMs });
    while (this.entries.size > MAX_ENTRIES) {
      const oldest = this.entries.keys().next();
      if (oldest.done === true) break;
      this.entries.delete(oldest.value);
    }
    return Promise.resolve();
  }
}
