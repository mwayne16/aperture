import { create } from 'zustand';

/**
 * Cross-feature UI state. Features read and write it through these actions only.
 * Domain data (watchlists, alerts, quotes) lives in feature/data stores, not here.
 */

export type AlertDialogState =
  | { open: false }
  | { open: true; mode: 'create'; presetSymbol: string | null }
  | { open: true; mode: 'edit'; alertId: string };

/** Tab shown on the Alerts page, remembered while moving between pages. */
export type AlertsPageTab = 'alerts' | 'log';

export interface UiState {
  /** Symbol shown in the detail panel, or null when nothing is selected. */
  selectedSymbol: string | null;
  alertDialog: AlertDialogState;
  /**
   * Valid symbol typed into the open alert dialog, or null. It is subscribed like the selection, so
   * the dialog can show a live price for a symbol that no watchlist or alert covers yet.
   */
  alertDraftSymbol: string | null;
  alertsPageTab: AlertsPageTab;
  prototypeControlsOpen: boolean;
  /** Increments to ask the global symbol search to take focus (Ctrl+K). */
  searchFocusRequest: number;

  selectSymbol(symbol: string | null): void;
  openCreateAlert(presetSymbol?: string | null): void;
  openEditAlert(alertId: string): void;
  closeAlertDialog(): void;
  setAlertDraftSymbol(symbol: string | null): void;
  setAlertsPageTab(tab: AlertsPageTab): void;
  setPrototypeControlsOpen(open: boolean): void;
  requestSearchFocus(): void;
}

export const useUiStore = create<UiState>()((set) => ({
  selectedSymbol: null,
  alertDialog: { open: false },
  alertDraftSymbol: null,
  alertsPageTab: 'alerts',
  prototypeControlsOpen: false,
  searchFocusRequest: 0,

  selectSymbol: (symbol) => {
    set({ selectedSymbol: symbol });
  },
  openCreateAlert: (presetSymbol = null) => {
    set({ alertDialog: { open: true, mode: 'create', presetSymbol } });
  },
  openEditAlert: (alertId) => {
    set({ alertDialog: { open: true, mode: 'edit', alertId } });
  },
  closeAlertDialog: () => {
    set({ alertDialog: { open: false }, alertDraftSymbol: null });
  },
  setAlertDraftSymbol: (symbol) => {
    set({ alertDraftSymbol: symbol });
  },
  setAlertsPageTab: (tab) => {
    set({ alertsPageTab: tab });
  },
  setPrototypeControlsOpen: (open) => {
    set({ prototypeControlsOpen: open });
  },
  requestSearchFocus: () => {
    set((s) => ({ searchFocusRequest: s.searchFocusRequest + 1 }));
  },
}));
