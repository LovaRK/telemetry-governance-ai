// Prevents a console window from opening on Windows in release builds
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod install;
mod repair;
mod uninstall;
mod diagnostics;

use tauri::Manager;

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            commands::run_precheck,
            commands::start_install,
            commands::cancel_install,
            commands::get_install_steps,
            commands::get_logs,
            commands::open_url,
        ])
        .setup(|app| {
            // On macOS/Windows: check if running as admin/root (needed for Docker install)
            #[cfg(target_os = "windows")]
            {
                if !diagnostics::is_elevated() {
                    // Re-launch self with elevation request
                    let exe = std::env::current_exe()?;
                    runas::Command::new(exe).status()?;
                    app.handle().exit(0);
                }
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running datasensAI installer");
}
