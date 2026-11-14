import { WifiOff } from 'lucide-react';
import { useConnection } from '../../data/connectionStore';
import { useNow } from './clock';
import { connectionNotice, retryCountdown } from './marketModel';

/**
 * Non-blocking banner while the feed is down. The live region stays mounted so the message is
 * announced when it appears; the countdown is hidden from it so it isn't read out every second.
 */
export function ConnectionNotice() {
  const notice = connectionNotice(useConnection());
  return (
    <div role="status" className="market-notice-slot">
      {notice && (
        <div className="market-notice">
          <WifiOff aria-hidden="true" />
          <span className="market-notice__title">{notice.title}</span>
          {notice.detail !== null && <span className="market-notice__detail">{notice.detail}</span>}
          {notice.retryAt !== null && <RetryCountdown retryAt={notice.retryAt} />}
        </div>
      )}
    </div>
  );
}

function RetryCountdown({ retryAt }: { retryAt: number }) {
  const now = useNow();
  return (
    <span className="market-notice__retry" aria-hidden="true">
      {retryCountdown(retryAt, now)}
    </span>
  );
}
