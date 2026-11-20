import { evaluateAlert } from '@aperture/shared/alertEngine';
import type { AlertEvent, PriceAlert } from '@aperture/shared/alerts';
import type { FastifyBaseLogger } from 'fastify';
import { randomUUID } from 'node:crypto';
import type { DataSource } from 'typeorm';
import { describeDatabaseError } from '../db/errors.js';
import { AlertEntity } from './alertEntity.js';
import { AlertEventEntity } from './alertEventEntity.js';
import { toAlertEvent, toPriceAlert } from './alertMappers.js';

/** Trigger history rows kept; older ones are deleted as new ones arrive. */
export const MAX_STORED_EVENTS = 1_000;

interface Watched {
  alert: AlertEntity;
  /** A price that arrived while this alert's last change was being saved; only the newest is kept. */
  pending: number | null;
  saving: boolean;
}

/**
 * Evaluates enabled alerts against every new trade price, on the server, with the shared alert engine.
 * Alerts are cached in memory, so a price that changes nothing costs no database work. When a price fires
 * or re-arms an alert, the change is saved with a conditional update that only applies if the alert is
 * still enabled, unchanged and in the state the price was evaluated against. A user's edit in between, a
 * second price for the same crossing, or a restart therefore can't fire the alert twice. Listeners hear
 * about a change only once it is saved.
 */
export class AlertMonitor {
  private readonly dataSource: DataSource;
  private readonly log: Pick<FastifyBaseLogger, 'info' | 'warn'>;
  private readonly now: () => Date;
  private readonly bySymbol = new Map<string, Map<string, Watched>>();
  private readonly triggeredListeners = new Set<(event: AlertEvent) => void>();
  private readonly updatedListeners = new Set<(alert: PriceAlert) => void>();
  private loaded = false;
  private reloading: Promise<void> | null = null;
  private reloadRequests = 0;
  private saveFailure: string | null = null;

  constructor(
    dataSource: DataSource,
    log: Pick<FastifyBaseLogger, 'info' | 'warn'>,
    now: () => Date = () => new Date(),
  ) {
    this.dataSource = dataSource;
    this.log = log;
    this.now = now;
  }

  /** Calls `listener` once per trigger, after the trigger is saved. Returns a function that removes it. */
  onTriggered(listener: (event: AlertEvent) => void): () => void {
    this.triggeredListeners.add(listener);
    return () => this.triggeredListeners.delete(listener);
  }

  /** Calls `listener` with an alert's saved state after it fired or re-armed. Returns a function that removes it. */
  onUpdated(listener: (alert: PriceAlert) => void): () => void {
    this.updatedListeners.add(listener);
    return () => this.updatedListeners.delete(listener);
  }

  /**
   * Reloads the enabled alerts from the database. Calls made while a reload runs are folded into one more
   * run. Never rejects: on failure the current alerts stay in use.
   */
  reload(): Promise<void> {
    this.reloadRequests += 1;
    if (this.reloading !== null) return this.reloading;
    this.reloading = (async () => {
      let handled: number;
      do {
        handled = this.reloadRequests;
        try {
          const alerts = await this.dataSource.manager.find(AlertEntity, { where: { enabled: true } });
          this.replaceAll(alerts);
          this.loaded = true;
        } catch (error) {
          this.log.warn(
            { reason: describeDatabaseError(error) },
            'Could not load alerts; keeping the current ones',
          );
        }
      } while (handled !== this.reloadRequests);
    })().finally(() => {
      this.reloading = null;
    });
    return this.reloading;
  }

  /** Evaluates the symbol's enabled alerts against a new trade price. Saving happens in the background. */
  evaluate(symbol: string, price: number): void {
    if (!this.loaded) return;
    const watched = this.bySymbol.get(symbol);
    if (!watched) return;
    for (const entry of watched.values()) this.check(entry, price);
  }

  /**
   * Waits for every save in progress, so tests and shutdown see a settled state. Gives up after `timeoutMs`,
   * so a hung database can't hold up shutdown.
   */
  async settled(timeoutMs = 5_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (
      Date.now() < deadline &&
      [...this.bySymbol.values()].some((entries) => [...entries.values()].some((entry) => entry.saving))
    ) {
      await new Promise((resolve) => setImmediate(resolve));
    }
  }

  private check(entry: Watched, price: number): void {
    if (entry.saving) {
      // ** Prices arriving during a save wait for it; only the newest one still matters.
      entry.pending = price;
      return;
    }
    const result = evaluateAlert(entry.alert, price);
    if (!result.triggered && result.armed === entry.alert.armed) return;
    entry.saving = true;
    void this.save(entry, price, result.triggered, result.armed).finally(() => {
      entry.saving = false;
      const next = entry.pending;
      entry.pending = null;
      if (next !== null && this.isCurrent(entry)) this.check(entry, next);
    });
  }

  /** Saves a trigger or re-arm if the alert is still as evaluated, then tells the listeners. */
  private async save(entry: Watched, price: number, triggered: boolean, armed: boolean): Promise<void> {
    const before = entry.alert;
    const at = this.now();
    const reloadsBefore = this.reloadRequests;
    try {
      const outcome = await this.dataSource.transaction(async (manager) => {
        const changes: Record<string, unknown> = {
          armed,
          updatedAt: () => `GREATEST(CAST(:at AS timestamptz), "updated_at" + interval '1 millisecond')`,
        };
        if (triggered) {
          changes.lastTriggeredAt = at;
          changes.lastTriggeredPrice = price;
          changes.triggerCount = () => '"trigger_count" + 1';
        }
        const result = await manager
          .createQueryBuilder()
          .update(AlertEntity)
          .set(changes)
          .where(
            '"id" = :id AND "enabled" = true AND "armed" = :armedBefore AND "condition" = :condition AND "target_price" = :targetPrice',
            {
              id: before.id,
              armedBefore: before.armed,
              condition: before.condition,
              targetPrice: before.targetPrice,
            },
          )
          .setParameters({ at })
          .execute();
        if (result.affected === 0) return null;
        let event: AlertEventEntity | null = null;
        if (triggered) {
          event = manager.create(AlertEventEntity, {
            id: randomUUID(),
            alertId: before.id,
            symbol: before.symbol,
            condition: before.condition,
            targetPrice: before.targetPrice,
            tag: before.tag,
            field: before.field,
            price,
            triggeredAt: at,
          });
          await manager.insert(AlertEventEntity, event);
        }
        return { alert: await manager.findOneByOrFail(AlertEntity, { id: before.id }), event };
      });
      if (this.saveFailure !== null) this.log.info('Saving alert changes works again');
      this.saveFailure = null;
      if (outcome === null) {
        // ** The alert changed since it was cached (an edit, or another price got there first).
        await this.refreshOne(before.id);
        return;
      }
      if (this.isCurrent(entry)) entry.alert = outcome.alert;
      // ** A user's edit during the save was reloaded around this entry, so read the alert again.
      if (this.reloadRequests !== reloadsBefore) await this.refreshOne(before.id);
      this.notify(this.updatedListeners, toPriceAlert(outcome.alert));
      if (outcome.event) {
        this.log.info(
          { alertId: before.id, symbol: before.symbol, price, condition: before.condition },
          'Alert triggered',
        );
        this.notify(this.triggeredListeners, toAlertEvent(outcome.event));
        await this.prune();
      }
    } catch (error) {
      const reason = describeDatabaseError(error);
      // ** While the database is down every crossing would log the same warning.
      if (reason !== this.saveFailure)
        this.log.warn({ reason }, 'Could not save an alert change; it will be tried on the next price');
      this.saveFailure = reason;
    }
  }

  private notify<T>(listeners: ReadonlySet<(value: T) => void>, value: T): void {
    for (const listener of listeners) {
      try {
        listener(value);
      } catch {
        // ** A failing listener must not stop the others, and the change is already saved.
        this.log.warn('An alert listener failed');
      }
    }
  }

  /** Reloads one alert after a conditional save found it changed. */
  private async refreshOne(id: string): Promise<void> {
    const alert = await this.dataSource.manager.findOneBy(AlertEntity, { id }).catch(() => undefined);
    if (alert === undefined) return;
    this.remove(id);
    if (alert?.enabled) this.add(alert);
  }

  /** Deletes the oldest trigger rows beyond the limit. Best effort: the history is a log, not state. */
  private async prune(): Promise<void> {
    await this.dataSource
      .query(
        `DELETE FROM "alert_events" WHERE "id" IN (
           SELECT "id" FROM "alert_events" ORDER BY "triggered_at" DESC, "id" DESC OFFSET $1
         )`,
        [MAX_STORED_EVENTS],
      )
      .catch(() => undefined);
  }

  private replaceAll(alerts: readonly AlertEntity[]): void {
    const saving = new Map<string, Watched>();
    for (const entries of this.bySymbol.values()) {
      for (const [id, entry] of entries) if (entry.saving) saving.set(id, entry);
    }
    this.bySymbol.clear();
    for (const alert of alerts) {
      // ** An alert mid-save keeps its entry, so the save's result and its waiting price aren't lost.
      const inFlight = saving.get(alert.id);
      if (inFlight) this.entries(alert.symbol).set(alert.id, inFlight);
      else this.add(alert);
    }
  }

  private add(alert: AlertEntity): void {
    this.entries(alert.symbol).set(alert.id, { alert, pending: null, saving: false });
  }

  private remove(id: string): void {
    for (const [symbol, entries] of this.bySymbol) {
      entries.delete(id);
      if (entries.size === 0) this.bySymbol.delete(symbol);
    }
  }

  private entries(symbol: string): Map<string, Watched> {
    let entries = this.bySymbol.get(symbol);
    if (!entries) {
      entries = new Map();
      this.bySymbol.set(symbol, entries);
    }
    return entries;
  }

  /** False once the alert was disabled, deleted or reloaded under a new entry. */
  private isCurrent(entry: Watched): boolean {
    return this.bySymbol.get(entry.alert.symbol)?.get(entry.alert.id) === entry;
  }
}
