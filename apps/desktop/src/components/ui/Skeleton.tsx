import './ui.css';

interface SkeletonProps {
  /** Number = px. Default 100%. */
  width?: number | string;
  /** Number = px. Default 12px (one line of small text). */
  height?: number | string;
  /** Corner radius in px. Default var(--radius-sm). */
  radius?: number;
}

function toCssLength(value: number | string): string {
  return typeof value === 'number' ? `${Math.max(0, value)}px` : value;
}

/** Loading placeholder with a shimmer (a static block under prefers-reduced-motion). */
export function Skeleton({ width = '100%', height = 12, radius }: SkeletonProps) {
  return (
    <span
      className="ui-skeleton"
      aria-hidden="true"
      style={{
        width: toCssLength(width),
        height: toCssLength(height),
        borderRadius: radius === undefined ? undefined : `${Math.max(0, radius)}px`,
      }}
    />
  );
}
