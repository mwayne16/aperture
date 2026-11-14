import { ArrowDown, ArrowUp, ChevronsUpDown } from 'lucide-react';
import type { MouseEvent } from 'react';
import { Link, useLocation } from 'wouter';
import { paths } from '../../app/routes';
import { Badge } from '../../components/ui/Badge';
import { cx } from '../../components/ui/cx';
import { Skeleton } from '../../components/ui/Skeleton';
import { changeDirection, formatChange, formatPercent, formatPrice, formatVolume } from '../../lib/format';
import { ariaSort, type DiscoverRow, type SortColumn, type SortState } from './discoverModel';
import { Sparkline } from './Sparkline';
import { WatchToggle } from './WatchToggle';

interface Column {
  id: SortColumn;
  label: string;
  numeric: boolean;
}

interface DiscoverTableProps {
  rows: readonly DiscoverRow[];
  sort: SortState;
  onSort: (column: SortColumn) => void;
  /** Prices are still on their way, so value cells show placeholders. */
  pricesLoading: boolean;
  /** Crypto volume counts coins, not shares. */
  volumeUnit: 'shares' | 'coins';
  caption: string;
}

/**
 * Dense, sortable instrument table. The symbol in each row is a link, so rows are reachable with Tab
 * and open with Enter; a click anywhere else on the row opens the symbol too.
 */
export function DiscoverTable({
  rows,
  sort,
  onSort,
  pricesLoading,
  volumeUnit,
  caption,
}: DiscoverTableProps) {
  const [, navigate] = useLocation();
  const columns: Column[] = [
    { id: 'symbol', label: 'Symbol', numeric: false },
    { id: 'last', label: 'Last', numeric: true },
    { id: 'change', label: 'Change', numeric: true },
    { id: 'changePct', label: 'Change %', numeric: true },
    { id: 'volume', label: volumeUnit === 'coins' ? 'Volume (coins)' : 'Volume', numeric: true },
  ];

  const openRow = (event: MouseEvent<HTMLTableRowElement>, symbol: string) => {
    const target = event.target as Element;
    // ** The link and the star handle their own clicks; the star's tooltip renders in a portal.
    if (!event.currentTarget.contains(target) || target.closest('a, button')) return;
    navigate(paths.symbol(symbol));
  };

  return (
    <table className="ui-table discover-table">
      <caption className="visually-hidden">{caption}</caption>
      <thead>
        <tr>
          {columns.map((column) => (
            <th
              key={column.id}
              scope="col"
              aria-sort={ariaSort(sort, column.id)}
              className={cx(column.numeric && 'is-num', `discover-col--${column.id}`)}
            >
              <SortButton column={column} sort={sort} onSort={onSort} />
            </th>
          ))}
          <th scope="col" className="discover-col--trend">
            1D
          </th>
          <th scope="col" className="discover-col--watch">
            <span className="visually-hidden">Watch</span>
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map(({ instrument, quote }) => {
          const direction = changeDirection(quote?.change);
          const tone = direction > 0 ? 'gain' : direction < 0 ? 'loss' : 'muted';
          return (
            <tr
              key={instrument.symbol}
              className="discover-row"
              onClick={(event) => {
                openRow(event, instrument.symbol);
              }}
            >
              <td className="discover-col--symbol">
                <Link href={paths.symbol(instrument.symbol)} className="discover-row__link">
                  <span className="discover-row__symbol">{instrument.symbol}</span>{' '}
                  <span className="discover-row__name">{instrument.name}</span>
                </Link>
              </td>
              {pricesLoading ? (
                <>
                  <ValuePlaceholder width={56} />
                  <ValuePlaceholder width={44} />
                  <ValuePlaceholder width={52} />
                  <ValuePlaceholder width={40} />
                </>
              ) : (
                <>
                  <td className="is-num discover-row__last">{formatPrice(quote?.last)}</td>
                  <td className={cx('is-num', `is-${tone}`)}>{formatChange(quote?.change, quote?.last)}</td>
                  <td className="is-num">
                    <Badge tone={tone} size="sm">
                      {formatPercent(quote?.changePct)}
                    </Badge>
                  </td>
                  <td className="is-num">{formatVolume(quote?.volume)}</td>
                </>
              )}
              <td className="discover-col--trend">
                <Sparkline symbol={instrument.symbol} width={72} height={20} direction={direction} />
              </td>
              <td className="discover-col--watch">
                <WatchToggle symbol={instrument.symbol} />
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function ValuePlaceholder({ width }: { width: number }) {
  return (
    <td className="is-num">
      <span className="discover-row__placeholder">
        <Skeleton width={width} height={10} />
      </span>
    </td>
  );
}

function SortButton({
  column,
  sort,
  onSort,
}: {
  column: Column;
  sort: SortState;
  onSort: (column: SortColumn) => void;
}) {
  const active = sort.column === column.id;
  const Icon = !active ? ChevronsUpDown : sort.direction === 'asc' ? ArrowUp : ArrowDown;
  return (
    <button
      type="button"
      className={cx('discover-sort', active && 'is-active', column.numeric && 'is-num')}
      onClick={() => {
        onSort(column.id);
      }}
    >
      <span>{column.label}</span>
      <Icon className="discover-sort__icon" aria-hidden="true" />
    </button>
  );
}
