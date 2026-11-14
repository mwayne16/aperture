import { create } from 'zustand';
import { showToast } from '../../components/ui/toastStore';
import { isApiError } from '../../data/api';
import { api } from '../../data/dataLayer';
import type { AlertEvent, CreateAlertInput, PriceAlert, UpdateAlertInput } from '../../domain/types';

type LoadStatus = 'idle' | 'loading' | 'ready' | 'error';

interface LoadOptions {
  /** Start a new request even if a load is in flight, e.g. after the server data was reset. */
  force?: boolean;
}

/** Max trigger events kept in memory for the log. */
export const MAX_ALERT_EVENTS = 50;

/**
 * Alert state backed by `api` (CRUD) and `realtime` (server-side evaluation results).
 *
 * - load() never rejects: a failure sets status 'error' and `error`. A call while a load is in
 *   flight returns that load instead of starting another. load({ force: true }) always starts a new
 *   request, and the result of the load it replaces is ignored.
 * - create and update reject with ApiError so the dialog can show errors inline. An update that
 *   comes back NOT_FOUND also drops the alert from the store.
 * - setEnabled and remove are optimistic with rollback + error toast on failure. Their promises
 *   always resolve. When the same switch is flipped again before the server answers, only the
 *   newest request decides the outcome.
 * - applyServerUpdate merges an alert pushed by the backend; it ignores updates whose updatedAt is
 *   older than the stored one, and ignores ids it doesn't know about unless loaded.
 * - recordEvent keeps events newest-first, unique by event id, capped at MAX_ALERT_EVENTS.
 *   Returns false for a duplicate id so callers can skip a second notification.
 */
interface AlertState {
  status: LoadStatus;
  error: string | null;
  alerts: PriceAlert[];
  events: AlertEvent[];

  load(options?: LoadOptions): Promise<void>;
  create(input: CreateAlertInput): Promise<PriceAlert>;
  update(id: string, input: UpdateAlertInput): Promise<PriceAlert>;
  setEnabled(id: string, enabled: boolean): Promise<void>;
  remove(id: string): Promise<void>;
  applyServerUpdate(alert: PriceAlert): void;
  recordEvent(event: AlertEvent): boolean;
  clearEvents(): void;
}

/** An enabled flag the user set that the server hasn't confirmed yet. `seq` marks the newest request. */
interface PendingEnabled {
  value: boolean;
  seq: number;
}

/**
 * Bookkeeping behind `alerts`, kept in the store so resetting the store resets it too.
 * Components read `alerts`, never these.
 */
interface AlertSync {
  /** Alerts as the server last reported them, in server order. */
  confirmed: PriceAlert[];
  pendingEnabled: Partial<Record<string, PendingEnabled>>;
  pendingRemoval: Partial<Record<string, true>>;
  /** Ids deleted since the last load started, so late pushes and stale snapshots can't revive them. */
  deletedIds: readonly string[];
  inflightLoad: Promise<void> | null;
}

type AlertStoreState = AlertState & AlertSync;

const LOAD_FAILED = "Couldn't load alerts.";

let requestSeq = 0;

function errorMessage(error: unknown, fallback: string): string {
  return isApiError(error) ? error.message : fallback;
}

function isNotFound(error: unknown): boolean {
  return isApiError(error) && error.code === 'NOT_FOUND';
}

function isOlder(candidate: PriceAlert, current: PriceAlert): boolean {
  return Date.parse(candidate.updatedAt) < Date.parse(current.updatedAt);
}

/** Inserts or replaces by id, unless the stored copy is newer. Returns the same array when nothing changes. */
function upsert(list: PriceAlert[], alert: PriceAlert): PriceAlert[] {
  const index = list.findIndex((a) => a.id === alert.id);
  if (index === -1) return [...list, alert];
  const current = list[index];
  if (current === undefined || current === alert || isOlder(alert, current)) return list;
  return list.map((a, i) => (i === index ? alert : a));
}

/** Like upsert, but never adds an alert the store no longer holds (deleted while the request ran). */
function replaceKnown(list: PriceAlert[], alert: PriceAlert): PriceAlert[] {
  return list.some((a) => a.id === alert.id) ? upsert(list, alert) : list;
}

function without<T>(record: Partial<Record<string, T>>, id: string): Partial<Record<string, T>> {
  if (record[id] === undefined) return record;
  const { [id]: _dropped, ...rest } = record;
  return rest;
}

/** The server state with the user's unconfirmed changes applied on top. */
function visibleAlerts(
  sync: Pick<AlertSync, 'confirmed' | 'pendingEnabled' | 'pendingRemoval'>,
): PriceAlert[] {
  const visible: PriceAlert[] = [];
  for (const alert of sync.confirmed) {
    if (sync.pendingRemoval[alert.id]) continue;
    const pending = sync.pendingEnabled[alert.id];
    if (pending === undefined || pending.value === alert.enabled) {
      visible.push(alert);
    } else {
      // Enabling a disabled alert re-arms it on the server, so show it armed right away.
      visible.push({ ...alert, enabled: pending.value, armed: pending.value ? true : alert.armed });
    }
  }
  return visible;
}

function newestFirst(a: AlertEvent, b: AlertEvent): number {
  const diff = Date.parse(b.triggeredAt) - Date.parse(a.triggeredAt);
  return Number.isNaN(diff) ? 0 : diff;
}

export const useAlertStore = create<AlertStoreState>()((set, get) => {
  /** Applies a change to the sync fields and recomputes `alerts` from them. */
  function commit(patch: Partial<AlertStoreState>): void {
    const next = { ...get(), ...patch };
    set({ ...patch, alerts: visibleAlerts(next) });
  }

  /** Drops an alert the server no longer has. */
  function forget(id: string): void {
    const s = get();
    commit({
      confirmed: s.confirmed.filter((a) => a.id !== id),
      pendingEnabled: without(s.pendingEnabled, id),
      pendingRemoval: without(s.pendingRemoval, id),
      deletedIds: s.deletedIds.includes(id) ? s.deletedIds : [...s.deletedIds, id],
    });
  }

  return {
    status: 'idle',
    error: null,
    alerts: [],
    events: [],
    confirmed: [],
    pendingEnabled: {},
    pendingRemoval: {},
    deletedIds: [],
    inflightLoad: null,

    load({ force = false } = {}) {
      const inflight = get().inflightLoad;
      if (inflight && !force) return inflight;
      // ** The request starts on a microtask so `inflightLoad` is set before any outcome can be
      // handled, even if the API throws synchronously.
      const promise: Promise<void> = Promise.resolve()
        .then(() => api.listAlerts())
        .then(
          (loaded) => {
            const s = get();
            if (s.inflightLoad !== promise) return;
            // Keep newer copies pushed while the request ran, and skip alerts deleted meanwhile.
            const confirmed = loaded
              .filter((alert) => !s.deletedIds.includes(alert.id))
              .map((alert) => {
                const current = s.confirmed.find((a) => a.id === alert.id);
                return current && isOlder(alert, current) ? current : alert;
              });
            commit({ confirmed, status: 'ready', error: null, inflightLoad: null });
          },
          (error: unknown) => {
            if (get().inflightLoad !== promise) return;
            set({ status: 'error', error: errorMessage(error, LOAD_FAILED), inflightLoad: null });
          },
        )
        .catch(() => {
          if (get().inflightLoad === promise)
            set({ status: 'error', error: LOAD_FAILED, inflightLoad: null });
        });
      set({ inflightLoad: promise, status: 'loading', error: null, deletedIds: [] });
      return promise;
    },

    async create(input) {
      const alert = await api.createAlert(input);
      commit({ confirmed: upsert(get().confirmed, alert) });
      return alert;
    },

    async update(id, input) {
      try {
        const alert = await api.updateAlert(id, input);
        commit({ confirmed: replaceKnown(get().confirmed, alert) });
        return alert;
      } catch (error) {
        if (isNotFound(error)) forget(id);
        throw error;
      }
    },

    async setEnabled(id, enabled) {
      const shown = get().alerts.find((a) => a.id === id);
      if (!shown || shown.enabled === enabled) return;
      const seq = ++requestSeq;
      commit({ pendingEnabled: { ...get().pendingEnabled, [id]: { value: enabled, seq } } });
      try {
        const alert = await api.updateAlert(id, { enabled });
        const s = get();
        const latest = s.pendingEnabled[id]?.seq === seq;
        commit({
          confirmed: replaceKnown(s.confirmed, alert),
          pendingEnabled: latest ? without(s.pendingEnabled, id) : s.pendingEnabled,
        });
      } catch (error) {
        if (isNotFound(error)) {
          forget(id);
          showToast({
            tone: 'warning',
            title: `The ${shown.symbol} alert no longer exists`,
            description: 'It was deleted elsewhere, so it was removed from the list.',
          });
          return;
        }
        const s = get();
        // ** A newer flip of the same switch is still in flight; its result decides what to show.
        if (s.pendingEnabled[id]?.seq !== seq) return;
        commit({ pendingEnabled: without(s.pendingEnabled, id) });
        showToast({
          tone: 'error',
          title: `Couldn't ${enabled ? 'enable' : 'disable'} the ${shown.symbol} alert`,
          description: errorMessage(error, 'Something went wrong. Try again.'),
        });
      }
    },

    async remove(id) {
      const s = get();
      const target = s.confirmed.find((a) => a.id === id);
      if (!target || s.pendingRemoval[id]) return;
      commit({ pendingRemoval: { ...s.pendingRemoval, [id]: true } });
      try {
        await api.deleteAlert(id);
        forget(id);
      } catch (error) {
        if (isNotFound(error)) {
          forget(id);
          return;
        }
        if (!get().pendingRemoval[id]) return;
        commit({ pendingRemoval: without(get().pendingRemoval, id) });
        showToast({
          tone: 'error',
          title: `Couldn't delete the ${target.symbol} alert`,
          description: errorMessage(error, 'Something went wrong. Try again.'),
        });
      }
    },

    applyServerUpdate(alert) {
      const s = get();
      if (s.deletedIds.includes(alert.id)) return;
      const known = s.confirmed.some((a) => a.id === alert.id);
      if (!known && s.status !== 'ready') return;
      const confirmed = upsert(s.confirmed, alert);
      if (confirmed !== s.confirmed) commit({ confirmed });
    },

    recordEvent(event) {
      const { events } = get();
      if (events.some((e) => e.id === event.id)) return false;
      set({ events: [event, ...events].sort(newestFirst).slice(0, MAX_ALERT_EVENTS) });
      return true;
    },

    clearEvents() {
      if (get().events.length > 0) set({ events: [] });
    },
  };
});
