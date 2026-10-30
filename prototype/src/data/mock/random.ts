/**
 * Deterministic pseudo-random helpers for the simulated market. Nothing here is cryptographic.
 */

/** 32-bit FNV-1a hash of a string. Stable across runs and platforms. */
export function hashString(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** One mulberry32 step: returns a uniform value in [0, 1) and the next 32-bit state. */
export function mulberry32Step(state: number): { value: number; state: number } {
  const next = (state + 0x6d2b79f5) | 0;
  let t = next;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return { value: ((t ^ (t >>> 14)) >>> 0) / 4294967296, state: next >>> 0 };
}

/** A seeded generator whose internal state can be read back, so pure functions can resume it. */
export interface Prng {
  /** Uniform in [0, 1). */
  next(): number;
  /** Standard normal draw (Box-Muller). */
  normal(): number;
  /** Current 32-bit state. Creating a new Prng from it continues the same sequence. */
  readonly state: number;
}

export function createPrng(seed: number): Prng {
  let state = seed >>> 0;
  const next = (): number => {
    const step = mulberry32Step(state);
    state = step.state;
    return step.value;
  };
  return {
    next,
    normal() {
      // 1 - u keeps the log argument in (0, 1].
      const u1 = 1 - next();
      const u2 = next();
      return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    },
    get state() {
      return state;
    },
  };
}

let idCounter = 0;

/**
 * Unique id with a readable prefix, e.g. "wl_lq3k2a1b_7f3c". Combines time, a process counter and
 * randomness, so ids stay unique across reloads and within a single millisecond.
 */
export function makeId(prefix: string): string {
  idCounter = (idCounter + 1) % 0x7fffffff;
  const time = Date.now().toString(36);
  const counter = idCounter.toString(36);
  const random = Math.floor(Math.random() * 0x100000)
    .toString(36)
    .padStart(4, '0');
  return `${prefix}_${time}${counter}_${random}`;
}
