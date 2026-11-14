import { useState } from 'react';
import { flashDirection, flashIsDue, type FlashDirection } from './marketModel';

interface PriceFlash {
  direction: FlashDirection | null;
  /** Changes on every flash. Use it as the flashing element's key so the animation restarts. */
  key: number;
}

interface FlashState extends PriceFlash {
  value: number | null;
  /** Trade time of the last flash. */
  flashedAt: number | null;
}

/**
 * Tracks a price and reports which way it last moved, so the cell can flash up or down. A cell
 * flashes at most once per FLASH_MIN_INTERVAL_MS of trade time; changes in between update silently.
 */
export function usePriceFlash(value: number | null, tradedAt: number | null): PriceFlash {
  const [state, setState] = useState<FlashState>({ value, direction: null, key: 0, flashedAt: null });
  if (!Object.is(state.value, value)) {
    // ** Adjusting state while rendering (instead of in an effect) shows the flash in the same
    // render as the new price.
    const direction = flashDirection(state.value, value);
    const next: FlashState =
      direction !== null && flashIsDue(state.flashedAt, tradedAt)
        ? { value, direction, key: state.key + 1, flashedAt: tradedAt }
        : { ...state, value };
    setState(next);
    return next;
  }
  return state;
}
