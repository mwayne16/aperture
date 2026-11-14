import { useEffect, useMemo, useRef } from 'react';

/** How long after a drop the release click may still arrive. */
const RELEASE_CLICK_WINDOW_MS = 100;

interface DragClickGuard {
  onDragEnd: () => void;
  onDragCancel: () => void;
}

function cancelClick(event: MouseEvent): void {
  event.preventDefault();
  event.stopPropagation();
}

/**
 * Cancels the click the browser fires when a dragged row is dropped, so a drop never opens the link
 * under the pointer. dnd-kit hides that click from React handlers, but a link would still follow
 * its href, so the click is cancelled on the window before it reaches the link.
 */
export function useDragClickGuard(): DragClickGuard {
  const disarm = useRef<(() => void) | null>(null);

  useEffect(
    () => () => {
      disarm.current?.();
    },
    [],
  );

  return useMemo(() => {
    const arm = () => {
      disarm.current?.();
      window.addEventListener('click', cancelClick, { capture: true, once: true });
      // ** A drop outside the page fires no click, so stop waiting for one after a moment.
      const timer = setTimeout(() => {
        disarm.current?.();
      }, RELEASE_CLICK_WINDOW_MS);
      disarm.current = () => {
        clearTimeout(timer);
        window.removeEventListener('click', cancelClick, { capture: true });
        disarm.current = null;
      };
    };
    return { onDragEnd: arm, onDragCancel: arm };
  }, []);
}
