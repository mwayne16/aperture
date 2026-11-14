/** Alert contracts of the HTTP API. Prices are USD numbers; timestamps are ISO strings. */

export const ALERT_CONDITIONS = ['above', 'below'] as const;
export type AlertCondition = (typeof ALERT_CONDITIONS)[number];

export const ALERT_TAGS = ['buy', 'sell'] as const;
/** User label only. The app never trades. */
export type AlertTag = (typeof ALERT_TAGS)[number];

/** Market-data field an alert is evaluated against. Only the latest trade price is supported. */
export type AlertField = 'last';

export interface PriceAlert {
  id: string;
  symbol: string;
  condition: AlertCondition;
  targetPrice: number;
  tag: AlertTag;
  field: AlertField;
  enabled: boolean;
  /**
   * True when the alert may fire on the next price that satisfies its condition. It turns false when
   * the alert fires and true again once the price leaves the condition, so a restart doesn't
   * re-notify for a condition that stayed satisfied.
   */
  armed: boolean;
  note: string | null;
  createdAt: string;
  /** Strictly increases with every change, so clients can drop out-of-order copies. */
  updatedAt: string;
  lastTriggeredAt: string | null;
  lastTriggeredPrice: number | null;
  triggerCount: number;
}

export interface AlertList {
  /** Oldest first. */
  alerts: PriceAlert[];
}

export interface CreateAlertInput {
  symbol: string;
  condition: AlertCondition;
  targetPrice: number;
  tag: AlertTag;
  enabled?: boolean;
  note?: string | null;
}

/**
 * Partial update. Omitted fields stay unchanged, `note: null` clears the note, and the symbol never
 * changes. Changing the condition or target price, or enabling a disabled alert, re-arms it.
 */
export interface UpdateAlertInput {
  condition?: AlertCondition;
  targetPrice?: number;
  tag?: AlertTag;
  enabled?: boolean;
  note?: string | null;
}
