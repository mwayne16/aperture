import type { FastifyBaseLogger } from 'fastify';
import { createClient } from 'redis';

/** Reconnect attempts after a drop before the client stops trying (the server tries again later). */
const MAX_ATTEMPTS = 10;
/** A connection that stopped retrying is tried again after this long. */
const REDIS_RECOVERY_DELAY_MS = 5 * 60_000;

type Log = Pick<FastifyBaseLogger, 'info' | 'warn'>;

/** The reason in a Redis error, without anything else the error object carries. */
const reason = (error: unknown) =>
  error instanceof Error && error.message !== '' ? error.message : 'Unknown error';

/**
 * The server's Redis connection. Redis only holds caches, so the server runs without it: commands fail at
 * once while it is down (no offline queue), and callers fall back to memory. It reconnects with backoff,
 * then stops after 10 attempts and tries again every five minutes. Going down and coming back are each
 * logged once, by message only, so the URL never reaches the log.
 */
export class RedisConnection {
  private readonly client;
  private log: Log | null = null;
  private down = false;
  private recovery: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;

  constructor(url: string, options: { maxAttempts?: number; recoveryDelayMs?: number } = {}) {
    const maxAttempts = options.maxAttempts ?? MAX_ATTEMPTS;
    const recoveryDelayMs = options.recoveryDelayMs ?? REDIS_RECOVERY_DELAY_MS;
    this.client = createClient({
      url,
      disableOfflineQueue: true,
      socket: {
        connectTimeout: 3_000,
        reconnectStrategy: (retries) =>
          retries >= maxAttempts ? false : Math.min(250 * 2 ** retries, 10_000),
      },
    });
    // ** Without an error listener, the client's errors would crash the process.
    this.client.on('error', (error: unknown) => {
      this.wentDown(error);
    });
    this.client.on('ready', () => {
      if (this.down) this.log?.info('Redis is back');
      this.down = false;
    });
    this.client.on('terminated', () => {
      if (this.stopped || this.recovery !== null) return;
      this.recovery = setTimeout(() => {
        this.recovery = null;
        this.connect();
      }, recoveryDelayMs);
    });
  }

  /** True while commands can be sent. */
  get ready(): boolean {
    return this.client.isReady;
  }

  /** Connects in the background. Never throws; failures are logged once and retried. */
  start(log: Log): void {
    this.log = log;
    this.connect();
  }

  async get(key: string): Promise<string | null> {
    return await this.client.get(key);
  }

  async set(key: string, value: string, ttlMs: number): Promise<void> {
    await this.client.set(key, value, { expiration: { type: 'PX', value: ttlMs } });
  }

  async close(): Promise<void> {
    this.stopped = true;
    if (this.recovery !== null) clearTimeout(this.recovery);
    this.recovery = null;
    if (this.client.isOpen) await this.client.close().catch(() => undefined);
  }

  private connect(): void {
    if (this.stopped || this.client.isOpen) return;
    this.client.connect().catch((error: unknown) => {
      this.wentDown(error);
    });
  }

  private wentDown(error: unknown): void {
    if (this.down || this.stopped) return;
    this.down = true;
    this.log?.warn({ reason: reason(error) }, 'Redis is unavailable; caching in memory until it is back');
  }
}
