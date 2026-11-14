import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useDragClickGuard } from './useDragClickGuard';

function clickLink(): boolean {
  const link = document.createElement('a');
  link.href = '#/symbol/AAPL';
  document.body.append(link);
  const event = new MouseEvent('click', { bubbles: true, cancelable: true });
  link.dispatchEvent(event);
  link.remove();
  return event.defaultPrevented;
}

describe('useDragClickGuard', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('cancels the click that follows a drop', () => {
    const { result } = renderHook(() => useDragClickGuard());
    result.current.onDragEnd();
    expect(clickLink()).toBe(true);
  });

  it('cancels only that one click', () => {
    const { result } = renderHook(() => useDragClickGuard());
    result.current.onDragCancel();
    clickLink();
    expect(clickLink()).toBe(false);
  });

  it('lets clicks through once the moment after a drop has passed', () => {
    const { result } = renderHook(() => useDragClickGuard());
    result.current.onDragEnd();
    vi.advanceTimersByTime(200);
    expect(clickLink()).toBe(false);
  });

  it('stops guarding when the component unmounts', () => {
    const { result, unmount } = renderHook(() => useDragClickGuard());
    result.current.onDragEnd();
    unmount();
    expect(clickLink()).toBe(false);
  });

  it('leaves clicks alone when nothing was dragged', () => {
    renderHook(() => useDragClickGuard());
    expect(clickLink()).toBe(false);
  });
});
