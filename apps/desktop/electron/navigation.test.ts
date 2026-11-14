import { describe, expect, it } from 'vitest';
import { isAppUrl, isExternalWebUrl, isPopOutUrl } from './navigation';

const DEV = 'http://localhost:5173/';
const PACKAGED = 'file:///C:/Program%20Files/Aperture/resources/app/out/renderer/index.html';

describe('isAppUrl', () => {
  it('accepts the dev server document with any hash route', () => {
    expect(isAppUrl('http://localhost:5173/', DEV)).toBe(true);
    expect(isAppUrl('http://localhost:5173/#/symbol/AAPL', DEV)).toBe(true);
  });

  it('rejects other origins and other paths on the dev server', () => {
    expect(isAppUrl('http://localhost:5174/', DEV)).toBe(false);
    expect(isAppUrl('https://example.com/', DEV)).toBe(false);
    expect(isAppUrl('http://localhost:5173/other.html', DEV)).toBe(false);
  });

  it('accepts only the bundled index.html in a packaged build', () => {
    expect(isAppUrl(`${PACKAGED}#/alerts`, PACKAGED)).toBe(true);
    expect(isAppUrl('file:///C:/Windows/System32/drivers/etc/hosts', PACKAGED)).toBe(false);
    expect(isAppUrl('https://example.com/', PACKAGED)).toBe(false);
  });

  it('rejects text that is not a URL', () => {
    expect(isAppUrl('not a url', DEV)).toBe(false);
    expect(isAppUrl(DEV, 'not a url')).toBe(false);
  });
});

describe('isPopOutUrl', () => {
  it('accepts the app document on a pop-out route', () => {
    expect(isPopOutUrl('http://localhost:5173/#/window/symbol/AAPL', DEV)).toBe(true);
    expect(isPopOutUrl(`${PACKAGED}#/window/symbol/BTC%2FUSD`, PACKAGED)).toBe(true);
  });

  it('rejects ordinary app routes and pop-out routes on other origins', () => {
    expect(isPopOutUrl('http://localhost:5173/#/symbol/AAPL', DEV)).toBe(false);
    expect(isPopOutUrl('https://example.com/#/window/symbol/AAPL', DEV)).toBe(false);
  });
});

describe('isExternalWebUrl', () => {
  it('sends http and https pages to the browser and nothing else', () => {
    expect(isExternalWebUrl('https://example.com/article')).toBe(true);
    expect(isExternalWebUrl('http://example.com/')).toBe(true);
    expect(isExternalWebUrl('file:///C:/secret.txt')).toBe(false);
    expect(isExternalWebUrl('javascript:alert(1)')).toBe(false);
    expect(isExternalWebUrl('nonsense')).toBe(false);
  });
});
