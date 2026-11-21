import { MAX_REALTIME_SUBSCRIPTIONS, type RealtimeClientMessage } from '@aperture/shared/realtime';
import { symbolProblem } from '@aperture/shared/symbols';
import { IsIn } from 'class-validator';
import { FollowsRule } from '../validation/rules.js';
import { transformAndValidate, type ClassType } from '../validation/validate.js';

function symbolListProblem(value: unknown): string | null {
  if (!Array.isArray(value)) return 'Symbols must be a list.';
  if (value.length === 0) return 'Enter at least one symbol.';
  if (value.length > MAX_REALTIME_SUBSCRIPTIONS) {
    return `Subscribe to at most ${String(MAX_REALTIME_SUBSCRIPTIONS)} symbols at a time.`;
  }
  const index = value.findIndex((symbol) => symbolProblem(symbol) !== null);
  return index === -1 ? null : `Entry ${String(index + 1)} is not a valid symbol.`;
}

class SubscribeDto {
  @IsIn(['subscribe'])
  type!: 'subscribe';

  @FollowsRule(symbolListProblem)
  symbols!: string[];
}

class UnsubscribeDto {
  @IsIn(['unsubscribe'])
  type!: 'unsubscribe';

  @FollowsRule(symbolListProblem)
  symbols!: string[];
}

class FocusDto {
  @IsIn(['focus'])
  type!: 'focus';

  /** Null clears the focus. */
  @FollowsRule((value) => (value === null ? null : symbolProblem(value)))
  symbol!: string | null;
}

const DTOS: Readonly<Record<RealtimeClientMessage['type'], ClassType<object>>> = {
  subscribe: SubscribeDto,
  unsubscribe: UnsubscribeDto,
  focus: FocusDto,
};

export type ParsedMessage = { ok: true; message: RealtimeClientMessage } | { ok: false; error: string };

/**
 * Parses one message from the app. Like HTTP input it is untrusted: it must be a JSON object of a known
 * type, with every field checked and no extra fields. Errors say what was wrong without echoing the input.
 */
export function parseClientMessage(raw: string): ParsedMessage {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return { ok: false, error: 'Messages must be JSON.' };
  }
  const type = typeof value === 'object' && value !== null ? (value as { type?: unknown }).type : undefined;
  if (typeof type !== 'string' || !Object.hasOwn(DTOS, type)) {
    return { ok: false, error: 'Message type must be subscribe, unsubscribe or focus.' };
  }
  const result = transformAndValidate(DTOS[type as RealtimeClientMessage['type']], value);
  if (!result.ok) return { ok: false, error: result.details[0]?.message ?? 'The message is invalid.' };
  return { ok: true, message: result.value as RealtimeClientMessage };
}
