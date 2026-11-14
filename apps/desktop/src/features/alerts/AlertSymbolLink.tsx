import { Link } from 'wouter';
import { paths } from '../../app/routes';

/** A symbol that opens its symbol page. */
export function AlertSymbolLink({ symbol }: { symbol: string }) {
  return (
    <Link href={paths.symbol(symbol)} className="alerts-symbol" aria-label={`${symbol}, open symbol page`}>
      {symbol}
    </Link>
  );
}
