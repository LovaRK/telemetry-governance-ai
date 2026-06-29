/**
 * datasensAI Installer — main UI shell
 *
 * State machine:
 *   idle → precheck → mode-select → running → done | error
 */
import { useEffect, useReducer, useCallback } from 'react';
import { ModeSelector }  from './components/ModeSelector';
import { ProgressPanel } from './components/ProgressPanel';
import { LogViewer }     from './components/LogViewer';
import {
  runPrecheck, startInstall, cancelInstall,
  openDashboard, streamLogs, getInstallSteps,
} from './installer/installerApi';
import type { InstallerMode, InstallerState, PrecheckResult } from './installer/installerTypes';

// ── Reducer ──────────────────────────────────────────────────────────────────
type Action =
  | { type: 'PRECHECK_DONE';  result: PrecheckResult }
  | { type: 'MODE_SELECTED';  mode: InstallerMode }
  | { type: 'LOG_LINE';       line: string }
  | { type: 'STEPS_UPDATED'  }
  | { type: 'DONE';           dashboardUrl: string }
  | { type: 'ERROR';          message: string }
  | { type: 'RESET' };

const initial: InstallerState = {
  mode: null, phase: 'idle', steps: [], logs: [],
  errorMessage: null, dashboardUrl: null,
};

function reducer(state: InstallerState, action: Action): InstallerState {
  switch (action.type) {
    case 'PRECHECK_DONE':  return { ...state, phase: 'precheck' };
    case 'MODE_SELECTED':  return { ...state, mode: action.mode, phase: 'running' };
    case 'LOG_LINE':       return { ...state, logs: [...state.logs, action.line] };
    case 'DONE':           return { ...state, phase: 'done', dashboardUrl: action.dashboardUrl };
    case 'ERROR':          return { ...state, phase: 'error', errorMessage: action.message };
    case 'RESET':          return initial;
    default:               return state;
  }
}

// ── App ──────────────────────────────────────────────────────────────────────
export default function App() {
  const [state, dispatch] = useReducer(reducer, initial);
  const [precheck, setPrecheck]   = useReducer((_: any, v: PrecheckResult) => v, null as any);
  const [steps,    setSteps]      = useReducer((_: any, v: any) => v, []);

  // Run precheck on mount
  useEffect(() => {
    runPrecheck().then(result => {
      setPrecheck(result);
      dispatch({ type: 'PRECHECK_DONE', result });
    });
  }, []);

  // Poll steps while running
  useEffect(() => {
    if (state.phase !== 'running') return;
    const t = setInterval(() => getInstallSteps().then(setSteps), 800);
    return () => clearInterval(t);
  }, [state.phase]);

  // Stream logs while running
  useEffect(() => {
    if (state.phase !== 'running') return;
    return streamLogs(line => dispatch({ type: 'LOG_LINE', line }));
  }, [state.phase]);

  const handleModeSelect = useCallback(async (mode: InstallerMode) => {
    dispatch({ type: 'MODE_SELECTED', mode });
    try {
      await startInstall(mode);
      // success is reported via log stream — final event triggers DONE
    } catch (err: any) {
      dispatch({ type: 'ERROR', message: err?.message ?? String(err) });
    }
  }, []);

  const currentStep = steps.find((s: any) => s.status === 'running')?.id ?? null;

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="app">
      {/* Header */}
      <header className="app-header">
        <div className="logo">
          <svg width="28" height="28" viewBox="0 0 32 32" fill="none">
            <rect width="32" height="32" rx="8" fill="#6366f1"/>
            <path d="M8 16 L14 10 L20 16 L26 10" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M8 22 L14 16 L20 22 L26 16" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" opacity="0.6"/>
          </svg>
          <span>datasensAI</span>
        </div>
        <span className="version">v1.3.0</span>
      </header>

      {/* Body */}
      <main className="app-main">

        {/* Idle — checking system */}
        {state.phase === 'idle' && (
          <div className="center-message">
            <div className="spinner" />
            <p>Checking your system…</p>
          </div>
        )}

        {/* Precheck — mode selection */}
        {state.phase === 'precheck' && precheck && (
          <>
            {/* Blockers */}
            {precheck.blockers.length > 0 && (
              <div className="blockers">
                <strong>Cannot install — please fix these first:</strong>
                <ul>{precheck.blockers.map((b, i) => <li key={i}>{b}</li>)}</ul>
              </div>
            )}
            {/* Warnings */}
            {precheck.warnings.length > 0 && (
              <div className="warnings">
                {precheck.warnings.map((w, i) => <div key={i}>⚠ {w}</div>)}
              </div>
            )}
            <ModeSelector precheck={precheck} onSelect={handleModeSelect} />
          </>
        )}

        {/* Running */}
        {state.phase === 'running' && (
          <>
            <h2 className="running-title">
              {state.mode === 'install'   && 'Installing datasensAI…'}
              {state.mode === 'reinstall' && 'Reinstalling datasensAI…'}
              {state.mode === 'repair'    && 'Repairing datasensAI…'}
              {state.mode === 'uninstall' && 'Uninstalling datasensAI…'}
            </h2>
            <ProgressPanel steps={steps} currentStep={currentStep} />
            <LogViewer logs={state.logs} />
            <button className="cancel-btn" onClick={cancelInstall}>Cancel</button>
          </>
        )}

        {/* Done */}
        {state.phase === 'done' && (
          <div className="done-screen">
            <div className="done-icon">✓</div>
            <h2>datasensAI is ready</h2>
            <p>Your dashboard is running at <strong>localhost:3002</strong></p>
            {state.dashboardUrl && (
              <button className="open-btn" onClick={() => openDashboard(state.dashboardUrl!)}>
                Open Dashboard →
              </button>
            )}
            <button className="secondary-btn" onClick={() => dispatch({ type: 'RESET' })}>
              Back to menu
            </button>
          </div>
        )}

        {/* Error */}
        {state.phase === 'error' && (
          <div className="error-screen">
            <div className="error-icon">✗</div>
            <h2>Installation failed</h2>
            <p className="error-msg">{state.errorMessage}</p>
            <p className="error-hint">
              Run the health check from the installer folder:<br/>
              <code>doctor.sh</code> (Mac) or <code>doctor.ps1</code> (Windows)
            </p>
            <LogViewer logs={state.logs} />
            <button className="primary-btn" onClick={() => dispatch({ type: 'RESET' })}>
              Try again
            </button>
          </div>
        )}

      </main>
    </div>
  );
}
