import { useEffect } from 'react';
import { useUiStore } from '../../app/uiStore';
import { PageHeader } from '../../components/ui/PageHeader';
import { AlertsPanel } from './AlertsPanel';
import './alerts.css';

/** Every price alert and the trigger log. */
export function AlertsPage() {
  // ** The panel was built as a collapsible dock; on its own page it always stays open.
  useEffect(() => {
    useUiStore.getState().setBottomDockOpen(true);
  }, []);

  return (
    <div className="page">
      <PageHeader title="Alerts" description="Price alerts on the last trade, evaluated on the server." />
      <section className="alerts-page__panel" aria-label="Price alerts">
        <AlertsPanel />
      </section>
    </div>
  );
}
