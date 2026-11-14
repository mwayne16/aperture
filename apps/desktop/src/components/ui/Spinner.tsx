import './ui.css';

interface SpinnerProps {
  /** Diameter in px. Default 14. */
  size?: number;
  /** Accessible status text. Without it the spinner is decorative (aria-hidden). */
  label?: string;
}

export function Spinner({ size = 14, label }: SpinnerProps) {
  const svg = (
    <svg
      className="ui-spinner"
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <circle className="ui-spinner__track" cx="8" cy="8" r="6.25" strokeWidth="1.75" />
      <path className="ui-spinner__arc" d="M8 1.75a6.25 6.25 0 0 1 6.25 6.25" strokeWidth="1.75" />
    </svg>
  );
  if (!label) return svg;
  return (
    <span className="ui-spinner-wrap" role="status">
      {svg}
      <span className="visually-hidden">{label}</span>
    </span>
  );
}
