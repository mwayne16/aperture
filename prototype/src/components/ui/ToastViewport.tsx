import { CircleCheck, CircleX, Info, TriangleAlert, X } from 'lucide-react';
import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { IconButton } from './IconButton';
import { dismissToast, pauseToasts, resumeToasts, useToastStore, type ToastTone } from './toastStore';
import './ui.css';

const TONE_ICON: Record<ToastTone, typeof Info> = {
  info: Info,
  success: CircleCheck,
  warning: TriangleAlert,
  error: CircleX,
};

/** Toast stack at the top right, below the top bar (newest at the bottom). Mount once near the app root. */
export function ToastViewport() {
  const toasts = useToastStore((s) => s.toasts);
  // ** If the viewport unmounts while hovered, don't leave the countdowns frozen.
  useEffect(() => resumeToasts, []);
  if (typeof document === 'undefined') return null;
  return createPortal(
    <section
      className="ui-toasts"
      aria-label="Notifications"
      aria-live="polite"
      aria-relevant="additions text"
      onMouseEnter={pauseToasts}
      onMouseLeave={resumeToasts}
    >
      <ol className="ui-toasts__list">
        {toasts.map((toast) => {
          const Icon = TONE_ICON[toast.tone];
          return (
            <li key={toast.id} className={`ui-toast ui-toast--${toast.tone}`}>
              <Icon className="ui-toast__icon" aria-hidden="true" />
              <div className="ui-toast__content">
                <p className="ui-toast__title">{toast.title}</p>
                {toast.description && <p className="ui-toast__description">{toast.description}</p>}
              </div>
              <IconButton
                label="Dismiss notification"
                icon={<X />}
                size="sm"
                className="ui-toast__close"
                onClick={() => {
                  dismissToast(toast.id);
                }}
              />
            </li>
          );
        })}
      </ol>
    </section>,
    document.body,
  );
}
