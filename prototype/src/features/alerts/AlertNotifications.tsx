import { useEffect } from 'react';
import { dismissToast, showToast } from '../../components/ui/toastStore';
import { useConnectionStore } from '../../data/connectionStore';
import { realtime } from '../../data/dataLayer';
import { triggerNotice } from './alertDisplay';
import { useAlertStore } from './alertStore';

const TRIGGER_TOAST_MS = 8000;

/**
 * Listens for server-side alert results while mounted: each new trigger is logged and shown as a
 * toast, and pushed alert state (armed, last triggered) is merged into the alert store.
 * Events are de-duplicated by id in the store, so a re-delivered event never toasts twice.
 * Native desktop notifications arrive with the Electron shell; they will hook in here.
 */
export function AlertNotifications() {
  useEffect(() => {
    const toastByAlert = new Map<string, string>();
    const offAlert = realtime.onAlert((event) => {
      if (!useAlertStore.getState().recordEvent(event)) return;
      // ** A price hovering at the target can re-trigger every few seconds. Each alert keeps one
      // toast showing its latest trigger, and the trigger log keeps every event.
      const previous = toastByAlert.get(event.alertId);
      if (previous !== undefined) dismissToast(previous);
      const notice = triggerNotice(event, useConnectionStore.getState().connection.simulated);
      toastByAlert.set(event.alertId, showToast({ tone: 'info', durationMs: TRIGGER_TOAST_MS, ...notice }));
    });
    const offUpdated = realtime.onAlertUpdated((alert) => {
      useAlertStore.getState().applyServerUpdate(alert);
    });
    return () => {
      offAlert();
      offUpdated();
    };
  }, []);

  return null;
}
