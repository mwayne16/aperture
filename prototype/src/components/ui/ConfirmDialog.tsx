import { useId, useLayoutEffect, useRef, type ReactNode } from 'react';
import { Button } from './Button';
import { Dialog } from './Dialog';
import './ui.css';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: ReactNode;
  /** Default "Confirm". */
  confirmLabel?: string;
  /** 'danger' renders a destructive confirm button. Default 'default'. */
  tone?: 'danger' | 'default';
  onConfirm: () => void;
  onCancel: () => void;
  /** Confirm shows a spinner; cancel, Esc and backdrop clicks are ignored until it clears. */
  busy?: boolean;
}

/**
 * Yes/no confirmation. The message is the dialog's accessible description, so screen readers
 * announce what is being confirmed. Focus starts on Cancel so Enter never confirms by accident.
 */
export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Confirm',
  tone = 'default',
  onConfirm,
  onCancel,
  busy = false,
}: ConfirmDialogProps) {
  const messageId = useId();
  const cancelRef = useRef<HTMLButtonElement>(null);
  // True while focus sits on the dialog itself because busy disabled the footer buttons.
  const focusParked = useRef(false);

  // Disabling the focused footer button makes browsers drop focus to <body>, outside the
  // dialog's Tab trap. Park focus on the dialog while busy and hand it back to Cancel after.
  useLayoutEffect(() => {
    const cancelButton = cancelRef.current;
    const dialog = cancelButton?.closest<HTMLElement>('[role="dialog"]');
    if (!open || !cancelButton || !dialog) {
      focusParked.current = false;
      return;
    }
    const active = document.activeElement;
    if (busy) {
      const lost =
        active === null ||
        active === document.body ||
        active === dialog ||
        (active instanceof HTMLButtonElement && active.disabled && dialog.contains(active));
      if (lost) {
        if (active !== dialog) dialog.focus();
        focusParked.current = true;
      }
    } else if (focusParked.current) {
      focusParked.current = false;
      if (active === null || active === document.body || active === dialog) cancelButton.focus();
    }
  }, [busy, open]);

  const cancel = () => {
    if (!busy) onCancel();
  };
  return (
    <Dialog
      open={open}
      onClose={cancel}
      title={title}
      width={400}
      aria-describedby={message != null ? messageId : undefined}
      footer={
        <>
          <Button ref={cancelRef} variant="secondary" onClick={cancel} disabled={busy} data-autofocus>
            Cancel
          </Button>
          <Button
            variant={tone === 'danger' ? 'danger' : 'primary'}
            loading={busy}
            onClick={() => {
              if (!busy) onConfirm();
            }}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div id={messageId} className="ui-confirm__message">
        {message}
      </div>
    </Dialog>
  );
}
