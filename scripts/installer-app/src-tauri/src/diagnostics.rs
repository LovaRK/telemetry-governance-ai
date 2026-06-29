use crate::commands::PrecheckResult;

pub fn run() -> Result<PrecheckResult, Box<dyn std::error::Error>> {
    let os = detect_os();
    let existing_install = check_existing_install();
    let docker_installed = check_docker_installed();
    let disk_free_gb     = check_disk_free_gb()?;
    let ram_gb           = check_ram_gb();
    let ports_free       = check_ports_free(&[3002, 5433, 11434]);

    let mut blockers = vec![];
    let mut warnings = vec![];

    if disk_free_gb < 15.0 {
        blockers.push(format!("Only {:.1} GB disk free — 20 GB required.", disk_free_gb));
    }
    if ram_gb < 6.0 {
        warnings.push(format!("Low RAM: {:.0} GB detected. 8 GB recommended.", ram_gb));
    }
    if !ports_free {
        warnings.push("Some ports (3002/5433/11434) are in use — the installer will stop conflicting processes.".to_string());
    }

    Ok(PrecheckResult { os, existing_install, docker_installed, disk_free_gb, ram_gb, ports_free, blockers, warnings })
}

fn detect_os() -> String {
    #[cfg(target_os = "windows")] { "windows".to_string() }
    #[cfg(target_os = "macos")]   { "mac".to_string() }
    #[cfg(not(any(target_os = "windows", target_os = "macos")))] { "linux".to_string() }
}

fn check_existing_install() -> bool {
    let home = std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .unwrap_or_default();
    std::path::Path::new(&home).join("datasensai").join(".git").exists()
}

fn check_docker_installed() -> bool {
    std::process::Command::new("docker").arg("--version")
        .output().map(|o| o.status.success()).unwrap_or(false)
}

fn check_disk_free_gb() -> Result<f64, Box<dyn std::error::Error>> {
    // Cross-platform: use df on mac, check C: on windows
    #[cfg(target_os = "windows")] {
        let out = std::process::Command::new("powershell")
            .args(["-Command", "(Get-PSDrive C).Free / 1GB"])
            .output()?;
        let s = String::from_utf8_lossy(&out.stdout);
        Ok(s.trim().parse::<f64>().unwrap_or(0.0))
    }
    #[cfg(not(target_os = "windows"))] {
        let out = std::process::Command::new("df")
            .args(["-k", "/"])
            .output()?;
        let lines: Vec<_> = String::from_utf8_lossy(&out.stdout).lines().collect::<Vec<_>>().into_iter().map(|s| s.to_string()).collect();
        if let Some(data) = lines.get(1) {
            let parts: Vec<_> = data.split_whitespace().collect();
            if let Some(avail) = parts.get(3) {
                if let Ok(kb) = avail.parse::<f64>() {
                    return Ok(kb / 1_048_576.0);
                }
            }
        }
        Ok(0.0)
    }
}

fn check_ram_gb() -> f64 {
    // Simple heuristic — sysinfo crate would be better; this avoids the dependency for the scaffold
    #[cfg(target_os = "windows")] {
        let out = std::process::Command::new("powershell")
            .args(["-Command", "(Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory / 1GB"])
            .output();
        out.ok()
           .and_then(|o| String::from_utf8(o.stdout).ok())
           .and_then(|s| s.trim().parse::<f64>().ok())
           .unwrap_or(8.0)
    }
    #[cfg(not(target_os = "windows"))] { 8.0 }
}

fn check_ports_free(ports: &[u16]) -> bool {
    ports.iter().all(|&port| {
        std::net::TcpListener::bind(("127.0.0.1", port)).is_ok()
    })
}

#[cfg(target_os = "windows")]
pub fn is_elevated() -> bool {
    use std::process::Command;
    Command::new("net").args(["session"]).output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}
