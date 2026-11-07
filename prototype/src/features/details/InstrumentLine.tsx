import { RotateCw } from 'lucide-react';
import { IconButton } from '../../components/ui/IconButton';
import { Skeleton } from '../../components/ui/Skeleton';
import type { InstrumentView } from './useInstrument';
import './details.css';

/** Company name and exchange under the symbol, with loading, error (and retry) and unknown states. */
export function InstrumentLine({ view, onRetry }: { view: InstrumentView; onRetry: () => void }) {
  if (view.status === 'loading') {
    return (
      <div className="details__instrument" aria-busy="true">
        <span className="visually-hidden">Loading company details</span>
        <Skeleton width={180} height={12} />
      </div>
    );
  }
  if (view.status === 'error') {
    return (
      <div className="details__instrument is-error">
        <span title={view.message}>Company details unavailable</span>
        <IconButton size="sm" label="Retry loading company details" icon={<RotateCw />} onClick={onRetry} />
      </div>
    );
  }
  if (view.instrument === null) {
    return <p className="details__instrument">Unknown symbol</p>;
  }
  return (
    <p className="details__instrument">
      <span className="details__name">{view.instrument.name}</span>
      <span className="details__exchange">{view.instrument.exchange}</span>
    </p>
  );
}
