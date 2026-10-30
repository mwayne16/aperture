import { ChevronDown } from 'lucide-react';
import { useId, type Ref, type SelectHTMLAttributes } from 'react';
import { isInvalid } from './ariaInvalid';
import { cx } from './cx';
import './ui.css';

interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'children'> {
  label?: string;
  options: SelectOption[];
  error?: string;
  ref?: Ref<HTMLSelectElement>;
}

/** Native select styled to match TextInput. `className` goes on the outer field wrapper. */
export function Select({
  label,
  options,
  error,
  id,
  className,
  disabled,
  'aria-describedby': describedBy,
  'aria-invalid': ariaInvalid,
  ref,
  ...rest
}: SelectProps) {
  const autoId = useId();
  const selectId = id ?? `${autoId}select`;
  const errorId = `${selectId}-error`;
  const hasError = error != null && error !== '';
  const invalid = hasError ? true : ariaInvalid;
  const describedByIds = [describedBy, hasError ? errorId : undefined].filter(Boolean).join(' ') || undefined;

  return (
    <div className={cx('ui-field', className)}>
      {label && (
        <label className="ui-field__label" htmlFor={selectId}>
          {label}
        </label>
      )}
      <div
        className={cx(
          'ui-input',
          'ui-select',
          isInvalid(invalid) && 'is-invalid',
          disabled === true && 'is-disabled',
        )}
      >
        <select
          {...rest}
          ref={ref}
          id={selectId}
          disabled={disabled}
          className="ui-input__control ui-select__control"
          aria-invalid={invalid}
          aria-describedby={describedByIds}
        >
          {options.map((option) => (
            <option key={option.value} value={option.value} disabled={option.disabled}>
              {option.label}
            </option>
          ))}
        </select>
        <ChevronDown className="ui-select__chevron" aria-hidden="true" />
      </div>
      {hasError && (
        <p id={errorId} className="ui-field__message is-error">
          {error}
        </p>
      )}
    </div>
  );
}
