import { StatusDot } from '../../components/ui/StatusDot';
import { useConnectionStore } from '../../data/connectionStore';
import type { Instrument } from '../../domain/types';
import { assetClassLabel, dataSourceNote, sessionNow, tradingHours } from './instrumentInfo';
import { StockCard } from './StockCard';
import { useNow } from './useNow';
import './stockPage.css';

const MINUTE_MS = 60_000;

/** What the instrument is, when it trades and where its data comes from. */
export function AboutCard({ instrument }: { instrument: Instrument }) {
  const simulated = useConnectionStore((s) => s.connection.simulated);
  const now = useNow(MINUTE_MS);
  const session = sessionNow(instrument.assetClass, now);
  return (
    <StockCard title="About" className="about-card">
      <dl className="about-card__list">
        <div className="about-card__row">
          <dt>Name</dt>
          <dd>{instrument.name}</dd>
        </div>
        <div className="about-card__row">
          <dt>Symbol</dt>
          <dd>{instrument.symbol}</dd>
        </div>
        <div className="about-card__row">
          <dt>Exchange</dt>
          <dd>{instrument.exchange}</dd>
        </div>
        <div className="about-card__row">
          <dt>Asset class</dt>
          <dd>{assetClassLabel(instrument.assetClass)}</dd>
        </div>
        <div className="about-card__row">
          <dt>Trading hours</dt>
          <dd>{tradingHours(instrument.assetClass)}</dd>
        </div>
        <div className="about-card__row">
          <dt>Market now</dt>
          <dd>
            <StatusDot tone={session.open ? 'gain' : 'muted'} label={session.label} />
          </dd>
        </div>
        <div className="about-card__row about-card__row--stacked">
          <dt>Data source</dt>
          <dd>{dataSourceNote(simulated)}</dd>
        </div>
      </dl>
    </StockCard>
  );
}
