/**
 * A small in-memory cache whose entries expire, holding at most `maxEntries` (the oldest go first).
 * Callers store promises, so concurrent requests for the same key share one provider call; a rejected
 * promise is dropped so the next request tries again.
 */
export class TtlCache<V> {
  private readonly entries = new Map<string, { value: Promise<V>; expiresAt: number }>();
  private readonly maxEntries: number;
  private readonly now: () => number;

  constructor(maxEntries: number, now: () => number) {
    this.maxEntries = maxEntries;
    this.now = now;
  }

  /** The cached value for `key`, or the result of `load`, which is then kept for `ttlMs`. */
  get(key: string, ttlMs: number, load: () => Promise<V>): Promise<V> {
    const cached = this.entries.get(key);
    if (cached && cached.expiresAt > this.now()) return cached.value;
    this.entries.delete(key);
    const value = load();
    this.entries.set(key, { value, expiresAt: this.now() + ttlMs });
    value.catch(() => {
      if (this.entries.get(key)?.value === value) this.entries.delete(key);
    });
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next();
      if (oldest.done === true) break;
      this.entries.delete(oldest.value);
    }
    return value;
  }
}
