import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../App';
import { updateSimulation } from '../../data/simulationStore';
import { resetShellStores, watch } from './testUtils';

/**
 * The app chrome driven by the real mock data layer: each feed scenario must reach the top bar and
 * the status bar the way a reviewer would see it after flipping it in the simulation controls.
 */

let clock = Math.ceil(Date.now() / 1000) * 1000;

beforeEach(() => {
  // ** Each test starts an hour after the previous one, so trade times the shared mock market kept
  // from earlier tests are always in the past.
  clock += 3_600_000;
  vi.useFakeTimers({ now: clock });
  resetShellStores();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  resetShellStores();
});

function advance(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

function scenario(feedScenario: Parameters<typeof updateSimulation>[0]['feedScenario']) {
  act(() => {
    updateSimulation({ feedScenario });
  });
}

const topStatus = () => within(screen.getByRole('banner')).getByRole('status');
const statusBar = () => within(screen.getByRole('contentinfo'));

/** Mounts the app on a two-symbol watchlist and lets the simulated feed connect and trade. */
function startApp() {
  const view = render(<App />);
  watch(['AAPL', 'MSFT']);
  advance(2000);
  return view;
}

describe('app chrome on the simulated feed (QA)', () => {
  it('shows a live connection with a fresh last message and the subscribed symbol count', () => {
    startApp();
    expect(topStatus()).toHaveTextContent('Connected');
    expect(within(topStatus()).queryByText('Delayed')).not.toBeInTheDocument();
    expect(within(topStatus()).queryByText('Stale')).not.toBeInTheDocument();
    expect(statusBar().getByText('Connected')).toBeInTheDocument();
    expect(statusBar().getByText('2 symbols subscribed')).toBeInTheDocument();
    expect(statusBar().getByText(/^Last message (just now|1s ago)$/)).toBeInTheDocument();
    expect(statusBar().getByRole('button', { name: 'Scenario: Live' })).toBeInTheDocument();
  });

  it('flags delayed quotes in both bars and clears the flag when the feed is live again', () => {
    startApp();
    scenario('delayed');
    advance(1000);
    expect(within(topStatus()).getByText('Delayed')).toBeInTheDocument();
    expect(statusBar().getByText('Quotes are delayed, not real time.')).toBeInTheDocument();
    expect(statusBar().getByRole('button', { name: 'Scenario: Delayed' })).toBeInTheDocument();

    scenario('live');
    advance(1000);
    expect(within(topStatus()).queryByText('Delayed')).not.toBeInTheDocument();
    expect(statusBar().queryByText('Quotes are delayed, not real time.')).not.toBeInTheDocument();
  });

  it('counts reconnect attempts during an outage, shows why, and recovers when the outage ends', () => {
    startApp();
    scenario('disconnected');
    expect(topStatus()).toHaveTextContent('Reconnecting (attempt 1)');
    expect(statusBar().getByText(/^Reconnecting \(attempt 1\)/)).toHaveTextContent(
      /^Reconnecting \(attempt 1\) · Next retry in [12]s$/,
    );
    expect(statusBar().getByText('Simulated outage: the feed is unreachable.')).toBeInTheDocument();

    advance(1000);
    expect(topStatus()).toHaveTextContent('Reconnecting (attempt 2)');
    expect(statusBar().getByText(/^Reconnecting \(attempt 2\)/)).toHaveTextContent(/Next retry in [23]s$/);

    scenario('live');
    expect(topStatus()).toHaveTextContent('Connected');
    expect(statusBar().queryByText(/Next retry/)).not.toBeInTheDocument();
    expect(statusBar().queryByText('Simulated outage: the feed is unreachable.')).not.toBeInTheDocument();
  });

  it('marks the feed stale once trades stop for the staleness threshold', () => {
    startApp();
    scenario('stale');
    advance(12_000);
    expect(topStatus()).toHaveTextContent('Connected');
    expect(within(topStatus()).getByText('Stale')).toBeInTheDocument();
    expect(statusBar().getByText('Quotes have stopped updating.')).toBeInTheDocument();
  });

  it('follows a flaky feed through a drop and its recovery', () => {
    startApp();
    scenario('flaky');
    advance(20_000);
    expect(topStatus()).toHaveTextContent('Reconnecting (attempt 1)');
    expect(statusBar().getByText('Simulated network drop.')).toBeInTheDocument();
    advance(4_000);
    expect(topStatus()).toHaveTextContent('Connected');
    expect(statusBar().queryByText('Simulated network drop.')).not.toBeInTheDocument();
  });

  it('drives the chrome from the simulation controls and hands focus back on close', () => {
    // ** fireEvent rather than user-event: Testing Library's async wrapper waits on a timer that
    // Vitest's fake clock never runs.
    startApp();
    const opener = screen.getByRole('button', { name: 'Simulation controls' });
    act(() => {
      opener.focus();
    });
    fireEvent.click(opener);
    const dialog = screen.getByRole('dialog', { name: 'Simulation controls' });
    fireEvent.click(within(dialog).getByRole('radio', { name: 'Disconnected' }));

    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    advance(500);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
    expect(statusBar().getByRole('button', { name: 'Scenario: Disconnected' })).toBeInTheDocument();
    expect(topStatus()).toHaveTextContent('Reconnecting (attempt 1)');
  });

  it('mounts once under StrictMode, connects, and leaves no timers behind on unmount', () => {
    const view = render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
    watch(['AAPL']);
    advance(1000);
    expect(screen.getAllByRole('heading', { level: 1, name: 'Aperture' })).toHaveLength(1);
    expect(topStatus()).toHaveTextContent('Connected');
    expect(statusBar().getByText('1 symbol subscribed')).toBeInTheDocument();
    view.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
