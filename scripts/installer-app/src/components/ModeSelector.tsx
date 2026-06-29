import type { InstallerMode, PrecheckResult } from '../installer/installerTypes';

interface Props {
  precheck:  PrecheckResult;
  onSelect:  (mode: InstallerMode) => void;
}

const MODES: { id: InstallerMode; label: string; desc: string; icon: string; showWhen: 'always' | 'existing' | 'new' }[] = [
  { id: 'install',   label: 'Install',    icon: '⚡', desc: 'First-time setup. Downloads Docker, AI model, and starts datasensAI.',        showWhen: 'new'      },
  { id: 'reinstall', label: 'Reinstall',  icon: '🔄', desc: 'Wipe existing install and start fresh. Your Splunk data is not affected.',    showWhen: 'existing' },
  { id: 'repair',    label: 'Repair',     icon: '🔧', desc: 'Fix a broken install without losing data. Restarts containers and services.', showWhen: 'existing' },
  { id: 'uninstall', label: 'Uninstall',  icon: '🗑️', desc: 'Remove datasensAI completely. Docker and Ollama will also be removed.',       showWhen: 'existing' },
];

export function ModeSelector({ precheck, onSelect }: Props) {
  const visible = MODES.filter(m =>
    m.showWhen === 'always' ||
    (m.showWhen === 'existing' && precheck.existingInstall) ||
    (m.showWhen === 'new'      && !precheck.existingInstall)
  );

  return (
    <div className="mode-selector">
      <h2 className="mode-title">
        {precheck.existingInstall ? 'datasensAI is already installed' : 'Ready to install datasensAI'}
      </h2>
      <p className="mode-subtitle">What would you like to do?</p>
      <div className="mode-grid">
        {visible.map(m => (
          <button key={m.id} className={`mode-card mode-${m.id}`} onClick={() => onSelect(m.id)}>
            <span className="mode-icon">{m.icon}</span>
            <span className="mode-label">{m.label}</span>
            <span className="mode-desc">{m.desc}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
