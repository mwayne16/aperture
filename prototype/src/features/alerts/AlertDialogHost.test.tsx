import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useUiStore } from '../../app/uiStore';
import { ApiError } from '../../data/api';
import { api } from '../../data/dataLayer';
import { updateSimulation } from '../../data/simulationStore';
import type { PriceAlert } from '../../domain/types';
import { AlertDialogHost } from './AlertDialogHost';
import { useAlertStore } from './alertStore';
import { resetAlertsTestState, setQuote, toastTitles } from './alertsTestHarness';

// ** Multi-step user-event flows can take seconds on a busy machine, and a test that times out
// mid-flow keeps running into the next one.
vi.setConfig({ testTimeout: 20_000 });

const MSFT = 'alert-seed-msft';

function setup(open: () => void, options: { strict?: boolean } = {}) {
  const user = userEvent.setup();
  const view = render(
    options.strict ? (
      <StrictMode>
        <AlertDialogHost />
      </StrictMode>
    ) : (
      <AlertDialogHost />
    ),
  );
  act(open);
  return { user, ...view };
}

const dialog = () => screen.getByRole('dialog');
const field = (name: string) => within(dialog()).getByRole('textbox', { name });
const isOpen = () => useUiStore.getState().alertDialog.open;

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

beforeEach(async () => {
  await resetAlertsTestState();
});

describe('create', () => {
  it('presets the symbol, shows its price and says when the condition already holds', async () => {
    setQuote('NVDA', 180);
    const { user } = setup(() => {
      useUiStore.getState().openCreateAlert('NVDA');
    });
    expect(dialog()).toHaveAccessibleName('New alert');
    expect(field('Symbol')).toHaveValue('NVDA');
    expect(within(dialog()).getByText('180.00')).toBeInTheDocument();
    expect(within(dialog()).getByText('Simulated')).toBeInTheDocument();
    expect(field('Target price')).toHaveFocus();

    await user.type(field('Target price'), '150');
    expect(
      within(dialog()).getByText('Last is already above 150.00, so this alert triggers on the next trade.'),
    ).toBeInTheDocument();
    expect(field('Target price')).toHaveAccessibleDescription(/^Last is already above 150\.00/);
    await user.click(within(dialog()).getByRole('radio', { name: 'Below (≤)' }));
    expect(
      within(dialog()).getByText('Triggers when Last falls to 150.00 (−16.67% from 180.00).'),
    ).toBeInTheDocument();
  });

  it('says when there is no price for the symbol yet', () => {
    setup(() => {
      useUiStore.getState().openCreateAlert('AMD');
    });
    expect(within(dialog()).getByText('No live price for AMD yet.')).toBeInTheDocument();
  });

  it('subscribes to a typed symbol, so its price and the preview show for any symbol', async () => {
    const { user, unmount } = setup(() => {
      useUiStore.getState().openCreateAlert();
    });
    const draft = () => useUiStore.getState().alertDraftSymbol;
    expect(draft()).toBeNull();
    await user.type(field('Symbol'), 'amd');
    expect(draft()).toBe('AMD');
    // The subscription delivers a quote for the typed symbol.
    setQuote('AMD', 158.3);
    expect(within(dialog()).getByText('158.30')).toBeInTheDocument();
    await user.type(field('Target price'), '150');
    expect(
      within(dialog()).getByText('Last is already above 150.00, so this alert triggers on the next trade.'),
    ).toBeInTheDocument();

    // An invalid symbol is not subscribed.
    await user.clear(field('Symbol'));
    await user.type(field('Symbol'), 'a b');
    expect(draft()).toBeNull();
    await user.clear(field('Symbol'));
    await user.type(field('Symbol'), 'tsla');
    expect(draft()).toBe('TSLA');
    unmount();
    expect(draft()).toBeNull();
  });

  it('stops subscribing to the typed symbol when the dialog closes', async () => {
    const { user } = setup(() => {
      useUiStore.getState().openCreateAlert('AMD');
    });
    expect(useUiStore.getState().alertDraftSymbol).toBe('AMD');
    await user.click(within(dialog()).getByRole('button', { name: 'Cancel' }));
    expect(isOpen()).toBe(false);
    expect(useUiStore.getState().alertDraftSymbol).toBeNull();
  });

  it('validates inline, focuses the first invalid field and sends nothing', async () => {
    const create = vi.spyOn(api, 'createAlert');
    const { user } = setup(() => {
      useUiStore.getState().openCreateAlert(null);
    });
    expect(field('Symbol')).toHaveFocus();
    await user.click(within(dialog()).getByRole('button', { name: 'Create alert' }));
    expect(field('Symbol')).toHaveAccessibleDescription('Enter a symbol.');
    expect(field('Target price')).toHaveAccessibleDescription('Enter a target price greater than 0.');
    expect(field('Symbol')).toHaveFocus();
    expect(create).not.toHaveBeenCalled();

    await user.type(field('Symbol'), 'amd');
    expect(field('Symbol')).not.toHaveAttribute('aria-invalid', 'true');
  });

  it('creates the alert, closes and confirms with a toast', async () => {
    const { user } = setup(() => {
      useUiStore.getState().openCreateAlert('AMD');
    });
    await user.type(field('Target price'), '1,234.5');
    await user.click(within(dialog()).getByRole('radio', { name: 'Sell' }));
    await user.type(field('Note (optional)'), '  Take profit  ');
    await user.click(within(dialog()).getByRole('switch', { name: 'Enabled' }));
    await user.click(within(dialog()).getByRole('button', { name: 'Create alert' }));

    expect(isOpen()).toBe(false);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(toastTitles()).toEqual(['Alert created']);
    const created = useAlertStore.getState().alerts.find((a) => a.symbol === 'AMD');
    expect(created).toMatchObject({ targetPrice: 1234.5, tag: 'sell', note: 'Take profit', enabled: false });
  });

  it('disables Save while submitting and sends one request for repeated submits', async () => {
    const gate = deferred<PriceAlert>();
    const create = vi.spyOn(api, 'createAlert').mockImplementation(() => gate.promise);
    const { user } = setup(() => {
      useUiStore.getState().openCreateAlert('AMD');
    });
    await user.type(field('Target price'), '100');
    const save = within(dialog()).getByRole('button', { name: 'Create alert' });
    await user.click(save);
    await user.click(save);
    // An Enter press in a field submits the form directly, bypassing the disabled button.
    fireEvent.submit(field('Target price').closest('form')!);
    expect(save).toBeDisabled();
    expect(save).toHaveAttribute('aria-busy', 'true');
    expect(within(dialog()).getByRole('button', { name: 'Cancel' })).toBeDisabled();
    await user.keyboard('{Escape}');
    expect(isOpen()).toBe(true);
    expect(create).toHaveBeenCalledTimes(1);

    const saved = { ...(await api.listAlerts())[0]!, id: 'alert-new', symbol: 'AMD' };
    await act(async () => {
      gate.resolve(saved);
      await gate.promise;
    });
    expect(isOpen()).toBe(false);
  });

  it('shows API field errors next to their fields and clears one when it is edited', async () => {
    vi.spyOn(api, 'createAlert').mockRejectedValueOnce(
      new ApiError('VALIDATION_ERROR', 'Invalid', 400, [
        { field: 'targetPrice', message: 'Too far from the market.' },
      ]),
    );
    const { user } = setup(() => {
      useUiStore.getState().openCreateAlert('AMD');
    });
    await user.type(field('Target price'), '100');
    await user.click(within(dialog()).getByRole('button', { name: 'Create alert' }));
    expect(field('Target price')).toHaveAccessibleDescription(/^\s*Too far from the market\.$/);
    expect(within(dialog()).getByRole('button', { name: 'Create alert' })).toBeEnabled();

    await user.type(field('Target price'), '1');
    expect(field('Target price')).not.toHaveAccessibleDescription(/Too far from the market/);
  });

  it('shows a service failure at the top and keeps what was typed', async () => {
    const { user } = setup(() => {
      useUiStore.getState().openCreateAlert('AMD');
    });
    await user.type(field('Target price'), '100');
    updateSimulation({ failNextApiCall: true });
    await user.click(within(dialog()).getByRole('button', { name: 'Create alert' }));
    expect(within(dialog()).getByRole('alert')).toHaveTextContent(/temporarily unavailable/);
    expect(field('Target price')).toHaveValue('100');
    expect(isOpen()).toBe(true);

    await user.click(within(dialog()).getByRole('button', { name: 'Create alert' }));
    expect(isOpen()).toBe(false);
  });

  it('closes on Cancel without saving', async () => {
    const create = vi.spyOn(api, 'createAlert');
    const { user } = setup(() => {
      useUiStore.getState().openCreateAlert('AMD');
    });
    await user.click(within(dialog()).getByRole('button', { name: 'Cancel' }));
    expect(isOpen()).toBe(false);
    expect(create).not.toHaveBeenCalled();
  });
});

describe('edit', () => {
  beforeEach(async () => {
    await useAlertStore.getState().load();
  });

  it('prefills the form and sends only what changed', async () => {
    const alert = useAlertStore.getState().alerts.find((a) => a.id === MSFT)!;
    const update = vi.spyOn(api, 'updateAlert');
    const { user } = setup(() => {
      useUiStore.getState().openEditAlert(MSFT);
    });
    expect(dialog()).toHaveAccessibleName('Edit alert');
    expect(field('Symbol')).toHaveValue('MSFT');
    expect(field('Symbol')).toHaveAttribute('readonly');
    expect(field('Target price')).toHaveValue(String(alert.targetPrice));
    expect(field('Note (optional)')).toHaveValue(alert.note);

    await user.click(within(dialog()).getByRole('radio', { name: 'Sell' }));
    await user.click(within(dialog()).getByRole('button', { name: 'Save changes' }));
    expect(update).toHaveBeenCalledWith(MSFT, { tag: 'sell' });
    expect(isOpen()).toBe(false);
    expect(toastTitles()).toEqual(['Alert updated']);
    expect(useAlertStore.getState().alerts.find((a) => a.id === MSFT)?.tag).toBe('sell');
  });

  it('closes without a request when nothing changed', async () => {
    const update = vi.spyOn(api, 'updateAlert');
    const { user } = setup(() => {
      useUiStore.getState().openEditAlert(MSFT);
    });
    await user.click(within(dialog()).getByRole('button', { name: 'Save changes' }));
    expect(update).not.toHaveBeenCalled();
    expect(isOpen()).toBe(false);
  });

  it('closes with one toast when the alert no longer exists, even in StrictMode', () => {
    setup(
      () => {
        useUiStore.getState().openEditAlert('alert-gone');
      },
      { strict: true },
    );
    expect(isOpen()).toBe(false);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(toastTitles()).toEqual(['This alert no longer exists']);
  });

  it('closes and explains when the alert was deleted elsewhere before saving', async () => {
    const { user } = setup(() => {
      useUiStore.getState().openEditAlert(MSFT);
    });
    await api.deleteAlert(MSFT);
    await user.clear(field('Target price'));
    await user.type(field('Target price'), '1');
    await user.click(within(dialog()).getByRole('button', { name: 'Save changes' }));
    expect(isOpen()).toBe(false);
    expect(toastTitles()).toEqual(['This alert no longer exists']);
    expect(useAlertStore.getState().alerts.some((a) => a.id === MSFT)).toBe(false);
  });

  it('warns that a triggered alert stays quiet unless the edit re-arms it', async () => {
    const alert = useAlertStore.getState().alerts.find((a) => a.id === MSFT)!;
    act(() => {
      useAlertStore.getState().applyServerUpdate({
        ...alert,
        armed: false,
        updatedAt: new Date(Date.parse(alert.updatedAt) + 1).toISOString(),
      });
    });
    setQuote('MSFT', alert.targetPrice + 1);
    const { user } = setup(() => {
      useUiStore.getState().openEditAlert(MSFT);
    });
    expect(
      within(dialog()).getByText(/This alert has triggered and re-arms once Last moves back below/),
    ).toBeInTheDocument();
    await user.clear(field('Target price'));
    await user.type(field('Target price'), String(alert.targetPrice - 1));
    expect(within(dialog()).getByText(/so this alert triggers on the next trade/)).toBeInTheDocument();
  });
});
