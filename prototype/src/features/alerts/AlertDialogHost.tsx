import { CircleAlert } from 'lucide-react';
import { useEffect, useId, useRef, useState, type SyntheticEvent } from 'react';
import { useUiStore, type AlertDialogState } from '../../app/uiStore';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { cx } from '../../components/ui/cx';
import { Dialog } from '../../components/ui/Dialog';
import { SegmentedControl } from '../../components/ui/SegmentedControl';
import { Switch } from '../../components/ui/Switch';
import { TextInput } from '../../components/ui/TextInput';
import { showToast } from '../../components/ui/toastStore';
import { isApiError } from '../../data/api';
import { useConnectionStore } from '../../data/connectionStore';
import { useQuote } from '../../data/quoteStore';
import { validateSymbol } from '../../domain/symbols';
import type { AlertCondition, AlertTag, PriceAlert } from '../../domain/types';
import { changeDirection, formatPrice } from '../../lib/format';
import { conditionPreview, conditionText, tagLabel } from './alertDisplay';
import {
  armedAfterSave,
  createFormValues,
  editFormValues,
  errorsFromApi,
  parsePriceInput,
  toCreateInput,
  toUpdateInput,
  validateForm,
  type AlertFormErrors,
  type AlertFormField,
  type AlertFormValues,
} from './alertForm';
import { useAlertStore } from './alertStore';
import './alerts.css';

type OpenDialog = Extract<AlertDialogState, { open: true }>;

const CONDITION_OPTIONS: { value: AlertCondition; label: string }[] = [
  { value: 'above', label: 'Above (≥)' },
  { value: 'below', label: 'Below (≤)' },
];

const TAG_OPTIONS: { value: AlertTag; label: string }[] = [
  { value: 'buy', label: 'Buy' },
  { value: 'sell', label: 'Sell' },
];

/** Renders the create/edit alert dialog that uiStore.alertDialog asks for. */
export function AlertDialogHost() {
  const dialog = useUiStore((s) => s.alertDialog);
  if (!dialog.open) return null;
  // ** A new key per request starts the form fresh, even if another request replaces an open one.
  const key = dialog.mode === 'create' ? `create:${dialog.presetSymbol ?? ''}` : `edit:${dialog.alertId}`;
  return <AlertEditor key={key} dialog={dialog} />;
}

function AlertEditor({ dialog }: { dialog: OpenDialog }) {
  const editId = dialog.mode === 'edit' ? dialog.alertId : null;
  const original = useAlertStore((s) => (editId === null ? null : s.alerts.find((a) => a.id === editId)));

  if (editId !== null && original === undefined) return <MissingAlert />;
  return <AlertForm dialog={dialog} original={original ?? null} />;
}

/** The alert being edited is gone (deleted elsewhere, or the save found it missing). */
function MissingAlert() {
  // ** StrictMode runs effects twice on mount; the ref keeps that to one toast.
  const reported = useRef(false);
  useEffect(() => {
    if (reported.current) return;
    reported.current = true;
    useUiStore.getState().closeAlertDialog();
    showToast({
      tone: 'warning',
      title: 'This alert no longer exists',
      description: 'It was deleted, so there is nothing to edit.',
    });
  }, []);
  return null;
}

interface AlertFormProps {
  dialog: OpenDialog;
  original: PriceAlert | null;
}

function AlertForm({ dialog, original }: AlertFormProps) {
  const formId = useId();
  const previewId = useId();
  const editing = original !== null;
  const [values, setValues] = useState<AlertFormValues>(() =>
    original
      ? editFormValues(original)
      : createFormValues(dialog.mode === 'create' ? dialog.presetSymbol : null),
  );
  const [touched, setTouched] = useState<Partial<Record<AlertFormField, boolean>>>({});
  const [attempted, setAttempted] = useState(false);
  const [serverErrors, setServerErrors] = useState<AlertFormErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const symbolRef = useRef<HTMLInputElement>(null);
  const priceRef = useRef<HTMLInputElement>(null);
  const noteRef = useRef<HTMLInputElement>(null);

  const clientErrors = validateForm(values);
  const errorFor = (field: AlertFormField): string | undefined =>
    serverErrors[field] ?? (attempted || touched[field] ? clientErrors[field] : undefined);

  const set = <K extends AlertFormField>(field: K, value: AlertFormValues[K]) => {
    setValues((current) => ({ ...current, [field]: value }));
    setServerErrors((current) =>
      current[field] === undefined ? current : { ...current, [field]: undefined },
    );
  };
  const blur = (field: AlertFormField) => () => {
    setTouched((current) => (current[field] ? current : { ...current, [field]: true }));
  };

  const close = () => {
    if (!submitting) useUiStore.getState().closeAlertDialog();
  };

  const symbolCheck = validateSymbol(values.symbol);
  const symbol = symbolCheck.ok ? symbolCheck.value : null;
  const targetPrice = parsePriceInput(values.targetPrice);
  const changes = original ? toUpdateInput(original, values) : null;

  const submit = async (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    // ** The ref blocks a second submit that arrives before the disabled state renders.
    if (submittingRef.current) return;
    setAttempted(true);
    setFormError(null);
    if (Object.keys(clientErrors).length > 0) {
      const fieldRefs = [
        { field: 'symbol', ref: symbolRef },
        { field: 'targetPrice', ref: priceRef },
        { field: 'note', ref: noteRef },
      ] as const;
      fieldRefs.find(({ field }) => clientErrors[field] !== undefined)?.ref.current?.focus();
      return;
    }
    if (changes && Object.keys(changes).length === 0) {
      useUiStore.getState().closeAlertDialog();
      return;
    }

    const store = useAlertStore.getState();
    submittingRef.current = true;
    setSubmitting(true);
    try {
      const saved =
        original && changes
          ? await store.update(original.id, changes)
          : await store.create(toCreateInput(values));
      useUiStore.getState().closeAlertDialog();
      showToast({
        tone: 'success',
        title: original ? 'Alert updated' : 'Alert created',
        description: `${saved.symbol} ${conditionText(saved.condition, saved.targetPrice)} · ${tagLabel(saved.tag)}${
          saved.enabled ? '' : ' (disabled)'
        }`,
      });
    } catch (error) {
      submittingRef.current = false;
      setSubmitting(false);
      // The store dropped the alert; AlertEditor swaps in MissingAlert, which closes and explains.
      if (isApiError(error) && error.code === 'NOT_FOUND') return;
      if (isApiError(error)) {
        const mapped = errorsFromApi(error);
        setServerErrors(mapped.fields);
        setFormError(mapped.form);
      } else {
        setFormError('Something went wrong. Try again.');
      }
    }
  };

  return (
    <Dialog
      open
      onClose={close}
      title={editing ? 'Edit alert' : 'New alert'}
      description="Alerts are evaluated on the server against the latest trade price (Last)."
      width={460}
      footer={
        <>
          <Button variant="secondary" onClick={close} disabled={submitting}>
            Cancel
          </Button>
          <Button type="submit" form={formId} variant="primary" loading={submitting}>
            {editing ? 'Save changes' : 'Create alert'}
          </Button>
        </>
      }
    >
      <form id={formId} className="alert-form" noValidate onSubmit={(e) => void submit(e)}>
        {formError !== null && (
          <p className="alert-form__error" role="alert">
            <CircleAlert aria-hidden="true" />
            <span>{formError}</span>
          </p>
        )}
        <div className="alert-form__group">
          <TextInput
            ref={symbolRef}
            className="alert-form__symbol"
            label="Symbol"
            value={values.symbol}
            placeholder="e.g. AAPL"
            autoComplete="off"
            spellCheck={false}
            readOnly={editing}
            hint={editing ? 'The symbol of an existing alert cannot change.' : undefined}
            error={editing ? undefined : errorFor('symbol')}
            onChange={(e) => {
              set('symbol', e.target.value);
            }}
            onBlur={blur('symbol')}
          />
          {symbol !== null && <LivePrice symbol={symbol} />}
        </div>
        <div className="alert-form__row">
          <div className="alert-form__group">
            <span className="ui-field__label" aria-hidden="true">
              Condition
            </span>
            <SegmentedControl<AlertCondition>
              aria-label="Condition"
              options={CONDITION_OPTIONS}
              value={values.condition}
              onChange={(next) => {
                set('condition', next);
              }}
            />
          </div>
          <TextInput
            ref={priceRef}
            label="Target price"
            value={values.targetPrice}
            inputMode="decimal"
            autoComplete="off"
            placeholder="0.00"
            className="num"
            data-autofocus={editing || symbol !== null ? true : undefined}
            aria-describedby={symbol !== null ? previewId : undefined}
            error={errorFor('targetPrice')}
            onChange={(e) => {
              set('targetPrice', e.target.value);
            }}
            onBlur={blur('targetPrice')}
          />
        </div>
        {symbol !== null && (
          <Preview
            id={previewId}
            symbol={symbol}
            condition={values.condition}
            targetPrice={targetPrice}
            enabled={values.enabled}
            armedAfterSave={armedAfterSave(original, changes ?? {})}
          />
        )}
        <div className="alert-form__group">
          <span className="ui-field__label" aria-hidden="true">
            Tag
          </span>
          <SegmentedControl<AlertTag>
            aria-label="Tag"
            options={TAG_OPTIONS}
            value={values.tag}
            onChange={(next) => {
              set('tag', next);
            }}
          />
          <p className="ui-field__message">Label only. Aperture never places trades.</p>
        </div>
        <TextInput
          ref={noteRef}
          label="Note (optional)"
          value={values.note}
          error={errorFor('note')}
          onChange={(e) => {
            set('note', e.target.value);
          }}
          onBlur={blur('note')}
        />
        <Switch
          checked={values.enabled}
          onChange={(next) => {
            set('enabled', next);
          }}
          label="Enabled"
        />
      </form>
    </Dialog>
  );
}

/** Latest price for the symbol in the form, marked simulated when it is. */
function LivePrice({ symbol }: { symbol: string }) {
  const quote = useQuote(symbol);
  const simulated = useConnectionStore((s) => s.connection.simulated);
  if (quote?.last == null) {
    return (
      <p className="alert-form__quote">
        {quote?.status === 'unavailable'
          ? `No price data for ${symbol}. Check the symbol.`
          : `No live price for ${symbol} yet.`}
      </p>
    );
  }
  const direction = changeDirection(quote.change);
  return (
    <p className="alert-form__quote">
      <span>
        Last{' '}
        <span
          className={cx(
            'alert-form__quote-price num',
            quote.status !== 'stale' && direction > 0 && 'is-gain',
            quote.status !== 'stale' && direction < 0 && 'is-loss',
          )}
        >
          {formatPrice(quote.last)}
        </span>
        {quote.status === 'stale' && ' (stale)'}
        {quote.status === 'delayed' && ' (delayed)'}
      </span>
      {simulated && (
        <Badge tone="warning" size="sm" title="Simulated values, not market data">
          Simulated
        </Badge>
      )}
    </p>
  );
}

interface PreviewProps {
  id: string;
  symbol: string;
  condition: AlertCondition;
  targetPrice: number;
  enabled: boolean;
  armedAfterSave: boolean;
}

/**
 * Says whether the condition already holds for the current price, and so what happens on save.
 * It describes the target field instead of being a live region, because it changes on every tick.
 */
function Preview({ id, symbol, condition, targetPrice, enabled, armedAfterSave }: PreviewProps) {
  const quote = useQuote(symbol);
  const last = quote?.status === 'unavailable' ? null : quote?.last;
  const preview = conditionPreview({ condition, targetPrice, last, enabled, armedAfterSave });
  // ** Stays in the DOM while hidden, so the target field's aria-describedby never points at nothing.
  return (
    <p id={id} className={cx('alert-form__preview', preview?.met && 'is-met')} hidden={preview === null}>
      {preview?.text}
    </p>
  );
}
