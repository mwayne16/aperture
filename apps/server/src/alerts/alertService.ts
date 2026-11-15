import { normalizeNote } from '@aperture/shared/alertRules';
import type { PriceAlert } from '@aperture/shared/alerts';
import { normalizeSymbol } from '@aperture/shared/symbols';
import { randomUUID } from 'node:crypto';
import type { DataSource } from 'typeorm';
import { nextUpdatedAt } from '../db/updatedAt.js';
import { ApiHttpError } from '../http/errors.js';
import type { CreateAlertBody, UpdateAlertBody } from './alertDtos.js';
import { AlertEntity } from './alertEntity.js';

const notFound = (): ApiHttpError => new ApiHttpError('NOT_FOUND', 'Alert not found.');

/** Price alert management. Evaluating alerts against prices is not part of this service. */
export class AlertService {
  private readonly dataSource: DataSource;
  private readonly now: () => Date;
  private readonly onChange: () => void;

  /** `onChange` runs after each committed change, e.g. so live prices follow enabled alerts. */
  constructor(
    dataSource: DataSource,
    now: () => Date = () => new Date(),
    onChange: () => void = () => undefined,
  ) {
    this.dataSource = dataSource;
    this.now = now;
    this.onChange = onChange;
  }

  /** Oldest first. */
  async list(): Promise<PriceAlert[]> {
    const rows = await this.dataSource.manager.find(AlertEntity, { order: { createdAt: 'ASC', id: 'ASC' } });
    return rows.map(toPriceAlert);
  }

  /** A new alert starts armed and, unless the input says otherwise, enabled. */
  async create(input: CreateAlertBody): Promise<PriceAlert> {
    const now = this.now();
    const alert = this.dataSource.manager.create(AlertEntity, {
      id: randomUUID(),
      symbol: normalizeSymbol(input.symbol),
      condition: input.condition,
      targetPrice: input.targetPrice,
      tag: input.tag,
      field: 'last',
      enabled: input.enabled ?? true,
      armed: true,
      note: normalizeNote(input.note),
      createdAt: now,
      updatedAt: now,
      lastTriggeredAt: null,
      lastTriggeredPrice: null,
      triggerCount: 0,
    });
    await this.dataSource.manager.insert(AlertEntity, alert);
    this.onChange();
    return toPriceAlert(alert);
  }

  /**
   * Applies the fields present in `input`. Changing the condition or target price, or enabling a
   * disabled alert, re-arms it. A request that changes nothing leaves updatedAt alone.
   */
  async update(id: string, input: UpdateAlertBody): Promise<PriceAlert> {
    const updated = await this.dataSource.transaction(async (manager) => {
      const current = await manager.findOne(AlertEntity, {
        where: { id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!current) throw notFound();

      const next = {
        condition: input.condition ?? current.condition,
        targetPrice: input.targetPrice ?? current.targetPrice,
        tag: input.tag ?? current.tag,
        enabled: input.enabled ?? current.enabled,
        note: input.note === undefined ? current.note : normalizeNote(input.note),
        armed: current.armed,
      };
      const rearm =
        next.condition !== current.condition ||
        next.targetPrice !== current.targetPrice ||
        (next.enabled && !current.enabled);
      if (rearm) next.armed = true;

      const fields = Object.keys(next) as (keyof typeof next)[];
      if (fields.every((field) => next[field] === current[field])) return toPriceAlert(current);
      const changes = { ...next, updatedAt: nextUpdatedAt(this.now(), current.updatedAt) };
      await manager.update(AlertEntity, id, changes);
      return toPriceAlert(Object.assign(current, changes));
    });
    this.onChange();
    return updated;
  }

  /** Rejects with NOT_FOUND when no alert has this id. */
  async delete(id: string): Promise<void> {
    const result = await this.dataSource.manager.delete(AlertEntity, id);
    if (result.affected === 0) throw notFound();
    this.onChange();
  }
}

function toPriceAlert(alert: AlertEntity): PriceAlert {
  return {
    id: alert.id,
    symbol: alert.symbol,
    condition: alert.condition,
    targetPrice: alert.targetPrice,
    tag: alert.tag,
    field: alert.field,
    enabled: alert.enabled,
    armed: alert.armed,
    note: alert.note,
    createdAt: alert.createdAt.toISOString(),
    updatedAt: alert.updatedAt.toISOString(),
    lastTriggeredAt: alert.lastTriggeredAt?.toISOString() ?? null,
    lastTriggeredPrice: alert.lastTriggeredPrice,
    triggerCount: alert.triggerCount,
  };
}
