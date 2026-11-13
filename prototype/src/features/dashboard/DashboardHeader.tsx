import { PageHeader } from '../../components/ui/PageHeader';
import { StatusDot } from '../../components/ui/StatusDot';
import { formatClock } from '../../lib/format';
import { marketSession } from '../shell/marketSession';
import { useNow } from '../shell/useNow';
import { formatMarketDate, greetingFor, sessionView } from './marketGreeting';

/**
 * Greeting by local time, with the US market session and the New York clock. It ticks every second
 * on its own, so the cards below don't re-render with it.
 */
export function DashboardHeader() {
  const now = useNow();
  const session = sessionView(marketSession(now));
  return (
    <PageHeader
      title={greetingFor(new Date(now))}
      description={session.detail}
      actions={
        <div className="dash-header__market">
          <span className="dash-header__session">
            <StatusDot tone={session.tone} pulse={session.pulse} label={session.label} />
          </span>
          <span className="dash-header__clock">
            <span className="dash-header__date">{formatMarketDate(now)}</span>
            <span className="dash-header__time num">New York {formatClock(now)}</span>
          </span>
        </div>
      }
    />
  );
}
