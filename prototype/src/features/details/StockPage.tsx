import { useEffect } from 'react';
import { useParams } from 'wouter';
import { decodeParam } from '../../app/routes';
import { useUiStore } from '../../app/uiStore';
import { normalizeSymbol } from '../../domain/symbols';
import { StockDetail } from './StockDetail';
import './details.css';

/** Full-page view of one symbol. The symbol in the URL becomes the selection, so it stays subscribed. */
export function StockPage() {
  const params = useParams<{ symbol?: string }>();
  const raw = decodeParam(params.symbol);
  const symbol = raw === null ? null : normalizeSymbol(raw);

  useEffect(() => {
    if (symbol !== null) useUiStore.getState().selectSymbol(symbol);
  }, [symbol]);

  return (
    <div className="page stock-page">
      <section className="stock-page__panel" aria-label="Stock details">
        <StockDetail />
      </section>
    </div>
  );
}
