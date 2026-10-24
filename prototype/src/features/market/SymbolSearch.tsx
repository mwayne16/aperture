export interface SymbolSearchProps {
  /**
   * 'global': top-bar search; Enter/click selects the symbol for the detail panel, with a secondary
   * action to add it to the active watchlist.
   * 'add': watchlist add box; Enter/click adds the symbol to `watchlistId`, showing validation errors inline.
   */
  variant: 'global' | 'add';
  watchlistId?: string;
  autoFocus?: boolean;
  /** Called after a successful select/add, e.g. to close a popover. */
  onDone?: () => void;
}

/** Placeholder. Replaced by the market task. */
export function SymbolSearch({ variant }: SymbolSearchProps) {
  return <div data-placeholder="SymbolSearch">{variant}</div>;
}
