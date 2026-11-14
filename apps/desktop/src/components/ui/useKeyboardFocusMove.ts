import { useRef, type FocusEvent } from 'react';

/**
 * Tells whether focus inside a roving group moved because of a key press in that group, so
 * selection can follow keyboard focus while clicks and programmatic focus leave it alone.
 * Spread `groupHandlers` on the group and call `movedByKeyboard()` from an item's onFocus.
 */
export function useKeyboardFocusMove() {
  const keyboardMove = useRef(false);
  return {
    groupHandlers: {
      onKeyDown: () => {
        keyboardMove.current = true;
      },
      onPointerDown: () => {
        keyboardMove.current = false;
      },
      onBlur: (e: FocusEvent<HTMLElement>) => {
        const stillInside = e.relatedTarget instanceof Node && e.currentTarget.contains(e.relatedTarget);
        if (!stillInside) keyboardMove.current = false;
      },
    },
    movedByKeyboard: () => keyboardMove.current,
  };
}
