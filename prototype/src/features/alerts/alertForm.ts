import type { ApiError } from '../../data/api';
import { validateAlertFields } from '../../domain/alertRules';
import { normalizeSymbol } from '../../domain/symbols';
import type {
  AlertCondition,
  AlertTag,
  CreateAlertInput,
  PriceAlert,
  UpdateAlertInput,
} from '../../domain/types';

/** Alert dialog form logic: raw field text in, typed API input and per-field errors out. */

export interface AlertFormValues {
  symbol: string;
  condition: AlertCondition;
  /** Raw text as typed; parsed by parsePriceInput. */
  targetPrice: string;
  tag: AlertTag;
  note: string;
  enabled: boolean;
}

export type AlertFormField = keyof AlertFormValues;
export type AlertFormErrors = Partial<Record<AlertFormField, string>>;

const FORM_FIELDS: readonly AlertFormField[] = [
  'symbol',
  'condition',
  'targetPrice',
  'tag',
  'note',
  'enabled',
];

export function createFormValues(presetSymbol: string | null): AlertFormValues {
  return {
    symbol: presetSymbol ?? '',
    condition: 'above',
    targetPrice: '',
    tag: 'buy',
    note: '',
    enabled: true,
  };
}

export function editFormValues(alert: PriceAlert): AlertFormValues {
  return {
    symbol: alert.symbol,
    condition: alert.condition,
    // ** Plain digits without grouping, so the field round-trips through parsePriceInput unchanged.
    targetPrice: String(alert.targetPrice),
    tag: alert.tag,
    note: alert.note ?? '',
    enabled: alert.enabled,
  };
}

// Digits with optional thousands separators and decimals, e.g. "1,234.5", "200", "200.", ".5", "$ 12".
const PRICE_TEXT = /^\$?\s*(?:\d{1,3}(?:,\d{3})+|\d+)?(?:\.\d*)?$/;

/** Parses a typed price. Returns NaN for blank or malformed text so validation reports it. */
export function parsePriceInput(text: string): number {
  const trimmed = text.trim();
  if (!PRICE_TEXT.test(trimmed) || !/\d/.test(trimmed)) return Number.NaN;
  return Number(trimmed.replace(/[$,\s]/g, ''));
}

function noteValue(note: string): string | null {
  const trimmed = note.trim();
  return trimmed === '' ? null : trimmed;
}

export function toCreateInput(values: AlertFormValues): CreateAlertInput {
  return {
    symbol: normalizeSymbol(values.symbol),
    condition: values.condition,
    targetPrice: parsePriceInput(values.targetPrice),
    tag: values.tag,
    enabled: values.enabled,
    note: noteValue(values.note),
  };
}

/** Same rules as the API (validateAlertFields), keyed by form field. */
export function validateForm(values: AlertFormValues): AlertFormErrors {
  const errors: AlertFormErrors = {};
  for (const error of validateAlertFields(toCreateInput(values), 'create')) {
    if (isFormField(error.field)) errors[error.field] ??= error.message;
  }
  return errors;
}

/** Only the fields that differ from the saved alert, so an edit never overwrites anything else. */
export function toUpdateInput(original: PriceAlert, values: AlertFormValues): UpdateAlertInput {
  const next = toCreateInput(values);
  const update: UpdateAlertInput = {};
  if (next.condition !== original.condition) update.condition = next.condition;
  if (next.targetPrice !== original.targetPrice) update.targetPrice = next.targetPrice;
  if (next.tag !== original.tag) update.tag = next.tag;
  if (next.enabled !== original.enabled) update.enabled = next.enabled;
  if ((next.note ?? null) !== original.note) update.note = next.note ?? null;
  return update;
}

/**
 * Whether the alert can fire on the next qualifying trade after this save. The server re-arms an
 * alert when its condition or target changes or when it is re-enabled.
 */
export function armedAfterSave(original: PriceAlert | null, update: UpdateAlertInput): boolean {
  if (original === null || original.armed) return true;
  return (
    update.condition !== undefined ||
    update.targetPrice !== undefined ||
    (update.enabled === true && !original.enabled)
  );
}

function isFormField(field: string): field is AlertFormField {
  return (FORM_FIELDS as readonly string[]).includes(field);
}

/**
 * Splits an API error into field errors (by the first segment of each detail's path) and one
 * message for everything that has no field in the form.
 */
export function errorsFromApi(error: ApiError): { fields: AlertFormErrors; form: string | null } {
  const fields: AlertFormErrors = {};
  const other: string[] = [];
  for (const detail of error.details) {
    const field = detail.field.split('.')[0] ?? '';
    if (isFormField(field)) fields[field] ??= detail.message;
    else other.push(detail.message);
  }
  const form = other.length > 0 ? other.join(' ') : error.details.length === 0 ? error.message : null;
  return { fields, form };
}
