import { X } from 'lucide-react';
import { Dialog as RadixDialog } from 'radix-ui';
import { useId, useRef, useState, type ReactNode } from 'react';
import { IconButton } from './IconButton';
import './ui.css';

interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children?: ReactNode;
  footer?: ReactNode;
  /** Width in px. Default 440. Never wider than the viewport minus a margin. */
  width?: number;
  /**
   * Ids of elements inside the dialog that also describe it, such as a message rendered in
   * `children`. They follow `description` in the accessible description.
   */
  'aria-describedby'?: string;
}

const FOCUSABLE = 'a[href], button, input, select, textarea, summary, iframe, [tabindex], [contenteditable]';

function isRadio(el: Element): el is HTMLInputElement {
  return el instanceof HTMLInputElement && el.type === 'radio' && el.name !== '';
}

/** Tab stops inside `root` in DOM order. A radio group with a checked radio stops only on that one. */
function tabStops(root: HTMLElement | null): HTMLElement[] {
  if (!root) return [];
  const focusable = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => el.tabIndex >= 0,
  );
  const checkedGroups = new Set(
    focusable
      .filter(isRadio)
      .filter((radio) => radio.checked)
      .map((radio) => radio.name),
  );
  return focusable.filter((el) => !isRadio(el) || el.checked || !checkedGroups.has(el.name));
}

/**
 * Modal dialog rendered into document.body. Focus moves inside on open (an element with
 * `autoFocus` or `data-autofocus`, else the first focusable in the body, then the footer), Tab is
 * trapped, Esc and a backdrop click call onClose, and focus returns to the opener on close.
 * When dialogs are nested, only the innermost one responds to the keyboard.
 */
export function Dialog(props: DialogProps) {
  const { open, onClose } = props;
  return (
    <RadixDialog.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <RadixDialog.Portal>
        <DialogSurface {...props} />
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}

function DialogSurface({
  onClose,
  title,
  description,
  children,
  footer,
  width = 440,
  'aria-describedby': extraDescribedBy,
}: DialogProps) {
  const descriptionId = useId();
  const overlayRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const footerRef = useRef<HTMLDivElement>(null);
  // Captured during the first render, before anything inside the dialog takes focus.
  const [opener] = useState(() =>
    document.activeElement instanceof HTMLElement ? document.activeElement : null,
  );
  const describedBy = [description ? descriptionId : '', extraDescribedBy?.trim() ?? '']
    .filter((id) => id !== '')
    .join(' ');

  const focusInitial = (event: Event) => {
    event.preventDefault();
    const dialog = contentRef.current;
    if (!dialog) return;
    const candidates = [
      ...dialog.querySelectorAll<HTMLElement>('[data-autofocus]'),
      ...tabStops(bodyRef.current),
      ...tabStops(footerRef.current),
    ];
    // ** Disabled and hidden elements ignore focus(). Focusing a roving group may hand focus to
    // its selected item, which still counts as landing on the candidate.
    const landed = candidates.some((el) => {
      el.focus();
      return el.contains(document.activeElement);
    });
    if (!landed) dialog.focus();
  };

  const restoreFocus = (event: Event) => {
    event.preventDefault();
    const active = document.activeElement;
    // Leave focus alone if something outside the dialog already took it.
    if (opener?.isConnected && (active === null || active === document.body)) opener.focus();
  };

  // Only a press on this dialog's own backdrop dismisses it. Toasts stay clickable above the
  // backdrop, and dismissing one must not throw away what the user is editing here.
  const dismissOnlyFromBackdrop = (event: Event) => {
    if (event.target !== overlayRef.current) event.preventDefault();
  };

  return (
    <RadixDialog.Overlay ref={overlayRef} className="ui-dialog-backdrop">
      <RadixDialog.Content
        ref={contentRef}
        aria-modal="true"
        aria-describedby={describedBy === '' ? undefined : describedBy}
        className="ui-dialog"
        style={{ width }}
        onOpenAutoFocus={focusInitial}
        onCloseAutoFocus={restoreFocus}
        onPointerDownOutside={dismissOnlyFromBackdrop}
      >
        {/* ** Plain divs: header and footer elements would add banner and contentinfo landmarks
            next to the app's own while the dialog is open. */}
        <div className="ui-dialog__header">
          <div className="ui-dialog__heading">
            <RadixDialog.Title className="ui-dialog__title">{title}</RadixDialog.Title>
            {description && (
              <p id={descriptionId} className="ui-dialog__description">
                {description}
              </p>
            )}
          </div>
          <IconButton label="Close" icon={<X />} size="sm" onClick={onClose} className="ui-dialog__close" />
        </div>
        {children != null && (
          <div ref={bodyRef} className="ui-dialog__body">
            {children}
          </div>
        )}
        {footer != null && (
          <div ref={footerRef} className="ui-dialog__footer">
            {footer}
          </div>
        )}
      </RadixDialog.Content>
    </RadixDialog.Overlay>
  );
}
