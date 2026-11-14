import type * as SharedAlerts from '@aperture/shared/alerts';
import type * as SharedWatchlist from '@aperture/shared/watchlist';
import { describe, expectTypeOf, it } from 'vitest';
import type { CreateAlertInput, PriceAlert, UpdateAlertInput, Watchlist } from './types';

// ** The app keeps its own copies of the API types until it talks to the real backend. Typecheck fails
// here as soon as a copy drifts from the server's contract.
describe('API contract types', () => {
  it('match the shared alert and watchlist contracts', () => {
    expectTypeOf<PriceAlert>().toEqualTypeOf<SharedAlerts.PriceAlert>();
    expectTypeOf<CreateAlertInput>().toEqualTypeOf<SharedAlerts.CreateAlertInput>();
    expectTypeOf<UpdateAlertInput>().toEqualTypeOf<SharedAlerts.UpdateAlertInput>();
    expectTypeOf<Watchlist>().toEqualTypeOf<SharedWatchlist.Watchlist>();
  });
});
