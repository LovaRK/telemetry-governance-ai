use tauri::AppHandle;
use crate::commands::InstallerState;

pub async fn run(app: &AppHandle, state: &InstallerState) -> Result<(), String> {
    // Repair: restart containers, re-run migrations, verify health
    // Delegates to install.sh --mode repair / install.ps1 -Mode repair
    let _ = app;
    let mut steps = state.steps.lock().unwrap();
    *steps = vec![
        mk("containers", "Restart containers"),
        mk("db",         "Database check"),
        mk("migrate",    "Re-apply migrations"),
        mk("verify",     "Verify dashboard"),
    ];
    drop(steps);

    // TODO: run script with --mode repair flag (same pattern as install.rs)
    Ok(())
}

fn mk(id: &str, label: &str) -> crate::commands::Step {
    crate::commands::Step { id: id.to_string(), label: label.to_string(), status: "pending".to_string(), detail: None }
}
