import { Badge } from './components/ui/Badge';
import { Showcase } from './components/ui/Showcase';
import { ToastViewport } from './components/ui/ToastViewport';

/** Temporary shell that renders the design-system showcase until the feature screens are wired in. */
export function App() {
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
