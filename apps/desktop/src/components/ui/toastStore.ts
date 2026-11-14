import { create } from 'zustand';

export type ToastTone = 'info' | 'success' | 'warning' | 'error';

interface ToastOptions {
  tone: ToastTone;
  title: string;
  description?: string;
  /**
   * Auto-dismiss delay. Default 5000. `Infinity` or a value <= 0 keeps the toast until it is
   * dismissed. NaN falls back to the default. Finite values above MAX_TOAST_DURATION_MS
   * (about 24.8 days) are clamped to it.
   */
  durationMs?: number;
}

interface Toast {
  id: string;
  tone: ToastTone;
  title: string;
  description?: string;
  /** Resolved delay; null means sticky. */
  durationMs: number | null;
  createdAt: number;
}

export const DEFAULT_TOAST_DURATION_MS = 5000;
/** At most this many toasts exist at once; showing another evicts the oldest. */
export const MAX_VISIBLE_TOASTS = 5;
/**
 * Longest delay setTimeout can hold (2^31-1 ms). Browsers and Node fire larger delays after
 * about 1ms, so finite durations above this are clamped to it.
 */
export const MAX_TOAST_DURATION_MS = 2_147_483_647;

interface ToastState {
  toasts: Toast[];
}

export const useToastStore = create<ToastState>(() => ({ toasts: [] }));

interface TimerEntry {
  handle: ReturnType<typeof setTimeout> | undefined;
  remaining: number;
  startedAt: number;
}

const timers = new Map<string, TimerEntry>();
let paused = false;
let counter = 0;

function resolveDuration(durationMs: number | undefined): number | null {
  if (durationMs === undefined || Number.isNaN(durationMs)) return DEFAULT_TOAST_DURATION_MS;
  if (durationMs <= 0 || !Number.isFinite(durationMs)) return null;
  return Math.min(durationMs, MAX_TOAST_DURATION_MS);
}

function startTimer(id: string, ms: number): void {
  const entry: TimerEntry = { handle: undefined, remaining: ms, startedAt: Date.now() };
  if (!paused)
    entry.handle = setTimeout(() => {
      dismissToast(id);
    }, ms);
  timers.set(id, entry);
}

function clearTimer(id: string): void {
  const entry = timers.get(id);
  if (entry) clearTimeout(entry.handle);
  timers.delete(id);
}

/** Shows a toast and returns its id. Safe to call from anywhere (no React context needed). */
export function showToast(options: ToastOptions): string {
  counter += 1;
  const id = `toast-${counter}`;
  const durationMs = resolveDuration(options.durationMs);
  const toast: Toast = {
    id,
    tone: options.tone,
    title: options.title,
    description: options.description,
    durationMs,
    createdAt: Date.now(),
  };
  const next = [...useToastStore.getState().toasts, toast];
  const evicted = next.slice(0, Math.max(0, next.length - MAX_VISIBLE_TOASTS));
  for (const old of evicted) clearTimer(old.id);
  useToastStore.setState({ toasts: next.slice(-MAX_VISIBLE_TOASTS) });
  if (durationMs !== null) startTimer(id, durationMs);
  return id;
}

/** Removes a toast. Unknown ids are ignored. */
export function dismissToast(id: string): void {
  clearTimer(id);
  const { toasts } = useToastStore.getState();
  if (!toasts.some((t) => t.id === id)) return;
  const remaining = toasts.filter((t) => t.id !== id);
  // ** An empty stack can't receive the mouseleave that would resume it, so never stay paused.
  if (remaining.length === 0) paused = false;
  useToastStore.setState({ toasts: remaining });
}

/** Removes every toast and cancels their timers. */
export function dismissAllToasts(): void {
  for (const id of timers.keys()) clearTimer(id);
  paused = false;
  useToastStore.setState({ toasts: [] });
}

/** Freezes auto-dismiss countdowns (the viewport calls this while hovered). */
export function pauseToasts(): void {
  if (paused) return;
  paused = true;
  const now = Date.now();
  for (const entry of timers.values()) {
    if (entry.handle === undefined) continue;
    clearTimeout(entry.handle);
    entry.handle = undefined;
    entry.remaining = Math.max(0, entry.remaining - (now - entry.startedAt));
  }
}

/** Resumes countdowns with the time each toast had left. */
export function resumeToasts(): void {
  if (!paused) return;
  paused = false;
  const now = Date.now();
  for (const [id, entry] of timers) {
    entry.startedAt = now;
    entry.handle = setTimeout(() => {
      dismissToast(id);
    }, entry.remaining);
  }
}
