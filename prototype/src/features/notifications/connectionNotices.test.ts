import { describe, expect, it } from 'vitest';
import { INITIAL_CONNECTION } from '../../data/connectionStore';
import type { ConnectionInfo, ConnectionState } from '../../domain/types';
import { FLAP_WINDOW_MS, formatDuration, outageNotification, trackOutage, type Outage } from './connectionNotices';

const T0 = Date.parse('2026-10-30T18:05:09.000Z'); // 14:05:09 ET

function info(state: ConnectionState): ConnectionInfo {
  return { ...INITIAL_CONNECTION, state };
}

/** Runs a sequence of [state, at] changes through trackOutage and returns every outage it produced. */
function run(steps: [ConnectionState, number][], start: ConnectionState = 'connected') {
  let outage: Outage | null = null;
  let previous = start;
  let seq = 0;
  const changes: Outage[] = [];
  for (const [state, at] of steps) {
    const next = trackOutage(outage, previous, info(state), at, () => `o${++seq}`);
    if (next !== outage && next !== null) changes.push(next);
    outage = next;
    previous = state;
  }
  return { outage, changes };
}

describe('trackOutage', () => {
  it('opens an outage on a drop and closes it when the connection returns', () => {
    const { changes } = run([
      ['reconnecting', T0],
      ['connected', T0 + 4000],
    ]);
    expect(changes).toEqual([
      { id: 'o1', feedName: 'Simulated feed', startedAt: T0, lastDropAt: T0, drops: 1, restoredAt: null },
      { id: 'o1', feedName: 'Simulated feed', startedAt: T0, lastDropAt: T0, drops: 1, restoredAt: T0 + 4000 },
    ]);
  });

  it('ignores retries while the connection stays down', () => {
    let outage = trackOutage(null, 'connected', info('reconnecting'), T0, () => 'o1');
    const same = trackOutage(outage, 'reconnecting', { ...info('reconnecting'), reconnectAttempt: 3 }, T0 + 9000, () => 'o2');
    expect(same).toBe(outage);
    // A deliberate disconnect and a new attempt during the outage still belong to it.
    outage = trackOutage(outage, 'reconnecting', info('disconnected'), T0 + 10_000, () => 'o3');
    expect(trackOutage(outage, 'connecting', info('reconnecting'), T0 + 11_000, () => 'o4')).toBe(outage);
  });

  it('never treats startup, a deliberate disconnect or a reconnect without an outage as one', () => {
    const { changes } = run(
      [
        ['connecting', T0],
        ['connected', T0 + 500],
        ['disconnected', T0 + 1000],
        ['connecting', T0 + 1500],
        ['connected', T0 + 2000],
      ],
      'disconnected',
    );
    expect(changes).toEqual([]);
  });

  it('counts a failed first connection as an outage', () => {
    const { changes } = run([['reconnecting', T0]], 'connecting');
    expect(changes).toHaveLength(1);
  });

  it('folds drops soon after a restore into the same outage', () => {
    const { changes, outage } = run([
      ['reconnecting', T0],
      ['connected', T0 + 4000],
      ['reconnecting', T0 + 24_000],
      ['connected', T0 + 28_000],
      ['reconnecting', T0 + 28_000 + FLAP_WINDOW_MS],
    ]);
    expect(new Set(changes.map((o) => o.id))).toEqual(new Set(['o1']));
    expect(outage).toMatchObject({ id: 'o1', drops: 3, startedAt: T0, lastDropAt: T0 + 28_000 + FLAP_WINDOW_MS, restoredAt: null });
  });

  it('starts a new outage once the connection has been stable for longer than the window', () => {
    const { changes } = run([
      ['reconnecting', T0],
      ['connected', T0 + 4000],
      ['reconnecting', T0 + 4000 + FLAP_WINDOW_MS + 1],
    ]);
    expect(changes.map((o) => [o.id, o.drops])).toEqual([
      ['o1', 1],
      ['o1', 1],
      ['o2', 1],
    ]);
  });
});

describe('outageNotification', () => {
  const base: Outage = { id: 'o1', feedName: 'Simulated feed', startedAt: T0, lastDropAt: T0, drops: 1, restoredAt: null };

  it('describes a single drop, then its recovery with the time offline', () => {
    expect(outageNotification(base)).toEqual({
      id: 'o1',
      kind: 'connection',
      symbol: null,
      title: 'Connection lost',
      body: 'Simulated feed stopped at 14:05:09 ET. Prices may be out of date; retrying automatically.',
      at: T0,
    });
    expect(outageNotification({ ...base, restoredAt: T0 + 125_000 })).toMatchObject({
      title: 'Connection restored',
      body: 'Simulated feed is back after 2m 5s offline (lost at 14:05:09 ET).',
      at: T0 + 125_000,
    });
  });

  it('describes a flapping connection with its drop count', () => {
    const flapping = { ...base, drops: 3, lastDropAt: T0 + 60_000 };
    expect(outageNotification(flapping)).toMatchObject({
      title: 'Connection unstable',
      body: 'Simulated feed dropped 3 times since 14:05:09 ET. Prices may be out of date; retrying automatically.',
      at: T0 + 60_000,
    });
    expect(outageNotification({ ...flapping, restoredAt: T0 + 64_000 })).toMatchObject({
      title: 'Connection restored',
      body: 'Simulated feed dropped 3 times since 14:05:09 ET and is connected again.',
      at: T0 + 64_000,
    });
  });
});

describe('formatDuration', () => {
  it('reads in seconds, minutes and hours', () => {
    expect(formatDuration(0)).toBe('0s');
    expect(formatDuration(4_400)).toBe('4s');
    expect(formatDuration(59_499)).toBe('59s');
    expect(formatDuration(60_000)).toBe('1m');
    expect(formatDuration(125_000)).toBe('2m 5s');
    expect(formatDuration(3_600_000)).toBe('1h');
    expect(formatDuration(3_780_000)).toBe('1h 3m');
    expect(formatDuration(-5)).toBe('0s');
  });
});
