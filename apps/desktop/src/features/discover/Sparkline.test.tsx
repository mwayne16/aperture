import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../data/api';
import { api } from '../../data/dataLayer';
import type { HistoryResult } from '../../domain/types';
import { Sparkline } from './Sparkline';
import { sparklineCache } from './sparklineCache';

function history(symbol: string, closes: number[]): HistoryResult {
  return {
    symbol,
    range: '1D',
    timeframe: '5Min',
    bars: closes.map((close, i) => ({
      time: 1_700_000_000 + i * 300,
      open: close,
      high: close,
      low: close,
      close,
      volume: 1,
    })),
    truncated: false,
    simulated: true,
  };
}

async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

function sparklines(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>('.sparkline')];
}

beforeEach(() => {
  sparklineCache.clear();
});

describe('Sparkline', () => {
  it('draws the one-day closes, colored by the direction it is given', async () => {
    const getHistory = vi.spyOn(api, 'getHistory').mockResolvedValue(history('AAPL', [10, 12, 11]));
    render(<Sparkline symbol="AAPL" direction={-1} />);
    expect(sparklines()[0]).toHaveAttribute('data-status', 'loading');
    await settle();
    expect(getHistory).toHaveBeenCalledWith('AAPL', '1D');
    const line = document.querySelector('.sparkline__line');
    expect(line?.getAttribute('d')).toMatch(/^M2 /);
    expect(sparklines()[0]).toHaveClass('is-loss');
    expect(sparklines()[0]).toHaveAttribute('aria-hidden', 'true');
  });

  it('falls back to the direction of the series itself', async () => {
    vi.spyOn(api, 'getHistory').mockResolvedValue(history('AAPL', [10, 12]));
    render(<Sparkline symbol="AAPL" />);
    await settle();
    expect(sparklines()[0]).toHaveClass('is-gain');
  });

  it('fetches a symbol once for every sparkline that shows it', async () => {
    const getHistory = vi.spyOn(api, 'getHistory').mockResolvedValue(history('MSFT', [1, 2, 3]));
    const { unmount } = render(
      <>
        <Sparkline symbol="MSFT" />
        <Sparkline symbol="MSFT" />
      </>,
    );
    await settle();
    expect(getHistory).toHaveBeenCalledTimes(1);
    expect(document.querySelectorAll('.sparkline__line')).toHaveLength(2);
    unmount();

    // A remount draws straight from the cache.
    render(<Sparkline symbol="MSFT" />);
    expect(sparklines()[0]).toHaveAttribute('data-status', 'ready');
    expect(getHistory).toHaveBeenCalledTimes(1);
  });

  it('shows a dash when history fails or is empty, and asks again next time', async () => {
    const getHistory = vi
      .spyOn(api, 'getHistory')
      .mockRejectedValueOnce(new ApiError('PROVIDER_ERROR', 'No history.', 502))
      .mockResolvedValueOnce(history('NVDA', []));
    const first = render(<Sparkline symbol="NVDA" />);
    await settle();
    expect(sparklines()[0]).toHaveAttribute('data-status', 'unavailable');
    expect(screen.getByText('—')).toBeInTheDocument();
    first.unmount();

    render(<Sparkline symbol="NVDA" />);
    await settle();
    expect(getHistory).toHaveBeenCalledTimes(2);
    expect(sparklines()[0]).toHaveAttribute('data-status', 'unavailable');
  });

  it('draws the baseline inside the range', async () => {
    vi.spyOn(api, 'getHistory').mockResolvedValue(history('SPY', [10, 11]));
    render(<Sparkline symbol="SPY" baseline={9} height={20} />);
    await settle();
    expect(document.querySelector('.sparkline__baseline')).toHaveAttribute('y1', '18');
  });

  it('ignores an answer that arrives after it unmounts', async () => {
    let resolve!: (value: HistoryResult) => void;
    vi.spyOn(api, 'getHistory').mockReturnValue(new Promise((res) => (resolve = res)));
    const { unmount } = render(<Sparkline symbol="TSLA" />);
    unmount();
    resolve(history('TSLA', [1, 2]));
    await settle();
    expect(sparklineCache.peek('TSLA')).toEqual([1, 2]);
  });

  describe('when it starts off screen', () => {
    let trigger: ((visible: boolean) => void) | null = null;
    const original = globalThis.IntersectionObserver;

    beforeEach(() => {
      class FakeObserver {
        constructor(private readonly callback: IntersectionObserverCallback) {
          trigger = (visible) => {
            this.callback(
              [{ isIntersecting: visible } as IntersectionObserverEntry],
              this as unknown as IntersectionObserver,
            );
          };
        }
        observe() {
          return undefined;
        }
        disconnect() {
          trigger = null;
        }
      }
      globalThis.IntersectionObserver = FakeObserver as unknown as typeof IntersectionObserver;
    });

    afterEach(() => {
      globalThis.IntersectionObserver = original;
    });

    it('waits until it scrolls near the viewport before fetching', async () => {
      const getHistory = vi.spyOn(api, 'getHistory').mockResolvedValue(history('AMD', [1, 2]));
      render(<Sparkline symbol="AMD" />);
      await settle();
      expect(getHistory).not.toHaveBeenCalled();
      act(() => {
        trigger?.(false);
      });
      expect(getHistory).not.toHaveBeenCalled();
      act(() => {
        trigger?.(true);
      });
      await settle();
      expect(getHistory).toHaveBeenCalledTimes(1);
      expect(sparklines()[0]).toHaveAttribute('data-status', 'ready');
      expect(trigger).toBeNull();
    });
  });
});
