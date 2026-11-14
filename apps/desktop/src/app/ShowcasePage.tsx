import { Badge } from '../components/ui/Badge';
import { Showcase } from '../components/ui/Showcase';
import { ToastViewport } from '../components/ui/ToastViewport';

/** Design-system showcase for reviewing primitives in both themes. Open the app with #showcase. */
export function ShowcasePage() {
  return (
    <div className="app-shell">
      <header className="app-topbar">
        <h1 className="app-topbar__brand">Aperture</h1>
        <span className="app-topbar__context">Design system</span>
        <span className="app-topbar__spacer" />
        <Badge tone="warning" variant="soft" title="No real market data is used in this prototype">
          Simulated data
        </Badge>
      </header>
      <main className="app-main">
        <Showcase />
      </main>
      <ToastViewport />
    </div>
  );
}
