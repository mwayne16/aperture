import type { ApiErrorBody } from '@aperture/shared/errors';
import type { HealthResponse } from '@aperture/shared/health';
import { IsInt, IsString, Length, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from './app.js';
import { createDataSource } from './db/dataSource.js';
import { validateRequest } from './http/validateRequest.js';
import { openTestDatabase, testConfig } from './test/database.js';

// ** Never opened: these tests cover the HTTP layer, and the health check reads it as a database that is down.
const closedDataSource = createDataSource(testConfig.databaseUrl);

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

const buildTestApp = () =>
  buildApp({ config: testConfig, dataSource: closedDataSource, marketData: null }, { logger: false });
let app = buildTestApp();

afterEach(async () => {
  await app.close();
  app = buildTestApp();
});

describe('GET /health', () => {
  it('reports the version, the database and how market data is configured', async () => {
    const dataSource = await openTestDatabase();
    const healthy = buildApp(
      { config: testConfig, dataSource, marketData: null, redis: { ready: true } },
      { logger: false },
    );
    try {
      const response = await healthy.inject({ method: 'GET', url: '/health' });
      expect(response.statusCode).toBe(200);
      const body = response.json<HealthResponse>();
      expect(body).toMatchObject({
        status: 'ok',
        version: '0.0.0',
        database: 'up',
        redis: 'up',
        marketData: { provider: 'alpaca', feed: 'iex', configured: false },
      });
      expect(body.uptimeSeconds).toBeGreaterThanOrEqual(0);
    } finally {
      await healthy.close();
      await dataSource.destroy();
    }
  });

  it('answers 503 while the database is down', async () => {
    const response = await app.inject({ method: 'GET', url: '/health' });
    expect(response.statusCode).toBe(503);
    expect(response.json<HealthResponse>()).toMatchObject({ status: 'unavailable', database: 'down', redis: 'down' });
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

  it('answers UNAVAILABLE when the database cannot be reached', async () => {
    app.get('/boom', () => {
      throw Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:5432'), { code: 'ECONNREFUSED' });
    });
    const response = await app.inject({ method: 'GET', url: '/boom' });
    expect(response.statusCode).toBe(503);
    expect(response.json<ApiErrorBody>().error.code).toBe('UNAVAILABLE');
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
