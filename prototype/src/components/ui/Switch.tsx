import { Switch as RadixSwitch } from 'radix-ui';
import { useId } from 'react';
import { cx } from './cx';
import './ui.css';

interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  /** Keep the label for assistive tech only (aria-label) and render just the track. */
  hideLabel?: boolean;
  disabled?: boolean;
}

/** On/off toggle with role="switch". Space (and Enter, as a native button) toggles. */
export function Switch({ checked, onChange, label, hideLabel = false, disabled = false }: SwitchProps) {
  const id = useId();
  const labelId = `${id}label`;
  return (
    <span className={cx('ui-switch', disabled && 'is-disabled')}>
      <RadixSwitch.Root
        id={id}
        checked={checked}
        onCheckedChange={onChange}
        disabled={disabled}
        aria-label={hideLabel ? label : undefined}
        aria-labelledby={hideLabel ? undefined : labelId}
        className={cx('ui-switch__track', checked && 'is-checked')}
      >
        <RadixSwitch.Thumb className="ui-switch__thumb" aria-hidden="true" />
      </RadixSwitch.Root>
      {!hideLabel && (
        <label id={labelId} htmlFor={id} className="ui-switch__label">
          {label}
        </label>
      )}
    </span>
  );
}
