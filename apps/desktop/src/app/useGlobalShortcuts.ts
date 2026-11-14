import { useEffect } from 'react';
import { useUiStore } from './uiStore';

/**
 * Ctrl+K (Cmd+K on macOS) asks the global symbol search to take focus. It does nothing while a
 * modal dialog is open, so it can't pull focus out of the dialog.
 */
export function useGlobalShortcuts(): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const modifier = event.ctrlKey || event.metaKey;
      if (!modifier || event.altKey || event.shiftKey || event.key.toLowerCase() !== 'k') return;
      if (document.querySelector('[role="dialog"][aria-modal="true"]')) return;
      event.preventDefault();
      useUiStore.getState().requestSearchFocus();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, []);
}
