import type { ApiErrorDetail } from '@aperture/shared/errors';
import type { FastifyRequest, preHandlerAsyncHookHandler } from 'fastify';
import { transformAndValidate, type ClassType } from '../validation/validate.js';
import { ApiHttpError } from './errors.js';

interface RequestDtos {
  params?: ClassType<object>;
  query?: ClassType<object>;
  body?: ClassType<object>;
}

const PARTS = ['params', 'query', 'body'] as const;

/**
 * A route pre-handler that validates the request's params, query and body against DTO classes before
 * the handler runs, and replaces them with the validated instances. Use it on every route that takes
 * input instead of checking fields in handlers; type the route with the same DTOs.
 */
export function validateRequest(dtos: RequestDtos): preHandlerAsyncHookHandler {
  return (request: FastifyRequest) => {
    const details: ApiErrorDetail[] = [];
    for (const part of PARTS) {
      const dto = dtos[part];
      if (!dto) continue;
      const result = transformAndValidate(dto, request[part] ?? {});
      if (result.ok) (request as unknown as Record<string, unknown>)[part] = result.value;
      else details.push(...result.details);
    }
    if (details.length === 0) return Promise.resolve();
    return Promise.reject(new ApiHttpError('VALIDATION_ERROR', details[0]?.message ?? 'The request is invalid.', details));
  };
}
