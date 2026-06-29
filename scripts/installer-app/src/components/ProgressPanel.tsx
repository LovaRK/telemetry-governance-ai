import type { InstallerStep } from '../installer/installerTypes';

interface Props {
  steps:       InstallerStep[];
  currentStep: string | null;
}

const STATUS_ICONS: Record<string, string> = {
  pending: '○',
  running: '◐',
  ok:      '✓',
  warn:    '⚠',
  error:   '✗',
};

export function ProgressPanel({ steps, currentStep }: Props) {
  const done   = steps.filter(s => s.status === 'ok').length;
  const total  = steps.length;
  const pct    = total > 0 ? Math.round((done / total) * 100) : 0;
  const failed = steps.some(s => s.status === 'error');

  return (
    <div className="progress-panel">
      {/* Progress bar */}
      <div className="progress-bar-wrap">
        <div
          className={`progress-bar-fill ${failed ? 'error' : ''}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="progress-pct">{pct}%</div>

      {/* Steps list */}
      <div className="steps-list">
        {steps.map(step => (
          <div
            key={step.id}
            className={`step-row status-${step.status} ${step.id === currentStep ? 'active' : ''}`}
          >
            <span className="step-icon">{STATUS_ICONS[step.status]}</span>
            <span className="step-label">{step.label}</span>
            {step.detail && <span className="step-detail">{step.detail}</span>}
          </div>
        ))}
      </div>
    </div>
  );
}
