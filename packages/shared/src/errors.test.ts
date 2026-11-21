import { describe, expect, it } from 'vitest';
import { API_ERROR_CODES, API_ERROR_STATUS } from './errors.js';

describe('API error contract', () => {
  it('gives every code an HTTP error status', () => {
    for (const code of API_ERROR_CODES) {
      expect(API_ERROR_STATUS[code], code).toBeGreaterThanOrEqual(400);
    }
  });

  it('keeps client errors in the 4xx range and server or provider failures in 5xx', () => {
    expect(API_ERROR_STATUS.VALIDATION_ERROR).toBe(400);
    expect(API_ERROR_STATUS.NOT_FOUND).toBe(404);
    expect(API_ERROR_STATUS.CONFLICT).toBe(409);
    expect(API_ERROR_STATUS.PROVIDER_ERROR).toBe(502);
    expect(API_ERROR_STATUS.UNAVAILABLE).toBe(503);
    expect(API_ERROR_STATUS.INTERNAL).toBe(500);
    expect(API_ERROR_STATUS.FORBIDDEN).toBe(403);
  });
});
