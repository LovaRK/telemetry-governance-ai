/**
 * Tauri commands — called from the React frontend via invoke().
 * Each command runs on a background thread so the UI never blocks.
 */
use std::sync::Mutex;
use tauri::{AppHandle, State};
use serde::{Deserialize, Serialize};

use crate::diagnostics;
use crate::install;
use crate::repair;
use crate::uninstall;

// ── Shared state ─────────────────────────────────────────────────────────────

#[derive(Default)]
pub struct InstallerState {
    pub steps: Mutex<Vec<Step>>,
    pub logs:  Mutex<Vec<String>>,
    pub cancel: Mutex<bool>,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct Step {
    pub id:     String,
    pub label:  String,
    pub status: String,     // pending | running | ok | warn | error
    pub detail: Option<String>,
}

#[derive(Serialize, Deserialize)]
pub struct PrecheckResult {
    pub os:               String,
    pub existing_install: bool,
    pub docker_installed: bool,
    pub disk_free_gb:     f64,
    pub ram_gb:           f64,
    pub ports_free:       bool,
    pub blockers:         Vec<String>,
    pub warnings:         Vec<String>,
}

// ── Commands ──────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn run_precheck() -> Result<PrecheckResult, String> {
    diagnostics::run().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn start_install(
    mode:    String,
    app:     AppHandle,
    state:   State<'_, InstallerState>,
) -> Result<(), String> {
    *state.cancel.lock().unwrap() = false;

    match mode.as_str() {
        "install"   => install::run(&app, &state).await,
        "reinstall" => {
            uninstall::run_partial(&app, &state).await?;
            install::run(&app, &state).await
        }
        "repair"    => repair::run(&app, &state).await,
        "uninstall" => uninstall::run_full(&app, &state).await,
        _           => Err(format!("Unknown mode: {mode}")),
    }
}

#[tauri::command]
pub fn cancel_install(state: State<'_, InstallerState>) {
    *state.cancel.lock().unwrap() = true;
}

#[tauri::command]
pub fn get_install_steps(state: State<'_, InstallerState>) -> Vec<Step> {
    state.steps.lock().unwrap().clone()
}

#[tauri::command]
pub fn get_logs(state: State<'_, InstallerState>) -> Vec<String> {
    state.logs.lock().unwrap().clone()
}

#[tauri::command]
pub async fn open_url(url: String) -> Result<(), String> {
    open::that(&url).map_err(|e| e.to_string())
}
