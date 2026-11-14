import { useId, type InputHTMLAttributes, type ReactNode, type Ref } from 'react';
import { isInvalid } from './ariaInvalid';
import { cx } from './cx';
import './ui.css';

interface TextInputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  /** Helper text under the field. Hidden while an error is shown. */
  hint?: string;
  /** Error text. Marks the input aria-invalid and replaces the hint. Without it, a consumer `aria-invalid` passes through. */
  error?: string;
  leadingIcon?: ReactNode;
  ref?: Ref<HTMLInputElement>;
}

/** Labeled text field. `className` goes on the outer field wrapper; all other props reach the <input>. */
export function TextInput({
  label,
  hint,
  error,
  leadingIcon,
  id,
  className,
  disabled,
  type = 'text',
  'aria-describedby': describedBy,
  'aria-invalid': ariaInvalid,
  ref,
  ...rest
}: TextInputProps) {
  const autoId = useId();
  const inputId = id ?? `${autoId}input`;
  const messageId = `${inputId}-message`;
  const hasError = error != null && error !== '';
  const invalid = hasError ? true : ariaInvalid;
  const message = hasError ? error : hint;
  const describedByIds =
    [describedBy, message ? messageId : undefined].filter(Boolean).join(' ') || undefined;

  return (
    <div className={cx('ui-field', className)}>
      {label && (
        <label className="ui-field__label" htmlFor={inputId}>
          {label}
        </label>
      )}
      <div
        className={cx(
          'ui-input',
          isInvalid(invalid) && 'is-invalid',
          disabled === true && 'is-disabled',
          leadingIcon != null && 'has-leading',
        )}
      >
        {leadingIcon != null && (
          <span className="ui-input__icon" aria-hidden="true">
            {leadingIcon}
          </span>
        )}
        <input
          {...rest}
          ref={ref}
          id={inputId}
          type={type}
          disabled={disabled}
          className="ui-input__control"
          aria-invalid={invalid}
          aria-describedby={describedByIds}
        />
      </div>
      {message && (
        <p id={messageId} className={cx('ui-field__message', hasError && 'is-error')}>
          {message}
        </p>
      )}
    </div>
  );
}
