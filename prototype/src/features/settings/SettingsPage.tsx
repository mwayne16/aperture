import { PageHeader } from '../../components/ui/PageHeader';
import { useSettingsStore } from './settingsStore';

/** App preferences. A first version: the settings feature replaces it with the full page. */
export function SettingsPage() {
  const settings = useSettingsStore((s) => s.settings);
  return (
    <div className="page">
      <PageHeader title="Settings" description="Appearance, market data, notifications and chart defaults." />
      <dl>
        <dt>Default chart range</dt>
        <dd>{settings.defaultChartRange}</dd>
        <dt>Chart style</dt>
        <dd>{settings.chartStyle}</dd>
        <dt>Alert toasts</dt>
        <dd>{settings.triggerToasts ? 'On' : 'Off'}</dd>
      </dl>
    </div>
  );
}
