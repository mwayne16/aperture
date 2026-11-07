import { useId, useRef, useState } from 'react';
import { Button } from '../../components/ui/Button';
import { Dialog } from '../../components/ui/Dialog';
import { TextInput } from '../../components/ui/TextInput';
import { isApiError } from '../../data/api';
import { WATCHLIST_NAME_MAX, validateWatchlistName } from '../../domain/symbols';
import type { Watchlist } from '../../domain/types';
import { useWatchlistStore } from './watchlistStore';
import './watchlists.css';

interface WatchlistNameDialogProps {
  open: boolean;
  /** The list to rename, or null to create a new one. */
  watchlist: Watchlist | null;
  onClose: () => void;
}

interface FormErrors {
  field: string | null;
  form: string | null;
}

/** Name problems go under the field; anything else, such as the service being down, goes under the form. */
function toFormErrors(error: unknown): FormErrors {
  if (isApiError(error) && (error.code === 'VALIDATION_ERROR' || error.code === 'CONFLICT')) {
    const detail = error.details.find((d) => d.field === 'name');
    return { field: detail?.message ?? error.message, form: null };
  }
  const message = error instanceof Error && error.message !== '' ? error.message : 'Something went wrong.';
  return { field: null, form: message };
}

/**
 * Creates or renames a watchlist. Validation runs on submit and then live as the user fixes the name.
 * The dialog can't be dismissed while the request is in flight. Remount it (via `key`) for each opening.
 */
export function WatchlistNameDialog({ open, watchlist, onClose }: WatchlistNameDialogProps) {
  const formId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const busyRef = useRef(false);
  const selectedOnce = useRef(false);
  const [name, setName] = useState(watchlist?.name ?? '');
  const [errors, setErrors] = useState<FormErrors>({ field: null, form: null });
  const [validateLive, setValidateLive] = useState(false);
  const [busy, setBusy] = useState(false);
  const renaming = watchlist !== null;

  const close = () => {
    if (!busyRef.current) onClose();
  };

  const changeName = (value: string) => {
    setName(value);
    if (!validateLive) {
      setErrors({ field: null, form: null });
      return;
    }
    const others = useWatchlistStore
      .getState()
      .watchlists.filter((w) => w.id !== watchlist?.id)
      .map((w) => w.name);
    const result = validateWatchlistName(value, others);
    setErrors({ field: result.ok ? null : result.reason, form: null });
  };

  const save = async () => {
    // ** A ref, not state, so a second Enter in the same tick can't submit twice.
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setErrors({ field: null, form: null });
    try {
      const store = useWatchlistStore.getState();
      if (watchlist) await store.rename(watchlist.id, name);
      else await store.create(name);
      busyRef.current = false;
      onClose();
    } catch (error) {
      setErrors(toFormErrors(error));
      setValidateLive(true);
      busyRef.current = false;
      inputRef.current?.focus();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={close}
      title={renaming ? 'Rename watchlist' : 'New watchlist'}
      width={380}
      footer={
        <>
          <Button variant="secondary" onClick={close} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" form={formId} loading={busy}>
            {renaming ? 'Save' : 'Create'}
          </Button>
        </>
      }
    >
      <form
        id={formId}
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <TextInput
          ref={inputRef}
          label="Name"
          value={name}
          autoComplete="off"
          spellCheck={false}
          hint={`Up to ${WATCHLIST_NAME_MAX} characters.`}
          error={errors.field ?? undefined}
          onChange={(event) => {
            changeName(event.target.value);
          }}
          onFocus={(event) => {
            // ** Select the current name once, so typing replaces it when renaming.
            if (selectedOnce.current) return;
            selectedOnce.current = true;
            event.currentTarget.select();
          }}
        />
        {errors.form !== null && (
          <p role="alert" className="wl-dialog__error">
            {errors.form}
          </p>
        )}
      </form>
    </Dialog>
  );
}
