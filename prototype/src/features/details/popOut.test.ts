import { afterEach, describe, expect, it, vi } from 'vitest';
import { openPopOut, popOutUrl, popOutWindowName } from './popOut';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('popOutUrl', () => {
  it('replaces the hash of the current address with the page path', () => {
    expect(popOutUrl('/symbol/AAPL', 'http://localhost:5192/#/watchlists/wl-1')).toBe(
      'http://localhost:5192/#/symbol/AAPL',
    );
  });

  it('keeps the query string and works without a hash', () => {
    expect(popOutUrl('/symbol/AAPL', 'http://localhost:5192/index.html?debug=1')).toBe(
      'http://localhost:5192/index.html?debug=1#/symbol/AAPL',
    );
  });

  it('works for an app loaded from a local file', () => {
    expect(popOutUrl('/symbol/BTC%2FUSD', 'file:///D:/apps/aperture/index.html#/')).toBe(
      'file:///D:/apps/aperture/index.html#/symbol/BTC%2FUSD',
    );
  });
});

describe('popOutWindowName', () => {
  it('names one window per page, using only safe characters', () => {
    expect(popOutWindowName('/symbol/AAPL')).toBe('aperture-symbol-AAPL');
    expect(popOutWindowName('/symbol/BTC%2FUSD')).toBe('aperture-symbol-BTC-2FUSD');
    expect(popOutWindowName('/symbol/AAPL')).not.toBe(popOutWindowName('/symbol/MSFT'));
  });
});

describe('openPopOut', () => {
  it('opens the page as a named popup and focuses it', () => {
    const focus = vi.fn();
    const open = vi.spyOn(window, 'open').mockReturnValue({ focus } as unknown as Window);
    expect(openPopOut('/symbol/AAPL')).toBe(true);
    expect(open).toHaveBeenCalledWith(
      expect.stringMatching(/#\/symbol\/AAPL$/),
      'aperture-symbol-AAPL',
      expect.stringContaining('popup'),
    );
    expect(focus).toHaveBeenCalled();
  });

  it('reports a blocked popup', () => {
    vi.spyOn(window, 'open').mockReturnValue(null);
    expect(openPopOut('/symbol/AAPL')).toBe(false);
  });
});
