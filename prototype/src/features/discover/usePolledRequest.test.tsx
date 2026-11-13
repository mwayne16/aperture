import { act, renderHook } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../data/api';
import { usePolledRequest } from './usePolledRequest';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Lets pending promises settle and runs timers due within `ms`, inside act. */
async function advance(ms = 0): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

const failure = () => new ApiError('UNAVAILABLE', 'Service down.', 503);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(Date.UTC(2026, 10, 9, 15, 0, 0));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('usePolledRequest', () => {
  it('loads, then shows the data with the time it arrived', async () => {
    const request = vi.fn(() => Promise.resolve('first'));
    const { result } = renderHook(() => usePolledRequest('k', request, { refreshMs: null }));
    expect(result.current.view).toEqual({ status: 'loading' });
    await advance();
    expect(result.current.view).toEqual({
      status: 'ready',
      data: 'first',
      receivedAt: Date.UTC(2026, 10, 9, 15, 0, 0),
      refreshError: null,
    });
  });

  it('asks again refreshMs after each answer, and never without a refresh interval', async () => {
    let n = 0;
    const request = vi.fn(() => Promise.resolve(++n));
    const { result } = renderHook(() => usePolledRequest('k', request, { refreshMs: 1000 }));
    await advance();
    expect(result.current.view).toMatchObject({ data: 1 });
    await advance(999);
    expect(request).toHaveBeenCalledTimes(1);
    await advance(1);
    expect(request).toHaveBeenCalledTimes(2);
    expect(result.current.view).toMatchObject({ data: 2 });

    const once = vi.fn(() => Promise.resolve('x'));
    renderHook(() => usePolledRequest('once', once, { refreshMs: null }));
    await advance(60_000);
    expect(once).toHaveBeenCalledTimes(1);
  });

  it('waits for a slow answer before scheduling the next request', async () => {
    const slow = deferred<string>();
    const request = vi.fn().mockReturnValueOnce(slow.promise).mockResolvedValue('later');
    renderHook(() => usePolledRequest('k', request, { refreshMs: 1000 }));
    await advance(5000);
    expect(request).toHaveBeenCalledTimes(1);
    slow.resolve('slow');
    await advance(1000);
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('shows an error on a failed first load, and Retry shows loading until the next answer', async () => {
    const retryAnswer = deferred<string>();
    const request = vi.fn().mockRejectedValueOnce(failure()).mockReturnValueOnce(retryAnswer.promise);
    const { result } = renderHook(() => usePolledRequest('k', request, { refreshMs: null }));
    await advance();
    expect(result.current.view).toEqual({ status: 'error', message: 'Service down.' });

    act(() => {
      result.current.retry();
    });
    expect(result.current.view).toEqual({ status: 'loading' });
    retryAnswer.resolve('back');
    await advance();
    expect(result.current.view).toMatchObject({ status: 'ready', data: 'back', refreshError: null });
  });

  it('uses a generic message for errors that are not API errors', async () => {
    const request = vi.fn().mockRejectedValue(new TypeError('boom'));
    const { result } = renderHook(() => usePolledRequest('k', request, { refreshMs: null }));
    await advance();
    expect(result.current.view).toEqual({ status: 'error', message: 'Something went wrong. Try again.' });
  });

  it('keeps the last data when a refresh fails, and clears the error once a refresh works', async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce('one')
      .mockRejectedValueOnce(failure())
      .mockResolvedValueOnce('three');
    const { result } = renderHook(() => usePolledRequest('k', request, { refreshMs: 1000 }));
    await advance();
    const firstArrival = result.current.view.status === 'ready' ? result.current.view.receivedAt : null;
    await advance(1000);
    expect(result.current.view).toEqual({
      status: 'ready',
      data: 'one',
      receivedAt: firstArrival,
      refreshError: 'Service down.',
    });
    await advance(1000);
    expect(result.current.view).toMatchObject({ data: 'three', refreshError: null });
  });

  it('never shows a late answer for a previous key', async () => {
    const old = deferred<string>();
    const fresh = deferred<string>();
    const request = vi.fn().mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise);
    const { result, rerender } = renderHook(({ k }) => usePolledRequest(k, request, { refreshMs: null }), {
      initialProps: { k: 'stocks' },
    });
    rerender({ k: 'crypto' });
    old.resolve('stock data');
    await advance();
    expect(result.current.view).toEqual({ status: 'loading' });
    fresh.resolve('crypto data');
    await advance();
    expect(result.current.view).toMatchObject({ data: 'crypto data' });
  });

  it('drops the previous key’s data at once when the key changes', async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce('stock data')
      .mockReturnValueOnce(new Promise(() => undefined));
    const { result, rerender } = renderHook(({ k }) => usePolledRequest(k, request, { refreshMs: null }), {
      initialProps: { k: 'stocks' },
    });
    await advance();
    expect(result.current.view).toMatchObject({ data: 'stock data' });
    rerender({ k: 'crypto' });
    expect(result.current.view).toEqual({ status: 'loading' });
  });

  it('waits for a new answer when coming back to a key instead of showing its old error', async () => {
    const back = deferred<string>();
    const request = vi
      .fn()
      .mockRejectedValueOnce(failure())
      .mockReturnValueOnce(new Promise(() => undefined))
      .mockReturnValueOnce(back.promise);
    const { result, rerender } = renderHook(({ k }) => usePolledRequest(k, request, { refreshMs: null }), {
      initialProps: { k: 'stocks' },
    });
    await advance();
    expect(result.current.view.status).toBe('error');
    rerender({ k: 'crypto' });
    rerender({ k: 'stocks' });
    expect(result.current.view).toEqual({ status: 'loading' });
    back.resolve('stock data');
    await advance();
    expect(result.current.view).toMatchObject({ data: 'stock data' });
  });

  it('shows data at hand for the key instead of loading', () => {
    const { result } = renderHook(() =>
      usePolledRequest('k', () => new Promise<string>(() => undefined), {
        refreshMs: null,
        peek: () => 'cached',
      }),
    );
    expect(result.current.view).toEqual({
      status: 'ready',
      data: 'cached',
      receivedAt: null,
      refreshError: null,
    });
  });

  it('stops polling on unmount and ignores an answer that arrives afterwards', async () => {
    const pending = deferred<string>();
    const request = vi.fn().mockReturnValueOnce(pending.promise).mockResolvedValue('more');
    const { unmount } = renderHook(() => usePolledRequest('k', request, { refreshMs: 1000 }));
    unmount();
    pending.resolve('late');
    await advance(10_000);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('keeps a single polling loop under StrictMode', async () => {
    let n = 0;
    const request = vi.fn(() => Promise.resolve(++n));
    const { result } = renderHook(() => usePolledRequest('k', request, { refreshMs: 1000 }), {
      wrapper: StrictMode,
    });
    await advance();
    const afterMount = request.mock.calls.length;
    expect(result.current.view.status).toBe('ready');
    await advance(1000);
    expect(request.mock.calls.length).toBe(afterMount + 1);
    await advance(1000);
    expect(request.mock.calls.length).toBe(afterMount + 2);
  });
});
