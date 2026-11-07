import { ChevronDown, ChevronUp, Info, Plus, Trash2, TriangleAlert } from 'lucide-react';
import { useId } from 'react';
import { useUiStore, type BottomDockTab } from '../../app/uiStore';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { cx } from '../../components/ui/cx';
import { IconButton } from '../../components/ui/IconButton';
import { Tabs } from '../../components/ui/Tabs';
import { useConnectionStore } from '../../data/connectionStore';
import { useAlertStore } from './alertStore';
import { AlertsTable } from './AlertsTable';
import { TriggerLog } from './TriggerLog';
import './alerts.css';

/**
 * Bottom dock with the alert list and the trigger log, bound to uiStore's dock state. Collapsed it
 * is a slim bar with the tabs and an expand button; choosing a tab expands it.
 */
export function AlertsPanel() {
  const open = useUiStore((s) => s.bottomDockOpen);
  const tab = useUiStore((s) => s.bottomDockTab);
  const alertCount = useAlertStore((s) => s.alerts.length);
  // A count of 0 before the list has loaded would claim there are no alerts.
  const countKnown = useAlertStore((s) => s.status === 'ready' || s.alerts.length > 0);
  const eventCount = useAlertStore((s) => s.events.length);
  const simulated = useConnectionStore((s) => s.connection.simulated);
  const connectionState = useConnectionStore((s) => s.connection.state);
  const bodyId = useId();
  const offline = connectionState === 'disconnected' || connectionState === 'reconnecting';

  return (
    <div className={cx('alerts-dock', !open && 'is-collapsed')}>
      <div className="alerts-dock__bar">
        <Tabs<BottomDockTab>
          aria-label="Alerts panel"
          value={tab}
          onChange={(next) => {
            useUiStore.getState().setBottomDockTab(next);
          }}
          tabs={[
            { value: 'alerts', label: 'Alerts', badge: countKnown ? alertCount : undefined },
            { value: 'log', label: 'Trigger log', badge: eventCount },
          ]}
        />
        {simulated && (
          <Badge tone="warning" size="sm" title="Prices come from the simulated feed, not a real market">
            Simulated
          </Badge>
        )}
        <span className="alerts-dock__spacer" />
        {open && tab === 'alerts' && (
          <Button
            size="sm"
            icon={<Plus />}
            data-alerts-new
            onClick={() => {
              const ui = useUiStore.getState();
              ui.openCreateAlert(ui.selectedSymbol);
            }}
          >
            New alert
          </Button>
        )}
        {open && tab === 'log' && (
          <Button
            size="sm"
            variant="ghost"
            icon={<Trash2 />}
            disabled={eventCount === 0}
            onClick={() => {
              useAlertStore.getState().clearEvents();
            }}
          >
            Clear log
          </Button>
        )}
        <IconButton
          label={open ? 'Collapse alerts panel' : 'Expand alerts panel'}
          icon={open ? <ChevronDown /> : <ChevronUp />}
          size="sm"
          aria-expanded={open}
          aria-controls={open ? bodyId : undefined}
          onClick={() => {
            useUiStore.getState().setBottomDockOpen(!open);
          }}
        />
      </div>
      {open && (
        <div id={bodyId} className="alerts-dock__body">
          <p className="alerts-dock__note">
            <Info aria-hidden="true" />
            {tab === 'alerts' ? (
              <span>
                Alerts are evaluated on the server against the latest trade price (Last). Buy and Sell tags
                are labels only.
              </span>
            ) : (
              <span>Triggers received while Aperture is open. The log is kept for this session only.</span>
            )}
          </p>
          {offline && (
            <p className="alerts-dock__note alerts-dock__note--warning" role="status">
              <TriangleAlert aria-hidden="true" />
              <span>
                Not connected. Current prices may be out of date, and new triggers appear once the connection
                returns.
              </span>
            </p>
          )}
          <div
            className="alerts-dock__scroll"
            role="tabpanel"
            aria-label={tab === 'alerts' ? 'Alerts' : 'Trigger log'}
            // ** Scrollable, and the log has no controls, so the panel itself must take keyboard focus.
            tabIndex={0}
          >
            {tab === 'alerts' ? <AlertsTable /> : <TriggerLog />}
          </div>
        </div>
      )}
    </div>
  );
}
