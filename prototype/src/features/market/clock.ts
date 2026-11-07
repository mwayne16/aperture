import { useSyncExternalStore } from 'react';

/**
 * One shared 1-second clock for relative times ("3s ago"). It ticks only while something is
 * subscribed, so every age cell updates in the same render pass instead of running its own timer.
 */

const TICK_MS = 1000;
const listeners = new Set<() => void>();
let now = Date.now();
let timer: ReturnType<typeof setInterval> | null = null;

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (timer === null) {
    now = Date.now();
    timer = setInterval(() => {
      now = Date.now();
      for (const notify of [...listeners]) notify();
    }, TICK_MS);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  };
}

function getSnapshot(): number {
  // ** While nothing is subscribed the value goes stale, so refresh it before the first render reads
  // it. Refreshing only after a full tick keeps repeated reads in one render identical.
  if (timer === null && Date.now() - now >= TICK_MS) now = Date.now();
  return now;
}

/** Current time in epoch ms, updated once per second. */
export function useNow(): number {
  return useSyncExternalStore(subscribe, getSnapshot);
}
