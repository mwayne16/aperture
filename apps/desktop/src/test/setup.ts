import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach } from 'vitest';

// jsdom has no layout, so Radix's size tracking gets an observer that never reports.
class NoopResizeObserver {
  observe() {
    return undefined;
  }
  unobserve() {
    return undefined;
  }
  disconnect() {
    return undefined;
  }
}
globalThis.ResizeObserver = NoopResizeObserver;

// ** The app routes on the URL hash, which jsdom keeps between tests; every test starts on the dashboard.
beforeEach(() => {
  window.location.hash = '';
});

afterEach(() => {
  cleanup();
  localStorage.clear();
});
