import type { ApiErrorBody } from '@aperture/shared/errors';
import type { HealthResponse } from '@aperture/shared/health';
import { IsInt, IsString, Length, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from './app.js';
import { loadConfig } from './config/loadConfig.js';
import { validateRequest } from './http/validateRequest.js';

const config = loadConfig({
  DATABASE_URL: 'postgres://aperture:aperture@127.0.0.1:5432/aperture',
  REDIS_URL: 'redis://127.0.0.1:6379',
});

class SymbolParams {
  @IsString()
  @Length(1, 10)
  symbol!: string;
}

class LimitQuery {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit!: number;
}

class NoteBody {
  @IsString()
  @Length(1, 20)
  note!: string;
}

let app = buildApp(config, { logger: false });

afterEach(async () => {
  await app.close();
  app = buildApp(config, { logger: false });
});

describe('GET /health', () => {
  it('reports the version and how market data is configured', async () => {
    const response = await app.inject({ method: 'GET', url: '/health' });
    expect(response.statusCode).toBe(200);
    const body = response.json<HealthResponse>();
    expect(body).toMatchObject({
      status: 'ok',
      version: '0.0.0',
      marketData: { provider: 'alpaca', feed: 'iex', configured: false },
    });
    expect(body.uptimeSeconds).toBeGreaterThanOrEqual(0);
  });
});

describe('error responses', () => {
  it('answers unknown routes with NOT_FOUND in the shared error shape', async () => {
    const response = await app.inject({ method: 'GET', url: '/nope' });
    expect(response.statusCode).toBe(404);
    expect(response.json<ApiErrorBody>()).toEqual({
      error: { code: 'NOT_FOUND', message: 'No route for GET /nope.', details: [] },
    });
  });

  it('answers malformed JSON with VALIDATION_ERROR', async () => {
    app.post('/echo', () => ({ ok: true }));
    const response = await app.inject({
      method: 'POST',
      url: '/echo',
      headers: { 'content-type': 'application/json' },
      payload: '{"broken":',
    });
    expect(response.statusCode).toBe(400);
    expect(response.json<ApiErrorBody>().error.code).toBe('VALIDATION_ERROR');
  });

  it('hides the details of unexpected errors', async () => {
    app.get('/boom', () => {
      throw new Error('database password is hunter2');
    });
    const response = await app.inject({ method: 'GET', url: '/boom' });
    expect(response.statusCode).toBe(500);
    expect(response.json<ApiErrorBody>().error).toEqual({
      code: 'INTERNAL',
      message: 'Something went wrong on the server.',
      details: [],
    });
    expect(response.body).not.toContain('hunter2');
  });
});

describe('validateRequest', () => {
  function register() {
    app.post<{ Params: SymbolParams; Querystring: LimitQuery; Body: NoteBody }>(
      '/notes/:symbol',
      { preHandler: validateRequest({ params: SymbolParams, query: LimitQuery, body: NoteBody }) },
      (request) => ({
        symbol: request.params.symbol,
        limit: request.query.limit,
        limitType: typeof request.query.limit,
        note: request.body.note,
        validated: request.body instanceof NoteBody,
      }),
    );
  }

  it('hands the handler validated, converted DTO instances', async () => {
    register();
    const response = await app.inject({
      method: 'POST',
      url: '/notes/AAPL?limit=5',
      payload: { note: 'Earnings soon' },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      symbol: 'AAPL',
      limit: 5,
      limitType: 'number',
      note: 'Earnings soon',
      validated: true,
    });
  });

  it('rejects invalid and unexpected input before the handler runs, listing every field', async () => {
    register();
    const response = await app.inject({
      method: 'POST',
      url: '/notes/TOOLONGSYMBOL?limit=0',
      payload: { note: '', ownerId: 'someone-else' },
    });
    expect(response.statusCode).toBe(400);
    const { error } = response.json<ApiErrorBody>();
    expect(error.code).toBe('VALIDATION_ERROR');
    expect(error.details.map((detail) => detail.field)).toEqual(
      expect.arrayContaining(['symbol', 'limit', 'note', 'ownerId']),
    );
  });

  it('rejects a missing body', async () => {
    register();
    const response = await app.inject({ method: 'POST', url: '/notes/AAPL?limit=5' });
    expect(response.statusCode).toBe(400);
    const fields = response.json<ApiErrorBody>().error.details.map((detail) => detail.field);
    expect(new Set(fields)).toEqual(new Set(['note']));
  });
});
