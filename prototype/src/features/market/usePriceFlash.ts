import { useState } from 'react';
import { flashDirection, type FlashDirection } from './marketModel';

interface PriceFlash {
  direction: FlashDirection | null;
  /** Changes on every flash. Use it as the flashing element's key so the animation restarts. */
  key: number;
}

interface FlashState extends PriceFlash {
  value: number | null;
}

/** Tracks a price and reports which way it last moved, so the cell can flash up or down. */
export function usePriceFlash(value: number | null): PriceFlash {
  const [state, setState] = useState<FlashState>({ value, direction: null, key: 0 });
  if (!Object.is(state.value, value)) {
    // ** Adjusting state while rendering (instead of in an effect) shows the flash in the same
    // render as the new price.
    const direction = flashDirection(state.value, value);
    const next: FlashState = { value, direction, key: direction === null ? state.key : state.key + 1 };
    setState(next);
    return next;
  }
  return state;
}
