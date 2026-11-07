import { RotateCcw } from 'lucide-react';
import { useId, useRef, useState } from 'react';
import { useUiStore } from '../../app/uiStore';
import { Button } from '../../components/ui/Button';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { cx } from '../../components/ui/cx';
import { Dialog } from '../../components/ui/Dialog';
import { SegmentedControl, type SegmentedOption } from '../../components/ui/SegmentedControl';
import { Switch } from '../../components/ui/Switch';
import { showToast } from '../../components/ui/toastStore';
import { DEFAULT_SIMULATION, type FeedScenario, type HistoryScenario } from '../../data/simulation';
import {
  API_LATENCY_RANGE,
  TICKS_PER_SECOND_RANGE,
  updateSimulation,
  useSimulation,
} from '../../data/simulationStore';
import { resetDemoAndReload } from './resetDemo';
import { FEED_SCENARIO_INFO, HISTORY_SCENARIO_INFO, isDefaultSimulation } from './simulationOptions';
import './shell.css';

const FEED_SCENARIOS = Object.keys(FEED_SCENARIO_INFO) as FeedScenario[];

const HISTORY_OPTIONS: SegmentedOption<HistoryScenario>[] = (
  Object.keys(HISTORY_SCENARIO_INFO) as HistoryScenario[]
).map((value) => ({ value, label: HISTORY_SCENARIO_INFO[value].label }));

/**
 * Prototype-only panel for forcing feed, API and history states, opened from the top bar. Every
 * change goes through updateSimulation, so the mock data layer reacts immediately.
 */
export function PrototypeControls() {
  const open = useUiStore((s) => s.prototypeControlsOpen);
  const close = () => {
    useUiStore.getState().setPrototypeControlsOpen(false);
  };
  return (
    <Dialog
      open={open}
      onClose={close}
      title="Simulation controls"
      description="Prototype only. These settings drive the simulated feed and mock API. No real market data is used."
      width={720}
      footer={<ControlsFooter onDone={close} />}
    >
      <SimulationForm />
    </Dialog>
  );
}

function ControlsFooter({ onDone }: { onDone: () => void }) {
  const simulation = useSimulation();
  const doneRef = useRef<HTMLButtonElement>(null);
  return (
    <>
      <Button
        variant="ghost"
        className="shell-controls__restore"
        disabled={isDefaultSimulation(simulation)}
        onClick={() => {
          // ** Restoring disables this button, which would drop focus out of the dialog.
          doneRef.current?.focus();
          updateSimulation(DEFAULT_SIMULATION);
        }}
      >
        Restore defaults
      </Button>
      <Button ref={doneRef} variant="primary" onClick={onDone}>
        Done
      </Button>
    </>
  );
}

function SimulationForm() {
  const simulation = useSimulation();
  const id = useId();

  return (
    <div className="shell-controls">
      <div className="shell-controls__column">
        <fieldset className="shell-controls__section">
          <legend className="shell-controls__heading">Feed scenario</legend>
          <div className="shell-scenarios">
            {FEED_SCENARIOS.map((scenario) => {
              const info = FEED_SCENARIO_INFO[scenario];
              const labelId = `${id}feed-${scenario}-label`;
              const descriptionId = `${id}feed-${scenario}-description`;
              const checked = simulation.feedScenario === scenario;
              return (
                <label key={scenario} className={cx('shell-scenario', checked && 'is-selected')}>
                  <input
                    type="radio"
                    className="shell-scenario__radio"
                    name={`${id}feed`}
                    value={scenario}
                    checked={checked}
                    // ** The wrapping label also holds the explanation; name the radio by its title alone.
                    aria-labelledby={labelId}
                    aria-describedby={descriptionId}
                    onChange={() => {
                      updateSimulation({ feedScenario: scenario });
                    }}
                  />
                  <span className="shell-scenario__text">
                    <span id={labelId} className="shell-scenario__label">
                      {info.label}
                    </span>
                    <span id={descriptionId} className="shell-scenario__description">
                      {info.description}
                    </span>
                  </span>
                </label>
              );
            })}
          </div>
        </fieldset>
        <RangeField
          label="Ticks per second"
          value={simulation.ticksPerSecond}
          range={TICKS_PER_SECOND_RANGE}
          step={1}
          display={(v) => `${v}/s`}
          spoken={(v) => `${v} per second`}
          hint="Simulated trades per second, spread across all subscribed symbols."
          onChange={(ticksPerSecond) => {
            updateSimulation({ ticksPerSecond });
          }}
        />
      </div>

      <div className="shell-controls__column">
        <div className="shell-controls__section">
          <h3 className="shell-controls__heading">Mock API</h3>
          <RangeField
            label="API latency"
            value={simulation.apiLatencyMs}
            range={API_LATENCY_RANGE}
            step={50}
            display={(v) => `${v} ms`}
            spoken={(v) => `${v} milliseconds`}
            hint="Delay added to watchlist, alert and search requests."
            onChange={(apiLatencyMs) => {
              updateSimulation({ apiLatencyMs });
            }}
          />
          <div className="shell-controls__switch">
            <Switch
              label="Fail the next API call"
              checked={simulation.failNextApiCall}
              onChange={(failNextApiCall) => {
                updateSimulation({ failNextApiCall });
              }}
            />
            <p className="shell-hint">The next request fails as unavailable, then this switches itself off.</p>
          </div>
        </div>

        <div className="shell-controls__section">
          <h3 className="shell-controls__heading">Chart history</h3>
          <SegmentedControl
            size="sm"
            aria-label="History scenario"
            options={HISTORY_OPTIONS}
            value={simulation.historyScenario}
            onChange={(historyScenario) => {
              updateSimulation({ historyScenario });
            }}
          />
          <p className="shell-hint">{HISTORY_SCENARIO_INFO[simulation.historyScenario].description}</p>
        </div>

        <div className="shell-controls__section">
          <h3 className="shell-controls__heading">Demo data</h3>
          <ResetDemoData />
        </div>
      </div>
    </div>
  );
}

interface RangeFieldProps {
  label: string;
  value: number;
  range: { min: number; max: number };
  step: number;
  /** Compact visible value, e.g. "12/s". */
  display: (value: number) => string;
  /** Value as a screen reader should say it, e.g. "12 per second". */
  spoken: (value: number) => string;
  hint: string;
  onChange: (value: number) => void;
}

function RangeField({ label, value, range, step, display, spoken, hint, onChange }: RangeFieldProps) {
  const id = useId();
  const hintId = `${id}hint`;
  return (
    <div className="shell-range">
      <div className="shell-range__header">
        <label htmlFor={id} className="shell-range__label">
          {label}
        </label>
        <output htmlFor={id} className="shell-range__value num">
          {display(value)}
        </output>
      </div>
      <input
        id={id}
        type="range"
        className="shell-range__input"
        min={range.min}
        max={range.max}
        step={step}
        value={value}
        aria-valuetext={spoken(value)}
        aria-describedby={hintId}
        onChange={(event) => {
          onChange(Number(event.currentTarget.value));
        }}
      />
      <div className="shell-range__scale num" aria-hidden="true">
        <span>{display(range.min)}</span>
        <span>{display(range.max)}</span>
      </div>
      <p id={hintId} className="shell-hint">
        {hint}
      </p>
    </div>
  );
}

function ResetDemoData() {
  const [confirming, setConfirming] = useState(false);
  const [resetting, setResetting] = useState(false);
  // ** A ref, not state, so a second confirm in the same frame can't start another reset.
  const inFlight = useRef(false);

  const reset = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setResetting(true);
    const outcome = await resetDemoAndReload();
    inFlight.current = false;
    setResetting(false);
    setConfirming(false);
    if (outcome.ok) {
      showToast({
        tone: 'success',
        title: 'Demo data reset',
        description: 'Watchlists and alerts are back to the seeded demo set.',
      });
    } else {
      showToast({
        tone: outcome.dataReset ? 'warning' : 'error',
        title: outcome.dataReset ? 'Demo data reset, but reloading failed' : 'Demo data was not reset',
        description: outcome.message,
      });
    }
  };

  return (
    <div className="shell-controls__reset">
      <p className="shell-hint">Restores the seeded watchlists and alerts. Simulation settings are kept.</p>
      <Button
        icon={<RotateCcw />}
        aria-haspopup="dialog"
        onClick={() => {
          setConfirming(true);
        }}
      >
        Reset demo data…
      </Button>
      <ConfirmDialog
        open={confirming}
        title="Reset demo data?"
        message="Watchlists and alerts return to the seeded demo set. Anything you created or changed is lost."
        confirmLabel="Reset demo data"
        tone="danger"
        busy={resetting}
        onCancel={() => {
          setConfirming(false);
        }}
        onConfirm={() => {
          void reset();
        }}
      />
    </div>
  );
}
