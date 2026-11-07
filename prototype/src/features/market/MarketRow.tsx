import { ArrowDown, ArrowUp, BellPlus, Ellipsis, Trash2 } from 'lucide-react';
import { memo, useEffect, useRef, type KeyboardEvent, type MouseEvent } from 'react';
import { Badge } from '../../components/ui/Badge';
import { cx } from '../../components/ui/cx';
import { IconButton } from '../../components/ui/IconButton';
import { Menu } from '../../components/ui/Menu';
import { Skeleton } from '../../components/ui/Skeleton';
import { StatusDot } from '../../components/ui/StatusDot';
import { useConnectionStore } from '../../data/connectionStore';
import { useQuote } from '../../data/quoteStore';
import {
  changeDirection,
  formatAge,
  formatChange,
  formatClock,
  formatPercent,
  formatPrice,
  formatVolume,
} from '../../lib/format';
import { useNow } from './clock';
import { useInstrument } from './instrumentStore';
import { isNavigationKey, quoteDataTime, quoteStatusView, type NavigationKey } from './marketModel';
import { revealElement } from './reveal';
import { usePriceFlash } from './usePriceFlash';

/** Row callbacks. The table passes one stable object so ticks never re-render other rows. */
export interface MarketRowActions {
  select(symbol: string): void;
  navigate(from: string, key: NavigationKey, fromIsSelected: boolean): void;
  move(symbol: string, delta: -1 | 1): void;
  remove(symbol: string): void;
  createAlert(symbol: string): void;
}

interface MarketRowProps {
  symbol: string;
  selected: boolean;
  /** The one row in the tab order. Arrow keys move between rows from there. */
  tabbable: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  actions: MarketRowActions;
}

/** One watchlist symbol. Reads its own quote, so a tick re-renders only this row. */
export const MarketRow = memo(function MarketRow({
  symbol,
  selected,
  tabbable,
  canMoveUp,
  canMoveDown,
  actions,
}: MarketRowProps) {
  const rowRef = useRef<HTMLTableRowElement>(null);
  const quote = useQuote(symbol);
  const connection = useConnectionStore((s) => s.connection.state);
  const status = quoteStatusView(quote, connection);
  const flash = usePriceFlash(quote?.last ?? null, quote?.lastTradeAt ?? null);
  const direction = status.dimmed ? 0 : changeDirection(quote?.change);
  const tone = direction > 0 ? 'gain' : direction < 0 ? 'loss' : 'muted';

  // Selecting from elsewhere (search, alerts) scrolls the row into view.
  useEffect(() => {
    if (selected) revealElement(rowRef.current);
  }, [selected]);

  const onClick = (event: MouseEvent<HTMLTableRowElement>) => {
    const target = event.target as Node;
    // ** Menu items render in a portal, but React still bubbles their clicks to this row.
    if (!event.currentTarget.contains(target)) return;
    // Opening the row menu shouldn't change the detail panel.
    if (target instanceof Element && target.closest('[data-row-actions]')) return;
    actions.select(symbol);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTableRowElement>) => {
    if (event.target !== event.currentTarget) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      actions.select(symbol);
    } else if (isNavigationKey(event.key) && !event.altKey && !event.ctrlKey && !event.metaKey) {
      event.preventDefault();
      actions.navigate(symbol, event.key, selected);
    }
  };

  return (
    <tr
      ref={rowRef}
      data-symbol={symbol}
      aria-selected={selected}
      tabIndex={tabbable ? 0 : -1}
      className={cx('market-row', status.dimmed && 'is-dimmed')}
      onClick={onClick}
      onKeyDown={onKeyDown}
    >
      <td>
        <div className="market-row__label">
          <span className="market-row__symbol">{symbol}</span>
          <InstrumentName symbol={symbol} />
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
      <td className={cx('is-num market-row__value', `is-${tone}`)}>
        {formatChange(quote?.change, quote?.last)}
      </td>
      <td className="is-num">
        <Badge tone={tone} size="sm">
          {formatPercent(quote?.changePct)}
        </Badge>
      </td>
      <td className="is-num market-row__value market-col--bid">{formatPrice(quote?.bid)}</td>
      <td className="is-num market-row__value market-col--ask">{formatPrice(quote?.ask)}</td>
      <td className="is-num is-muted market-col--volume">{formatVolume(quote?.volume)}</td>
      <td>
        <StatusDot tone={status.tone} label={status.label} />
      </td>
      <td className="is-num is-muted market-col--updated">
        <QuoteAge time={quoteDataTime(quote)} />
      </td>
      <td className="market-row__actions" data-row-actions="">
        <Menu
          align="end"
          trigger={(props) => (
            <IconButton
              {...props}
              label={`Actions for ${symbol}`}
              icon={<Ellipsis />}
              size="sm"
              tabIndex={tabbable ? 0 : -1}
              className="market-row__menu"
            />
          )}
          items={[
            {
              id: 'alert',
              label: 'Create alert',
              icon: <BellPlus />,
              onSelect: () => {
                actions.createAlert(symbol);
              },
            },
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
        <Skeleton width={72} height={9} />
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

/** Age of the quote's market data. Shares the 1s clock, so only these cells re-render each second. */
function QuoteAge({ time }: { time: number | null }) {
  const now = useNow();
  return <span title={time === null ? undefined : `${formatClock(time)} ET`}>{formatAge(time, now)}</span>;
}
