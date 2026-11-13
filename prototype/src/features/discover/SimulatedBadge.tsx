import { Badge } from '../../components/ui/Badge';

/** The visible marker every surface with simulated data carries. */
export function SimulatedBadge({ title = 'Simulated data, not real market data.' }: { title?: string }) {
  return (
    <Badge tone="warning" size="sm" title={title}>
      Simulated
    </Badge>
  );
}
