import { BellPlus, ExternalLink } from 'lucide-react';
import { useRef } from 'react';
import { useRoute } from 'wouter';
import { paths, routes } from '../../app/routes';
import { useUiStore } from '../../app/uiStore';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { IconButton } from '../../components/ui/IconButton';
import { showToast } from '../../components/ui/toastStore';
import { SimulatedBadge } from '../discover/SimulatedBadge';
import { assetClassLabel } from './instrumentInfo';
import { InstrumentLine } from './InstrumentLine';
import { openPopOut } from './popOut';
import { LiveQuote } from './QuoteSummary';
import type { InstrumentView } from './useInstrument';
import { WatchButton } from './WatchButton';
import './stockPage.css';

interface StockHeaderProps {
  symbol: string;
  view: InstrumentView;
  onRetry: () => void;
}

/**
 * The stock page's header: symbol, name, exchange and kind, the large live price, and the page
 * actions. An unknown symbol gets neither a price nor actions.
 */
export function StockHeader({ symbol, view, onRetry }: StockHeaderProps) {
  const identityRef = useRef<HTMLDivElement>(null);
  const instrument = view.status === 'ready' ? view.instrument : null;
  const unknown = view.status === 'ready' && instrument === null;

  return (
    <header className="stock-header">
      <div className="stock-header__top">
        <div ref={identityRef} className="stock-header__identity" tabIndex={-1}>
          <div className="stock-header__title-row">
            <h1 className="stock-header__symbol">{symbol}</h1>
            {instrument && (
              <Badge tone="neutral" size="sm">
                {assetClassLabel(instrument.assetClass)}
              </Badge>
            )}
            <SimulatedBadge title="Simulated prices, not real market data" />
          </div>
          <InstrumentLine
            view={view}
            onRetry={() => {
              // ** The retry button unmounts while the lookup runs, so focus stays on the identity block.
              identityRef.current?.focus();
              onRetry();
            }}
          />
        </div>
        {!unknown && view.status !== 'loading' && <StockActions symbol={symbol} />}
      </div>
      {!unknown && (
        <div className="stock-header__quote">
          <LiveQuote symbol={symbol} size="lg" />
        </div>
      )}
    </header>
  );
}

function StockActions({ symbol }: { symbol: string }) {
  // ** A popped-out window already is the separate window, so it doesn't offer another.
  const [inWindow] = useRoute(routes.symbolWindow);
  return (
    <div className="stock-header__actions">
      <WatchButton symbol={symbol} />
      <Button
        variant="primary"
        icon={<BellPlus />}
        onClick={() => {
          useUiStore.getState().openCreateAlert(symbol);
        }}
      >
        Create alert
      </Button>
      {!inWindow && (
        <IconButton
          variant="secondary"
          label={`Open ${symbol} in a new window`}
          icon={<ExternalLink />}
          onClick={() => {
            if (openPopOut(paths.symbolWindow(symbol))) return;
            showToast({
              tone: 'warning',
              title: 'The new window was blocked',
              description: 'Allow pop-ups for Aperture to open pages in their own window.',
            });
          }}
        />
      )}
    </div>
  );
}
