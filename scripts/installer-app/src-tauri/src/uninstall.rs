use tauri::AppHandle;
use crate::commands::InstallerState;

/// Partial uninstall — stops containers and removes the datasensai folder.
/// Used before reinstall. Does NOT remove Docker or Ollama.
pub async fn run_partial(app: &AppHandle, state: &InstallerState) -> Result<(), String> {
    let _ = app;
    let mut steps = state.steps.lock().unwrap();
    *steps = vec![
        mk("containers", "Stop containers"),
        mk("folder",     "Remove datasensai folder"),
    ];
    drop(steps);

    // TODO: run docker rm -f + rm -rf $HOME/datasensai (same approach as install.rs)
    Ok(())
}

/// Full uninstall — removes datasensAI, Docker Desktop, and Ollama.
pub async fn run_full(app: &AppHandle, state: &InstallerState) -> Result<(), String> {
    let _ = app;
    let mut steps = state.steps.lock().unwrap();
    *steps = vec![
        mk("containers", "Stop and remove containers"),
        mk("folder",     "Remove datasensai folder"),
        mk("docker",     "Uninstall Docker Desktop"),
        mk("ollama",     "Uninstall Ollama and model cache"),
        mk("verify",     "Verify clean state"),
    ];
    drop(steps);

    // TODO: delegate to tools/uninstall_datasensAI_windows.ps1 or tools/uninstall_datasensAI_mac.sh
    Ok(())
}

fn mk(id: &str, label: &str) -> crate::commands::Step {
    crate::commands::Step { id: id.to_string(), label: label.to_string(), status: "pending".to_string(), detail: None }
}
