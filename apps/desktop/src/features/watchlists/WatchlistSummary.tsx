import { useMemo, type ReactNode } from 'react';
import { Link } from 'wouter';
import { paths } from '../../app/routes';
import { cx } from '../../components/ui/cx';
import { useQuotes } from '../../data/quoteStore';
import { changeDirection, EMPTY_VALUE, formatChange, formatPercent } from '../../lib/format';
import { sessionView } from '../dashboard/marketGreeting';
import { marketSession } from '../shell/marketSession';
import { useNow } from '../shell/useNow';
import { summarizeQuotes, type Mover } from './summaryModel';

/** Four tiles above the watchlist table: today's breadth, best and worst symbol, and the US session. */
export function WatchlistSummary({ symbols }: { symbols: readonly string[] }) {
  const quotes = useQuotes(symbols);
  const summary = useMemo(() => summarizeQuotes(quotes), [quotes]);
  const counted = summary.up + summary.down + summary.unchanged;

  return (
    <section className="watch-summary" aria-label="Watchlist summary">
      <Tile label="Breadth">
        {counted === 0 ? (
          <>
            <span className="watch-summary__value is-muted">{EMPTY_VALUE}</span>
            <span className="watch-summary__detail">Waiting for quotes</span>
          </>
        ) : (
          <>
            <span className="watch-summary__value watch-summary__counts">
              <span className="is-gain">{summary.up} up</span> <span className="is-loss">{summary.down} down</span>
            </span>
            <span className="watch-summary__breadth" aria-hidden="true">
              {summary.up > 0 && <span className="watch-summary__bar is-gain" style={{ flexGrow: summary.up }} />}
              {summary.unchanged > 0 && (
                <span className="watch-summary__bar is-muted" style={{ flexGrow: summary.unchanged }} />
              )}
              {summary.down > 0 && <span className="watch-summary__bar is-loss" style={{ flexGrow: summary.down }} />}
            </span>
            {summary.unchanged > 0 && <span className="watch-summary__detail">{summary.unchanged} unchanged</span>}
          </>
        )}
      </Tile>
      <MoverTile label="Best today" mover={summary.best} />
      <MoverTile label="Worst today" mover={summary.worst} />
      <SessionTile />
    </section>
  );
}

function Tile({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="watch-summary__tile">
      <span className="watch-summary__label">{label}</span>
      {children}
    </div>
  );
}

function MoverTile({ label, mover }: { label: string; mover: Mover | null }) {
  if (mover === null) {
    return (
      <Tile label={label}>
        <span className="watch-summary__value is-muted">{EMPTY_VALUE}</span>
      </Tile>
    );
  }
  const direction = changeDirection(mover.change);
  return (
    <Tile label={label}>
      <Link href={paths.symbol(mover.symbol)} className="watch-summary__value watch-summary__symbol">
        {mover.symbol}
      </Link>
      <span className={cx('watch-summary__detail num', direction > 0 && 'is-gain', direction < 0 && 'is-loss')}>
        {formatChange(mover.change, mover.last)} · {formatPercent(mover.changePct)}
      </span>
    </Tile>
  );
}

/** The US equity session. It ticks every second on its own, so the other tiles don't re-render. */
function SessionTile() {
  const session = sessionView(marketSession(useNow()));
  return (
    <Tile label="Market session">
      <span className="watch-summary__value">{session.label}</span>
      <span className="watch-summary__detail">{session.detail}</span>
    </Tile>
  );
}
