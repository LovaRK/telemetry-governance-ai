export type InstallerMode = 'install' | 'reinstall' | 'repair' | 'uninstall';

export type StepStatus = 'pending' | 'running' | 'ok' | 'warn' | 'error';

export interface InstallerStep {
  id:      string;
  label:   string;
  status:  StepStatus;
  detail?: string;
}

export interface InstallerState {
  mode:         InstallerMode | null;
  phase:        'idle' | 'precheck' | 'running' | 'done' | 'error';
  steps:        InstallerStep[];
  logs:         string[];
  errorMessage: string | null;
  dashboardUrl: string | null;
}

export interface PrecheckResult {
  os:          'windows' | 'mac';
  existingInstall: boolean;
  dockerInstalled: boolean;
  diskFreeGb:  number;
  ramGb:       number;
  portsFree:   boolean;
  blockers:    string[];
  warnings:    string[];
}
