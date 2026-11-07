import { Plus, Search, Trash2, TriangleAlert } from 'lucide-react';
import { useRef, useState } from 'react';
import { useUiStore, type BottomDockTab } from '../../app/uiStore';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { PageHeader } from '../../components/ui/PageHeader';
import { SegmentedControl } from '../../components/ui/SegmentedControl';
import { Tabs } from '../../components/ui/Tabs';
import { TextInput } from '../../components/ui/TextInput';
import { useConnectionStore } from '../../data/connectionStore';
import { STATUS_FILTERS, type StatusFilter } from './alertFilters';
import { useAlertStore } from './alertStore';
import { AlertsTable } from './AlertsTable';
import { AlertSummaryCards } from './AlertSummaryCards';
import { TriggerHistory } from './TriggerHistory';
import './alerts.css';

const STATUS_OPTIONS = [...STATUS_FILTERS];

/** Every price alert with its status, plus the triggers received this session. */
export function AlertsPage() {
  // ** The selected tab lives in uiStore (the old dock's tab state), so it survives a trip to a
  // symbol page and back.
  const tab = useUiStore((s) => s.bottomDockTab);
  const [status, setStatus] = useState<StatusFilter>('all');
  const [query, setQuery] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  const alertCount = useAlertStore((s) => s.alerts.length);
  // A count of 0 before the list has loaded would claim there are no alerts.
  const countKnown = useAlertStore((s) => s.status === 'ready' || s.alerts.length > 0);
  const eventCount = useAlertStore((s) => s.events.length);
  const simulated = useConnectionStore((s) => s.connection.simulated);
  const connectionState = useConnectionStore((s) => s.connection.state);
  const offline = connectionState === 'disconnected' || connectionState === 'reconnecting';

  const clearFilters = () => {
    setStatus('all');
    setQuery('');
    // ** The empty state's button disappears with the filters, so focus moves to the search box.
    searchRef.current?.focus();
  };

  return (
    <div className="page alerts-page">
      <PageHeader
        title="Alerts"
        meta={
          simulated && (
            <Badge tone="warning" size="sm" title="Prices come from the simulated feed, not a real market">
              Simulated
            </Badge>
          )
        }
        description="Alerts are evaluated on the server against the last trade price. Buy and Sell are labels only; Aperture never places trades."
        actions={
          <Button
            variant="primary"
            icon={<Plus />}
            data-alerts-new
            onClick={() => {
              useUiStore.getState().openCreateAlert(null);
            }}
          >
            New alert
          </Button>
        }
      />

      {offline && (
        <p className="alerts-notice" role="status">
          <TriangleAlert aria-hidden="true" />
          <span>
            Not connected. Current prices may be out of date, and new triggers appear once the connection returns.
          </span>
        </p>
      )}

      <AlertSummaryCards />

      <section className="alerts-card" aria-label="Alerts and trigger history">
        <div className="alerts-card__header">
          <Tabs<BottomDockTab>
            aria-label="Alerts view"
            value={tab}
            onChange={(next) => {
              useUiStore.getState().setBottomDockTab(next);
            }}
            tabs={[
              { value: 'alerts', label: 'Alerts', badge: countKnown ? alertCount : undefined },
              { value: 'log', label: 'Trigger history', badge: eventCount },
            ]}
          />
        </div>
        <div className="alerts-card__toolbar">
          {tab === 'alerts' && (
            <SegmentedControl<StatusFilter>
              size="sm"
              aria-label="Filter by status"
              options={STATUS_OPTIONS}
              value={status}
              onChange={setStatus}
            />
          )}
          <TextInput
            ref={searchRef}
            type="search"
            className="alerts-card__search"
            aria-label="Filter by symbol"
            placeholder="Filter by symbol"
            leadingIcon={<Search />}
            value={query}
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => {
              setQuery(event.currentTarget.value);
            }}
          />
          <span className="alerts-card__spacer" />
          {tab === 'log' && (
            <Button
              size="sm"
              variant="ghost"
              icon={<Trash2 />}
              disabled={eventCount === 0}
              onClick={() => {
                useAlertStore.getState().clearEvents();
              }}
            >
              Clear history
            </Button>
          )}
        </div>
        <div
          className="alerts-card__panel"
          role="tabpanel"
          aria-label={tab === 'alerts' ? 'Alerts' : 'Trigger history'}
          // ** The table can scroll sideways in a narrow window, so the panel itself takes keyboard focus.
          tabIndex={0}
        >
          {tab === 'alerts' ? (
            <AlertsTable status={status} query={query} onClearFilters={clearFilters} />
          ) : (
            <TriggerHistory query={query} onClearFilters={clearFilters} />
          )}
        </div>
      </section>
    </div>
  );
}
