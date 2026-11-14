import { FlaskConical } from 'lucide-react';
import './simulated-mark.css';

/**
 * The visible marker every surface with simulated data carries. It is quiet on purpose: the top bar
 * holds the prominent badge, so the per-card marks label the data without competing with it.
 */
export function SimulatedBadge({ title = 'Simulated data, not real market data.' }: { title?: string }) {
  return (
    <span className="simulated-mark" title={title}>
      <FlaskConical aria-hidden="true" />
      Simulated
    </span>
  );
}
