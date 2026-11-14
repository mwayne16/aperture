import { validateSymbol } from './symbols';
import type { AlertCondition, AlertTag, CreateAlertInput } from './types';

/**
 * Alert input rules, shared by the alert form and the API so both report the same field errors.
 *
 * - Symbol: see validateSymbol.
 * - Condition is "above" or "below"; tag is "buy" or "sell".
 * - Target price: a finite number greater than 0 and at most MAX_TARGET_PRICE.
 * - Note: optional, at most NOTE_MAX_LENGTH characters after trimming.
 */

export const NOTE_MAX_LENGTH = 500;
export const MAX_TARGET_PRICE = 1_000_000;

interface AlertFieldError {
  field: keyof CreateAlertInput;
  message: string;
}

function isCondition(value: unknown): value is AlertCondition {
  return value === 'above' || value === 'below';
}

function isTag(value: unknown): value is AlertTag {
  return value === 'buy' || value === 'sell';
}

/**
 * Validates alert fields from typed or untyped callers. On create every required field is checked;
 * on update only the fields present. Returns one error per invalid field, in form order.
 */
export function validateAlertFields(
  input: Partial<Record<keyof CreateAlertInput, unknown>>,
  mode: 'create' | 'update',
): AlertFieldError[] {
  const errors: AlertFieldError[] = [];
  const required = mode === 'create';
  if (required) {
    const symbol = typeof input.symbol === 'string' ? validateSymbol(input.symbol) : null;
    if (!symbol?.ok) errors.push({ field: 'symbol', message: symbol?.reason ?? 'Enter a symbol.' });
  }
  if ((required || input.condition !== undefined) && !isCondition(input.condition)) {
    errors.push({ field: 'condition', message: 'Condition must be "above" or "below".' });
  }
  if (required || input.targetPrice !== undefined) {
    const price = input.targetPrice;
    if (typeof price !== 'number' || !Number.isFinite(price) || price <= 0) {
      errors.push({ field: 'targetPrice', message: 'Enter a target price greater than 0.' });
    } else if (price > MAX_TARGET_PRICE) {
      errors.push({ field: 'targetPrice', message: `Target price must be ${MAX_TARGET_PRICE} or less.` });
    }
  }
  if ((required || input.tag !== undefined) && !isTag(input.tag)) {
    errors.push({ field: 'tag', message: 'Tag must be "buy" or "sell".' });
  }
  if (input.enabled !== undefined && typeof input.enabled !== 'boolean') {
    errors.push({ field: 'enabled', message: 'Enabled must be true or false.' });
  }
  if (input.note !== undefined && input.note !== null) {
    if (typeof input.note !== 'string') {
      errors.push({ field: 'note', message: 'Note must be text.' });
    } else if (input.note.trim().length > NOTE_MAX_LENGTH) {
      errors.push({ field: 'note', message: `Use ${NOTE_MAX_LENGTH} characters or fewer.` });
    }
  }
  return errors;
}
