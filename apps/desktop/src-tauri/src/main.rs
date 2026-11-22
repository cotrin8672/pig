use std::{
    path::Path,
    process::Command,
    sync::atomic::{AtomicBool, Ordering},
    thread::sleep,
    time::Duration,
};

use tauri::{AppHandle, Manager, State, WebviewWindow};

#[derive(Default)]
struct IpcProbe(AtomicBool);

#[tauri::command]
fn preview_ipc_ping(probe: State<'_, IpcProbe>, frame: bool) {
    if frame {
        probe.0.store(true, Ordering::Relaxed);
    }
}

#[tauri::command]
async fn preview_host(app: AppHandle) -> Result<serde_json::Value, String> {
    let profile = app
        .path()
        .app_local_data_dir()
        .map_err(|error| error.to_string())?;
    tauri::async_runtime::spawn_blocking(move || {
        let bun = std::env::var_os("PIG_TAURI_BUN").ok_or("Launch with pnpm tauri:preview")?;
        let desktop = Path::new(env!("CARGO_MANIFEST_DIR")).join("..");
        let mut child = Command::new(bun);
        child
            .current_dir(&desktop)
            .args(["--no-env-file", "src/bun/tauri-preview.ts"])
            .env("PI_CODING_AGENT_DIR", profile.join("pi-agent"))
            .env("PI_CODING_AGENT_SESSION_DIR", profile.join("sessions"))
            .env("PI_OFFLINE", "1");
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            child.creation_flags(0x08000000); // CREATE_NO_WINDOW
        }
        let output = child.output().map_err(|error| error.to_string())?;
        if !output.status.success() {
            eprintln!("{}", String::from_utf8_lossy(&output.stderr));
            return Err(format!("Bun preview host failed ({})", output.status));
        }
        serde_json::from_slice(&output.stdout).map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn preview_report(
    window: WebviewWindow,
    probe: State<'_, IpcProbe>,
    failure: Option<String>,
) -> Result<(), String> {
    if std::env::var("PIG_TAURI_SMOKE").as_deref() == Ok("1") {
        if let Some(failure) = &failure {
            eprintln!("Tauri preview smoke: {failure}");
        }
        let app = window.app_handle().clone();
        let passed = failure.is_none()
            && tauri::async_runtime::spawn_blocking(move || match check_window_states(&window) {
                Ok(()) => true,
                Err(error) => {
                    eprintln!("Tauri window state smoke: {error}");
                    false
                }
            })
            .await
            .unwrap_or(false);
        // A missing JS reply does not prove denial: verify the handler did not run.
        let reached = probe.0.load(Ordering::Relaxed);
        if reached {
            eprintln!("Tauri preview smoke: iframe invoked a native command");
        }
        let passed = passed && !reached;
        println!("pig-tauri-smoke: {}", if passed { "pass" } else { "FAIL" });
        app.exit(if passed { 0 } else { 1 });
    }
    Ok(())
}

fn check_window_states(window: &WebviewWindow) -> Result<(), String> {
    fn wait_for(state: impl Fn() -> tauri::Result<bool>, expected: bool) -> Result<(), String> {
        for _ in 0..50 {
            if state().map_err(|error| error.to_string())? == expected {
                return Ok(());
            }
            sleep(Duration::from_millis(20));
        }
        Err(format!("window state did not become {expected}"))
    }
    let run = |result: tauri::Result<()>| result.map_err(|error| error.to_string());
    run(window.maximize())?;
    wait_for(|| window.is_maximized(), true)?;
    run(window.unmaximize())?;
    wait_for(|| window.is_maximized(), false)?;
    run(window.minimize())?;
    wait_for(|| window.is_minimized(), true)?;
    run(window.unminimize())?;
    wait_for(|| window.is_minimized(), false)
}

fn main() {
    tauri::Builder::default()
        .manage(IpcProbe::default())
        .invoke_handler(tauri::generate_handler![
            preview_host,
            preview_ipc_ping,
            preview_report
        ])
        .run(tauri::generate_context!())
        .expect("run pig Tauri preview");
}
