/**
 * Bridge between the React UI and the Tauri Rust backend.
 * Every function calls a Tauri command via invoke().
 * In dev mode (Vite without Tauri), calls are mocked so the UI can be iterated without a full Rust build.
 */
import { invoke } from '@tauri-apps/api/core';
import type { PrecheckResult, InstallerMode, InstallerStep } from './installerTypes';

const IS_TAURI = '__TAURI_INTERNALS__' in window;

// ── Mocks for browser-only dev ──────────────────────────────────────────────
const mockPrecheck: PrecheckResult = {
  os:              'mac',
  existingInstall: false,
  dockerInstalled: false,
  diskFreeGb:      180,
  ramGb:           16,
  portsFree:       true,
  blockers:        [],
  warnings:        [],
};

const mockSteps: InstallerStep[] = [
  { id: 'precheck',   label: 'System check',           status: 'ok' },
  { id: 'deps',       label: 'Install dependencies',   status: 'ok' },
  { id: 'docker',     label: 'Start Docker',           status: 'running' },
  { id: 'repo',       label: 'Download datasensAI',    status: 'pending' },
  { id: 'config',     label: 'Generate config',        status: 'pending' },
  { id: 'model',      label: 'Download AI model',      status: 'pending' },
  { id: 'stack',      label: 'Start services',         status: 'pending' },
  { id: 'db',         label: 'Database ready',         status: 'pending' },
  { id: 'migrate',    label: 'Apply migrations',       status: 'pending' },
  { id: 'seed',       label: 'Create admin account',   status: 'pending' },
  { id: 'verify',     label: 'Verify dashboard',       status: 'pending' },
];

// ── API ──────────────────────────────────────────────────────────────────────

export async function runPrecheck(): Promise<PrecheckResult> {
  if (!IS_TAURI) return mockPrecheck;
  return invoke<PrecheckResult>('run_precheck');
}

export async function startInstall(mode: InstallerMode): Promise<void> {
  if (!IS_TAURI) return;
  return invoke<void>('start_install', { mode });
}

export async function cancelInstall(): Promise<void> {
  if (!IS_TAURI) return;
  return invoke<void>('cancel_install');
}

export async function openDashboard(url: string): Promise<void> {
  if (!IS_TAURI) { window.open(url, '_blank'); return; }
  return invoke<void>('open_url', { url });
}

export async function getInstallSteps(): Promise<InstallerStep[]> {
  if (!IS_TAURI) return mockSteps;
  return invoke<InstallerStep[]>('get_install_steps');
}

export async function getLogs(): Promise<string[]> {
  if (!IS_TAURI) return ['[mock] Installer running in browser dev mode'];
  return invoke<string[]>('get_logs');
}

/** Live log stream — calls onLine for each new log line until done. */
export function streamLogs(onLine: (line: string) => void): () => void {
  if (!IS_TAURI) {
    const t = setInterval(() => onLine('[mock] installing...'), 1000);
    return () => clearInterval(t);
  }
  // Tauri event listener (wired in main.rs via emit('log-line', ...))
  let unlisten: (() => void) | null = null;
  import('@tauri-apps/api/event').then(({ listen }) => {
    listen<string>('log-line', e => onLine(e.payload)).then(fn => { unlisten = fn; });
  });
  return () => unlisten?.();
}
