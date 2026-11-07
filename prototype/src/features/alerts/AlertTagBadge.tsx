import { Badge } from '../../components/ui/Badge';
import { Tooltip } from '../../components/ui/Tooltip';
import type { AlertTag } from '../../domain/types';
import { tagLabel } from './alertDisplay';

/** Buy/Sell tag. Hovering explains that the tag is a label and never places an order. */
export function AlertTagBadge({ tag }: { tag: AlertTag }) {
  return (
    <Tooltip content="Label only. Aperture never places trades.">
      <span className="alerts-tag">
        <Badge tone={tag === 'buy' ? 'gain' : 'loss'} size="sm">
          {tagLabel(tag)}
        </Badge>
      </span>
    </Tooltip>
  );
}
