import { normalizeSymbol, validateSymbol } from '../../domain/symbols';
import type { Instrument } from '../../domain/types';

/** Pure rules behind the symbol search combobox. */

export type SearchOption =
  | { kind: 'instrument'; symbol: string; instrument: Instrument }
  /** The query itself, offered when it is a valid symbol that the results don't list. */
  | { kind: 'typed'; symbol: string };

export function optionKey(option: SearchOption): string {
  return `${option.kind}:${option.symbol}`;
}

/**
 * Options for a query. Once the results for it have settled, the add variant also offers the typed
 * symbol when they don't include it: as the only option when nothing matched, else last so a
 * listed match stays the default.
 */
export function buildOptions(
  variant: 'global' | 'add',
  query: string,
  results: readonly Instrument[],
  settled = true,
): SearchOption[] {
  const options: SearchOption[] = results.map((instrument) => ({
    kind: 'instrument',
    symbol: instrument.symbol,
    instrument,
  }));
  if (variant !== 'add' || !settled) return options;
  const typed = validateSymbol(query);
  if (!typed.ok || results.some((r) => r.symbol === typed.value)) return options;
  return [...options, { kind: 'typed', symbol: typed.value }];
}

/** The option Enter picks until the user moves the highlight: an exact symbol match, else the first. */
export function defaultActiveIndex(options: readonly SearchOption[], query: string): number {
  if (options.length === 0) return -1;
  const symbol = normalizeSymbol(query);
  const exact = options.findIndex((o) => o.kind === 'instrument' && o.symbol === symbol);
  return exact >= 0 ? exact : 0;
}

/** Moves the highlight one step, wrapping at both ends. From no highlight, Down goes to the first. */
export function stepActiveIndex(index: number, count: number, step: 1 | -1): number {
  if (count === 0) return -1;
  if (index < 0) return step === 1 ? 0 : count - 1;
  return (index + step + count) % count;
}
