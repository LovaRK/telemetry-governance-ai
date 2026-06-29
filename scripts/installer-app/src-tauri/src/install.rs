/**
 * Fresh install sequence — mirrors install.sh / install.ps1 logic in Rust.
 * Each step emits progress to the UI via the shared InstallerState.
 *
 * Steps match the 15-step sequence in the shell scripts:
 *   precheck → deps → docker → repo → config → model → stack →
 *   db → migrate → seed → login-verify → web-verify → credentials → browser → done
 */
use tauri::AppHandle;
use crate::commands::InstallerState;

const STEPS: &[(&str, &str)] = &[
    ("precheck",    "System check"),
    ("deps",        "Install dependencies"),
    ("docker",      "Start Docker"),
    ("repo",        "Download datasensAI"),
    ("config",      "Generate configuration"),
    ("model",       "Download AI model (~5 GB)"),
    ("stack",       "Start services"),
    ("db",          "Database ready"),
    ("migrate",     "Apply migrations"),
    ("seed",        "Create admin account"),
    ("verify",      "Verify dashboard"),
    ("credentials", "Save credentials"),
    ("browser",     "Open dashboard"),
];

pub async fn run(app: &AppHandle, state: &InstallerState) -> Result<(), String> {
    init_steps(state);

    // The installer delegates to the existing shell script so there is a single
    // source of truth. On Mac it runs install.sh; on Windows it runs install.ps1
    // via PowerShell. Log output is captured line-by-line and emitted to the UI.
    let script = get_installer_script()?;
    run_script(app, state, &script).await
}

fn init_steps(state: &InstallerState) {
    let mut steps = state.steps.lock().unwrap();
    *steps = STEPS.iter().map(|(id, label)| crate::commands::Step {
        id:     id.to_string(),
        label:  label.to_string(),
        status: "pending".to_string(),
        detail: None,
    }).collect();
}

fn get_installer_script() -> Result<std::path::PathBuf, String> {
    // The Tauri app bundles the installer scripts in its resources directory
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let resources = exe.parent().ok_or("no parent dir")?.join("resources");

    #[cfg(target_os = "windows")]
    let script = resources.join("install.ps1");
    #[cfg(not(target_os = "windows"))]
    let script = resources.join("install.sh");

    if !script.exists() {
        return Err(format!("Installer script not found at {}", script.display()));
    }
    Ok(script)
}

async fn run_script(app: &AppHandle, state: &InstallerState, script: &std::path::Path) -> Result<(), String> {
    use std::process::{Command, Stdio};
    use std::io::{BufRead, BufReader};

    #[cfg(target_os = "windows")]
    let mut cmd = {
        let mut c = Command::new("powershell");
        c.args(["-ExecutionPolicy", "Bypass", "-File", script.to_str().unwrap(), "-Mode", "install"]);
        c
    };
    #[cfg(not(target_os = "windows"))]
    let mut cmd = {
        let mut c = Command::new("bash");
        c.args([script.to_str().unwrap(), "--mode", "install"]);
        c
    };

    cmd.stdout(Stdio::piped()).stderr(Stdio::piped());
    let mut child = cmd.spawn().map_err(|e| e.to_string())?;

    if let Some(stdout) = child.stdout.take() {
        let reader = BufReader::new(stdout);
        for line in reader.lines() {
            if *state.cancel.lock().unwrap() {
                let _ = child.kill();
                return Err("Installation cancelled by user.".to_string());
            }
            if let Ok(line) = line {
                // Parse [N/15] markers to update step progress
                parse_and_update_step(&line, state);
                // Emit to UI
                state.logs.lock().unwrap().push(line.clone());
                let _ = app.emit("log-line", line);
            }
        }
    }

    let status = child.wait().map_err(|e| e.to_string())?;
    if !status.success() {
        return Err(format!("Installer exited with code {:?}", status.code()));
    }

    // Mark all remaining steps complete
    for step in state.steps.lock().unwrap().iter_mut() {
        if step.status == "pending" || step.status == "running" {
            step.status = "ok".to_string();
        }
    }

    let _ = app.emit("install-done", "http://localhost:3002");
    Ok(())
}

fn parse_and_update_step(line: &str, state: &InstallerState) {
    // Match "[N/15] Step label" pattern from the shell scripts
    if let Some(rest) = line.strip_prefix('[') {
        if let Some(slash_pos) = rest.find('/') {
            if let Ok(n) = rest[..slash_pos].parse::<usize>() {
                let mut steps = state.steps.lock().unwrap();
                // Mark previous step done
                if n > 1 {
                    if let Some(prev) = steps.get_mut(n - 2) {
                        if prev.status == "running" { prev.status = "ok".to_string(); }
                    }
                }
                // Mark current step running
                if let Some(curr) = steps.get_mut(n - 1) {
                    curr.status = "running".to_string();
                }
            }
        }
    }
    // [OK] line → mark current running step ok
    if line.contains("[OK]") {
        let mut steps = state.steps.lock().unwrap();
        if let Some(step) = steps.iter_mut().find(|s| s.status == "running") {
            step.status = "ok".to_string();
        }
    }
    // [!] line → warn current running step
    if line.starts_with("[!]") {
        let mut steps = state.steps.lock().unwrap();
        if let Some(step) = steps.iter_mut().find(|s| s.status == "running") {
            step.status = "warn".to_string();
            step.detail = Some(line.trim_start_matches("[!]").trim().to_string());
        }
    }
}
