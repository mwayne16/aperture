import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useUiStore } from '../../app/uiStore';
import { updateSimulation } from '../../data/simulationStore';
import { StatusBar } from './StatusBar';
import { quote, resetShellStores, setConnection, setQuotes, watch } from './testUtils';

const NOW = Date.parse('2026-10-28T14:00:00Z');

beforeEach(() => {
  resetShellStores();
});

afterEach(() => {
  vi.useRealTimers();
  resetShellStores();
});

describe('StatusBar', () => {
  it('summarizes the feed: name, scenario, state and subscribed symbols', () => {
    render(<StatusBar />);
    watch(['AAPL', 'MSFT']);
    act(() => {
      useUiStore.getState().selectSymbol('NVDA');
    });
    setConnection({ state: 'connected', lastMessageAt: Date.now() });
    expect(screen.getByText('Simulated feed')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Scenario: Live' })).toBeInTheDocument();
    expect(screen.getByText('Connected')).toBeInTheDocument();
    expect(screen.getByText('3 symbols subscribed')).toBeInTheDocument();
  });

  it('counts the selected symbol once when it is also on the watchlist', () => {
    render(<StatusBar />);
    watch(['AAPL']);
    act(() => {
      useUiStore.getState().selectSymbol('AAPL');
    });
    expect(screen.getByText('1 symbol subscribed')).toBeInTheDocument();
  });

  it('ages the last message every second', () => {
    vi.useFakeTimers({ now: NOW });
    render(<StatusBar />);
    expect(screen.getByText('No messages yet')).toBeInTheDocument();
    setConnection({ state: 'connected', lastMessageAt: NOW });
    expect(screen.getByText('Last message just now')).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(screen.getByText('Last message 5s ago')).toBeInTheDocument();
  });

  it('counts down to the next reconnect attempt and shows why the feed dropped', () => {
    vi.useFakeTimers({ now: NOW });
    render(<StatusBar />);
    setConnection({
      state: 'reconnecting',
      reconnectAttempt: 3,
      nextRetryAt: NOW + 4000,
      lastMessageAt: NOW - 1000,
      error: 'Simulated outage: the feed is unreachable.',
    });
    expect(screen.getByText('Reconnecting (attempt 3)', { exact: false })).toHaveTextContent(
      'Reconnecting (attempt 3) · Next retry in 4s',
    );
    expect(screen.getByText('Simulated outage: the feed is unreachable.')).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(screen.getByText('Next retry in 1s', { exact: false })).toBeInTheDocument();
  });

  it('explains delayed quotes while connected', () => {
    render(<StatusBar />);
    watch(['AAPL']);
    setConnection({ state: 'connected' });
    setQuotes([quote('AAPL', 'delayed')]);
    expect(screen.getByText('Quotes are delayed, not real time.')).toBeInTheDocument();
  });

  it('follows the scenario and opens the simulation controls from it', async () => {
    const user = userEvent.setup();
    render(<StatusBar />);
    act(() => {
      updateSimulation({ feedScenario: 'flaky' });
    });
    await user.click(screen.getByRole('button', { name: 'Scenario: Flaky' }));
    expect(useUiStore.getState().prototypeControlsOpen).toBe(true);
  });

  it('shows the search shortcut and the simulated-data notice', () => {
    render(<StatusBar />);
    expect(screen.getByText('Ctrl')).toBeInTheDocument();
    expect(screen.getByText('K')).toBeInTheDocument();
    expect(screen.getByText('to search', { exact: false })).toBeInTheDocument();
    expect(screen.getByText('Simulated data. Not real market prices.')).toBeInTheDocument();
  });

  it('drops the simulated markers for a real feed', () => {
    render(<StatusBar />);
    setConnection({ state: 'connected', feedName: 'Alpaca IEX', simulated: false });
    expect(screen.getByText('Alpaca IEX')).toBeInTheDocument();
    expect(screen.queryByText('Simulated data. Not real market prices.')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Scenario/ })).not.toBeInTheDocument();
  });
});
