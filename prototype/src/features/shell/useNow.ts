import { useSyncExternalStore } from 'react';

/**
 * One wall clock for the app chrome. Every consumer shares a single timer that wakes just after each
 * whole second, so the market clock and the "ago" labels change together and on time. The timer runs
 * only while something is subscribed.
 */

const SECOND = 1000;
// ** Waking a few ms past the boundary keeps a slightly early timer from reading the previous second.
const WAKE_SLACK_MS = 5;

const listeners = new Set<() => void>();
let current = Date.now();
let timer: ReturnType<typeof setTimeout> | null = null;

/** Arms the timer for the next whole second unless it is already armed. */
function ensureTimer(): void {
  if (timer !== null) return;
  const delay = SECOND - (Date.now() % SECOND) + WAKE_SLACK_MS;
  timer = setTimeout(tick, delay);
}

function tick(): void {
  timer = null;
  current = Date.now();
  for (const listener of [...listeners]) listener();
  if (listeners.size > 0) ensureTimer();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  ensureTimer();
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };
}

// Refreshes the cached time once the wall-clock second has moved on, so a component that mounts
// between ticks (or after the timer was throttled) never shows a stale second.
function getSnapshot(): number {
  const now = Date.now();
  if (Math.floor(now / SECOND) !== Math.floor(current / SECOND)) current = now;
  return current;
}

/** Current epoch ms, re-rendering the caller once per wall-clock second. */
export function useNow(): number {
  return useSyncExternalStore(subscribe, getSnapshot);
}
