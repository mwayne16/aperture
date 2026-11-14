import { ALERT_CONDITIONS, ALERT_TAGS, type CreateAlertInput } from './alerts.js';
import { validateSymbol } from './symbols.js';

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

/** Checks one untrusted field value. Returns the problem to show, or null when the value is valid. */
type FieldRule = (value: unknown) => string | null;

function isOneOf<T>(options: readonly T[], value: unknown): value is T {
  return (options as readonly unknown[]).includes(value);
}

export const alertFieldRules = {
  symbol: (value) => {
    if (typeof value !== 'string') return 'Enter a symbol.';
    const result = validateSymbol(value);
    return result.ok ? null : result.reason;
  },
  condition: (value) => (isOneOf(ALERT_CONDITIONS, value) ? null : 'Condition must be "above" or "below".'),
  targetPrice: (value) => {
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
      return 'Enter a target price greater than 0.';
    }
    return value > MAX_TARGET_PRICE ? `Target price must be ${MAX_TARGET_PRICE} or less.` : null;
  },
  tag: (value) => (isOneOf(ALERT_TAGS, value) ? null : 'Tag must be "buy" or "sell".'),
  enabled: (value) => (typeof value === 'boolean' ? null : 'Enabled must be true or false.'),
  note: (value) => {
    if (value === null) return null;
    if (typeof value !== 'string') return 'Note must be text.';
    return value.trim().length > NOTE_MAX_LENGTH ? `Use ${NOTE_MAX_LENGTH} characters or fewer.` : null;
  },
} satisfies Record<keyof CreateAlertInput, FieldRule>;

const FIELD_ORDER = ['symbol', 'condition', 'targetPrice', 'tag', 'enabled', 'note'] as const;
const REQUIRED_ON_CREATE: ReadonlySet<keyof CreateAlertInput> = new Set([
  'symbol',
  'condition',
  'targetPrice',
  'tag',
]);

/**
 * Validates alert fields from typed or untyped callers. On create every required field is checked;
 * on update only the fields present, and the symbol never, because it can't change. Returns one error
 * per invalid field, in form order.
 */
export function validateAlertFields(
  input: Partial<Record<keyof CreateAlertInput, unknown>>,
  mode: 'create' | 'update',
): AlertFieldError[] {
  const errors: AlertFieldError[] = [];
  for (const field of FIELD_ORDER) {
    if (mode === 'update' && field === 'symbol') continue;
    const value = input[field];
    if (value === undefined && !(mode === 'create' && REQUIRED_ON_CREATE.has(field))) continue;
    const message = alertFieldRules[field](value);
    if (message !== null) errors.push({ field, message });
  }
  return errors;
}
