import { FlaskConical } from 'lucide-react';
import { useUiStore } from '../../app/uiStore';
import { Kbd } from '../../components/ui/Kbd';
import { StatusDot } from '../../components/ui/StatusDot';
import { cx } from '../../components/ui/cx';
import { useConnection } from '../../data/connectionStore';
import { useSimulation } from '../../data/simulationStore';
import { describeConnection, formatLastMessage, formatRetry } from './connectionStatus';
import { FEED_SCENARIO_INFO } from './simulationOptions';
import { useQuoteFreshness, useSubscribedSymbols } from './useFeedStatus';
import { useNow } from './useNow';
import './shell.css';

/**
 * Status bar content: feed and connection summary on the left, the search shortcut and the
 * simulated-data notice on the right. Narrow windows drop the optional items first.
 */
export function StatusBar() {
  const connection = useConnection();
  const scenario = useSimulation().feedScenario;
  const symbols = useSubscribedSymbols();
  const view = describeConnection(connection, useQuoteFreshness(symbols));
  const now = useNow();
  const nextRetryAt = connection.state === 'reconnecting' ? connection.nextRetryAt : null;

  return (
    <div className="shell-statusbar">
      <div className="shell-statusbar__group shell-statusbar__group--feed">
        <span className="shell-statusbar__item">
          <StatusDot tone={view.tone} />
          {connection.feedName}
        </span>
        {connection.simulated && (
          <span className="shell-statusbar__item">
            <button
              type="button"
              className="shell-statusbar__link"
              aria-haspopup="dialog"
              onClick={() => {
                useUiStore.getState().setPrototypeControlsOpen(true);
              }}
            >
              Scenario: {FEED_SCENARIO_INFO[scenario].label}
            </button>
          </span>
        )}
        <span className={cx('shell-statusbar__item', view.tone === 'loss' && 'is-loss')}>
          {view.label}
          {nextRetryAt !== null && <span className="num">{` · ${formatRetry(nextRetryAt, now)}`}</span>}
        </span>
        {view.dataNote && (
          <span className="shell-statusbar__item shell-statusbar__item--shrink is-warning">
            {view.dataNote.description}
          </span>
        )}
        {connection.error && (
          <span className="shell-statusbar__item shell-statusbar__item--shrink is-warning" title={connection.error}>
            {connection.error}
          </span>
        )}
        <span className="shell-statusbar__item shell-statusbar__item--optional num">
          {symbols.length === 1 ? '1 symbol subscribed' : `${symbols.length} symbols subscribed`}
        </span>
        <span className="shell-statusbar__item shell-statusbar__item--optional num">
          {formatLastMessage(connection.lastMessageAt, now)}
        </span>
      </div>
      <div className="shell-statusbar__group shell-statusbar__group--end">
        <span className="shell-statusbar__item shell-statusbar__item--hint">
          <span className="shell-statusbar__keys">
            <Kbd>Ctrl</Kbd>
            <Kbd>K</Kbd>
          </span>
          to search
        </span>
        {connection.simulated && (
          <span className="shell-statusbar__item shell-statusbar__simulated">
            <FlaskConical aria-hidden="true" />
            Simulated data. Not real market prices.
          </span>
        )}
      </div>
    </div>
  );
}
