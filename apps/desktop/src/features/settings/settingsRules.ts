import { CHART_RANGES, type ChartRange } from '../../domain/types';

const CHART_STYLES = ['candles', 'line'] as const;
type ChartStyle = (typeof CHART_STYLES)[number];

export interface Settings {
  /** Range a stock chart opens with. */
  defaultChartRange: ChartRange;
  chartStyle: ChartStyle;
  /** Show a toast when an alert triggers. The notification inbox records triggers either way. */
  triggerToasts: boolean;
  /** Show a system notification when an alert triggers while the app isn't in front (desktop app only). */
  desktopNotifications: boolean;
}

export const DEFAULT_SETTINGS: Readonly<Settings> = Object.freeze({
  defaultChartRange: '1D',
  chartStyle: 'candles',
  triggerToasts: true,
  desktopNotifications: true,
});

export function isChartRange(value: unknown): value is ChartRange {
  return typeof value === 'string' && (CHART_RANGES as readonly string[]).includes(value);
}

function isChartStyle(value: unknown): value is ChartStyle {
  return typeof value === 'string' && (CHART_STYLES as readonly string[]).includes(value);
}

/** Checks one setting, so stored data and runtime patches are held to the same rules. */
const VALIDATORS: { [K in keyof Settings]: (value: unknown) => value is Settings[K] } = {
  defaultChartRange: isChartRange,
  chartStyle: isChartStyle,
  triggerToasts: (value): value is boolean => typeof value === 'boolean',
  desktopNotifications: (value): value is boolean => typeof value === 'boolean',
};

const KEYS = Object.keys(VALIDATORS) as (keyof Settings)[];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The valid fields of `patch`. Unknown keys and invalid values are dropped. */
export function validPatch(patch: unknown): Partial<Settings> {
  if (!isRecord(patch)) return {};
  const valid: Partial<Record<keyof Settings, unknown>> = {};
  for (const key of KEYS) {
    if (Object.hasOwn(patch, key) && VALIDATORS[key](patch[key])) valid[key] = patch[key];
  }
  return valid as Partial<Settings>;
}

/**
 * Settings from stored JSON. Each field is checked on its own: a missing or invalid value falls back
 * to its default without discarding the valid ones, and unreadable JSON gives the defaults.
 */
export function parseStoredSettings(text: string | null): Settings {
  if (text === null) return { ...DEFAULT_SETTINGS };
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
  return { ...DEFAULT_SETTINGS, ...validPatch(raw) };
}
