import { useSortable } from '@dnd-kit/sortable';
import { ArrowDown, ArrowUp, BellPlus, Ellipsis, GripVertical, Trash2 } from 'lucide-react';
import { memo, type KeyboardEvent, type MouseEvent } from 'react';
import { Badge } from '../../components/ui/Badge';
import { cx } from '../../components/ui/cx';
import { IconButton } from '../../components/ui/IconButton';
import { Menu } from '../../components/ui/Menu';
import { Skeleton } from '../../components/ui/Skeleton';
import { StatusDot } from '../../components/ui/StatusDot';
import { useConnectionStore } from '../../data/connectionStore';
import { useQuote } from '../../data/quoteStore';
import type { Quote } from '../../domain/types';
import { changeDirection, formatChange, formatPercent, formatPrice, formatVolume } from '../../lib/format';
import { Sparkline } from '../discover/Sparkline';
import { useInstrument } from './instrumentStore';
import { quoteStatusView, rangePosition } from './marketModel';
import { usePriceFlash } from './usePriceFlash';

/** Row callbacks. The table passes one stable object so ticks never re-render other rows. */
export interface MarketRowActions {
  open(symbol: string): void;
  /** The row took focus, so it becomes the table's tab stop. */
  focus(symbol: string): void;
  /** Moves focus for an arrow, Home or End key. */
  navigate(from: string, key: string): void;
  move(symbol: string, delta: -1 | 1): void;
  remove(symbol: string): void;
  createAlert(symbol: string): void;
}

interface MarketRowProps {
  symbol: string;
  /** The one row in the tab order. Arrow keys move between rows from there. */
  tabbable: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  actions: MarketRowActions;
}

/**
 * One watchlist symbol. Clicking it opens the symbol's page and its handle drags it to a new place.
 * It reads its own quote, so a tick re-renders only this row.
 */
export const MarketRow = memo(function MarketRow({
  symbol,
  tabbable,
  canMoveUp,
  canMoveDown,
  actions,
}: MarketRowProps) {
  const { setNodeRef, setActivatorNodeRef, listeners, transform, transition, isDragging } = useSortable({
    id: symbol,
  });
  const quote = useQuote(symbol);
  const connection = useConnectionStore((s) => s.connection.state);
  const status = quoteStatusView(quote, connection);
  const flash = usePriceFlash(quote?.last ?? null, quote?.lastTradeAt ?? null);
  const direction = status.dimmed ? 0 : changeDirection(quote?.change);
  const tone = direction > 0 ? 'gain' : direction < 0 ? 'loss' : 'muted';

  const onClick = (event: MouseEvent<HTMLTableRowElement>) => {
    const target = event.target as Node;
    // ** Menu items render in a portal, but React still bubbles their clicks to this row.
    if (!event.currentTarget.contains(target)) return;
    if (target instanceof Element && target.closest('[data-row-actions]')) return;
    actions.open(symbol);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTableRowElement>) => {
    if (event.target !== event.currentTarget || event.ctrlKey || event.metaKey) return;
    if (event.altKey) {
      if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
      event.preventDefault();
      actions.move(symbol, event.key === 'ArrowUp' ? -1 : 1);
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      actions.open(symbol);
    } else if (event.key === 'Delete') {
      event.preventDefault();
      actions.remove(symbol);
    } else {
      actions.navigate(symbol, event.key);
    }
  };

  return (
    <tr
      ref={setNodeRef}
      data-symbol={symbol}
      tabIndex={tabbable ? 0 : -1}
      aria-keyshortcuts="Enter Delete Alt+ArrowUp Alt+ArrowDown"
      className={cx('market-row', status.dimmed && 'is-dimmed', isDragging && 'is-dragging')}
      // ** Only the vertical offset applies, so a dragged row stays in its column.
      style={{ transform: transform ? `translate3d(0, ${Math.round(transform.y)}px, 0)` : undefined, transition }}
      onClick={onClick}
      onKeyDown={onKeyDown}
      onFocus={(event) => {
        if (event.target === event.currentTarget) actions.focus(symbol);
      }}
    >
      <td className="market-row__grip" data-row-actions="">
        {/* Pointer only: Alt+Up/Down and the row menu reorder from the keyboard. */}
        <span ref={setActivatorNodeRef} className="market-row__handle" aria-hidden="true" {...listeners}>
          <GripVertical />
        </span>
      </td>
      <td>
        <div className="market-row__label">
          <span className="market-row__badge" aria-hidden="true">
            {symbol.charAt(0)}
          </span>
          <span className="market-row__names">
            <span className="market-row__symbol">{symbol}</span>
            <InstrumentName symbol={symbol} />
          </span>
        </div>
      </td>
      <td
        key={`last-${flash.key}`}
        className={cx(
          'is-num market-row__value market-row__last',
          flash.direction !== null && `flash-${flash.direction}`,
        )}
      >
        {formatPrice(quote?.last)}
      </td>
      <td className={cx('is-num market-row__value market-col--change', `is-${tone}`)}>
        {formatChange(quote?.change, quote?.last)}
      </td>
      <td className="is-num">
        <Badge tone={tone} size="sm">
          {formatPercent(quote?.changePct)}
        </Badge>
      </td>
      <td className="market-col--range">
        <DayRange quote={quote} />
      </td>
      <td className="market-col--trend">
        <Sparkline symbol={symbol} width={96} height={28} direction={direction} />
      </td>
      <td className="is-num is-muted market-col--volume">{formatVolume(quote?.volume)}</td>
      <td className="market-col--status">
        <StatusDot tone={status.tone} label={status.label} />
      </td>
      <td className="market-row__actions" data-row-actions="">
        <IconButton
          label={`Create alert for ${symbol}`}
          icon={<BellPlus />}
          size="sm"
          variant="ghost"
          tabIndex={tabbable ? 0 : -1}
          onClick={() => {
            actions.createAlert(symbol);
          }}
        />
        <Menu
          align="end"
          trigger={(props) => (
            <IconButton
              {...props}
              label={`More actions for ${symbol}`}
              icon={<Ellipsis />}
              size="sm"
              variant="ghost"
              tabIndex={tabbable ? 0 : -1}
            />
          )}
          items={[
            {
              id: 'up',
              label: 'Move up',
              icon: <ArrowUp />,
              disabled: !canMoveUp,
              onSelect: () => {
                actions.move(symbol, -1);
              },
            },
            {
              id: 'down',
              label: 'Move down',
              icon: <ArrowDown />,
              disabled: !canMoveDown,
              onSelect: () => {
                actions.move(symbol, 1);
              },
            },
            {
              id: 'remove',
              label: 'Remove from watchlist',
              icon: <Trash2 />,
              danger: true,
              onSelect: () => {
                actions.remove(symbol);
              },
            },
          ]}
        />
      </td>
    </tr>
  );
});

function InstrumentName({ symbol }: { symbol: string }) {
  const entry = useInstrument(symbol);
  if (!entry) return null;
  if (entry.status === 'loading') {
    return (
      <span className="market-row__name">
        <Skeleton width={96} height={9} />
      </span>
    );
  }
  if (!entry.instrument) return <span className="market-row__name">Unknown symbol</span>;
  return (
    <span className="market-row__name" title={entry.instrument.name}>
      {entry.instrument.name}
    </span>
  );
}

/** Today's low and high, with a marker at the last price. */
function DayRange({ quote }: { quote: Quote | undefined }) {
  const position = rangePosition(quote?.low, quote?.high, quote?.last);
  return (
    <div className="day-range">
      <span className="day-range__track" aria-hidden="true">
        {position !== null && <span className="day-range__marker" style={{ left: `${position * 100}%` }} />}
      </span>
      <span className="day-range__ends num">
        <span className="visually-hidden">Low </span>
        <span>{formatPrice(quote?.low)}</span>
        <span className="visually-hidden">, high </span>
        <span>{formatPrice(quote?.high)}</span>
      </span>
    </div>
  );
}
