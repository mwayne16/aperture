import type { ApiErrorDetail } from '@aperture/shared/errors';
import { plainToInstance } from 'class-transformer';
import { validateSync, type ValidationError } from 'class-validator';

export type ClassType<T> = new () => T;

export type ValidationResult<T> = { ok: true; value: T } | { ok: false; details: ApiErrorDetail[] };

/**
 * Turns untrusted input into a validated instance of `cls`: transform the plain object into the DTO
 * class, then validate it. Properties the DTO doesn't declare are rejected, so a client can never set
 * ids, owners or internal flags by sending extra fields. Problems come back as dotted field paths in
 * the API's error shape, without echoing the submitted values.
 */
export function transformAndValidate<T extends object>(cls: ClassType<T>, input: unknown): ValidationResult<T> {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return { ok: false, details: [{ field: '', message: 'Expected a JSON object.' }] };
  }
  const instance = plainToInstance(cls, input);
  const errors = validateSync(instance, {
    whitelist: true,
    forbidNonWhitelisted: true,
    forbidUnknownValues: true,
    validationError: { target: false, value: false },
  });
  if (errors.length > 0) return { ok: false, details: flatten(errors, '') };
  return { ok: true, value: instance };
}

/** Nested and array errors become paths such as "legs.1.price". */
function flatten(errors: readonly ValidationError[], parent: string): ApiErrorDetail[] {
  return errors.flatMap((error) => {
    const field = parent === '' ? error.property : `${parent}.${error.property}`;
    const own = Object.values(error.constraints ?? {}).map((message) => ({ field, message }));
    return [...own, ...flatten(error.children ?? [], field)];
  });
}
