import { create } from 'zustand';
import type { AlertEvent, CreateAlertInput, PriceAlert, UpdateAlertInput } from '../../domain/types';

export type LoadStatus = 'idle' | 'loading' | 'ready' | 'error';

/** Max trigger events kept in memory for the log. */
export const MAX_ALERT_EVENTS = 50;

/**
 * Alert state backed by `api` (CRUD) and `realtime` (server-side evaluation results).
 * Implemented by the alerts task.
 *
 * - load() never rejects: a failure sets status 'error' and `error`. A call while a load is in
 *   flight returns that load instead of starting another.
 * - create and update reject with ApiError so the dialog can show errors inline.
 * - setEnabled and remove are optimistic with rollback + error toast on failure.
 * - applyServerUpdate merges an alert pushed by the backend; it ignores updates whose updatedAt is
 *   older than the stored one, and ignores ids it doesn't know about unless loaded.
 * - recordEvent keeps events newest-first, unique by event id, capped at MAX_ALERT_EVENTS.
 *   Returns false for a duplicate id so callers can skip a second notification.
 */
export interface AlertState {
  status: LoadStatus;
  error: string | null;
  alerts: PriceAlert[];
  events: AlertEvent[];

  load(): Promise<void>;
  create(input: CreateAlertInput): Promise<PriceAlert>;
  update(id: string, input: UpdateAlertInput): Promise<PriceAlert>;
  setEnabled(id: string, enabled: boolean): Promise<void>;
  remove(id: string): Promise<void>;
  applyServerUpdate(alert: PriceAlert): void;
  recordEvent(event: AlertEvent): boolean;
  clearEvents(): void;
}

const notImplemented = (): Promise<never> => Promise.reject(new Error('not implemented'));

export const useAlertStore = create<AlertState>()(() => ({
  status: 'idle',
  error: null,
  alerts: [],
  events: [],
  load: () => Promise.resolve(),
  create: notImplemented,
  update: notImplemented,
  setEnabled: notImplemented,
  remove: notImplemented,
  applyServerUpdate: () => undefined,
  recordEvent: () => false,
  clearEvents: () => undefined,
}));
