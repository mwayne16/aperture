import { resetDemoData } from '../../data/dataLayer';
import { useAlertStore } from '../alerts/alertStore';
import { useWatchlistStore } from '../watchlists/watchlistStore';

export type ResetOutcome =
  | { ok: true }
  /** `dataReset` is true when the demo data was restored but a store failed to reload it. */
  | { ok: false; dataReset: boolean; message: string };

interface ReloadableStore {
  getState(): { load(options?: { force?: boolean }): Promise<void>; status: string; error: string | null };
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message !== '' ? error.message : 'Unknown error.';
}

/** Reloads one store and returns why it failed, or null when it loaded. */
async function reload(name: string, store: ReloadableStore): Promise<string | null> {
  try {
    // ** Forced, so a load that started before the reset can't hand back the old data.
    await store.getState().load({ force: true });
  } catch (error) {
    // ** load() is documented never to reject; if it does, report it like a failed load.
    return `${name} did not reload: ${errorMessage(error)}`;
  }
  const { status, error } = store.getState();
  return status === 'error' ? `${name} did not reload: ${error ?? 'Unknown error.'}` : null;
}

/**
 * Restores the seeded watchlists and alerts, then reloads both stores so every view shows the demo
 * set. Never rejects: a failed reset or reload comes back as a message the caller can show.
 */
export async function resetDemoAndReload(): Promise<ResetOutcome> {
  try {
    await resetDemoData();
  } catch (error) {
    return { ok: false, dataReset: false, message: errorMessage(error) };
  }
  const failures = (
    await Promise.all([reload('Watchlists', useWatchlistStore), reload('Alerts', useAlertStore)])
  ).filter((failure) => failure !== null);
  return failures.length === 0 ? { ok: true } : { ok: false, dataReset: true, message: failures.join(' ') };
}
