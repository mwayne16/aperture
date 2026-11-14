import type { AriaAttributes } from 'react';

/** Whether an aria-invalid value marks a field invalid. "grammar" and "spelling" count; "false" does not. */
export function isInvalid(value: AriaAttributes['aria-invalid']): boolean {
  return value !== undefined && value !== false && value !== 'false';
}
