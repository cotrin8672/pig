#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod bridge;
mod input_queue;
mod native;
mod widget;

use bridge::Bridge;
use input_queue::InputKind;
use serde_json::{json, Value};
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{
    webview::NewWindowResponse, AppHandle, Manager, RunEvent, WebviewUrl, WebviewWindow,
    WebviewWindowBuilder, WindowEvent,
};

pub fn flags(window: &WebviewWindow) -> Value {
    json!({
        "handle": window.hwnd().map(|hwnd| hwnd.0 as usize).unwrap_or_default(),
        "maximized": window.is_maximized().unwrap_or(false),
        "minimized": window.is_minimized().unwrap_or(false),
        "focused": window.is_focused().unwrap_or(false),
    })
}

pub fn create_window(app: &AppHandle, label: &str, offset: f64) -> tauri::Result<()> {
    let window = WebviewWindowBuilder::new(app, label, WebviewUrl::App("index.html".into()))
        .title("pig")
        .inner_size(1280.0, 840.0)
        .min_inner_size(560.0, 420.0)
        .position(100.0 + offset, 80.0 + offset)
        .decorations(false)
        .transparent(true)
        // Let the existing DOM File input receive file drags.
        .disable_drag_drop_handler()
        .on_navigation(|url| {
            matches!(url.scheme(), "http" | "https")
                && url.host_str() == Some("tauri.localhost")
                && url.port().is_none()
        })
        .on_new_window(|_, _| NewWindowResponse::Deny)
        .build()?;
    widget::restrict_frames(&window)?;
    let label = label.to_owned();
    let app = app.clone();
    let observed = window.clone();
    window.on_window_event(move |event| {
        let bridge = app.state::<Bridge>();
        let event = match event {
            WindowEvent::CloseRequested { api, .. } => {
                api.prevent_close();
                "closeRequested"
            }
            WindowEvent::Destroyed => {
                bridge.reset(&label);
                bridge.control(InputKind::Control, json!(["windowEvent", label, "close"]));
                return;
            }
            WindowEvent::Focused(true) => "focus",
            WindowEvent::Focused(false) => "blur",
            WindowEvent::Resized(_) | WindowEvent::ScaleFactorChanged { .. } => "resize",
            _ => return,
        };
        let kind = match event {
            "resize" => InputKind::Resize(label.clone()),
            "closeRequested" => InputKind::Close(label.clone()),
            _ => InputKind::Control,
        };
        bridge.control(kind, json!(["windowEvent", label, event, flags(&observed)]));
    });
    Ok(())
}

#[tauri::command]
fn preview_ipc_ping(probe: tauri::State<'_, Probe>, frame: bool) {
    if frame {
        probe.frame_ipc.store(true, Ordering::Release);
    }
}
#[derive(Default)]
struct Probe {
    frame_ipc: AtomicBool,
    blocked_navigation: AtomicBool,
}

fn smoke() -> bool {
    cfg!(debug_assertions) && std::env::var("PIG_TAURI_SMOKE").as_deref() == Ok("1")
}

#[tauri::command]
fn pig_smoke_done(window: WebviewWindow, failure: Option<String>) {
    if smoke() {
        let app = window.app_handle();
        let failure = failure.or_else(|| {
            let probe = app.state::<Probe>();
            if probe.frame_ipc.load(Ordering::Acquire) {
                Some("Sandbox command reached Rust".to_string())
            } else if !probe.blocked_navigation.load(Ordering::Acquire) {
                Some("Widget navigation guard did not run".to_string())
            } else {
                None
            }
        });
        if let Some(error) = &failure {
            eprintln!("pig-tauri-smoke: {error}");
            app.state::<Bridge>().exiting.store(true, Ordering::Release);
            app.exit(1);
        } else {
            println!("pig-tauri-smoke: pass");
            // Pass through the same draft-flush and shutdown path as Alt+F4.
            let _ = window.close();
        }
    }
}

fn main() {
    let builder = tauri::Builder::default();
    let builder = if smoke() {
        builder
    } else {
        builder.plugin(tauri_plugin_single_instance::init(|app, _, _| {
            if let Some(bridge) = app.try_state::<Bridge>() {
                bridge.control(InputKind::Control, json!(["open-more"]));
            }
        }))
    };
    builder
        .manage(Probe::default())
        .register_uri_scheme_protocol("pig-widget", |_, request| widget::serve(request))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .setup(|app| Bridge::start(app.handle()))
        .invoke_handler(tauri::generate_handler![
            bridge::pig_connect,
            bridge::pig_packet,
            preview_ipc_ping,
            pig_smoke_done,
        ])
        .build(tauri::generate_context!())
        .expect("initialize pig Tauri app")
        .run(|app, event| match event {
            RunEvent::ExitRequested { api, .. } => {
                if let Some(bridge) = app.try_state::<Bridge>() {
                    if !bridge.exiting.load(Ordering::Acquire) {
                        if bridge
                            .enqueue(InputKind::Quit, json!(["beforeQuit"]))
                            .is_ok()
                        {
                            api.prevent_exit();
                        }
                    }
                }
            }
            RunEvent::Exit => {
                if let Some(bridge) = app.try_state::<Bridge>() {
                    bridge.exiting.store(true, Ordering::Release);
                    bridge.stop();
                }
            }
            _ => {}
        });
}
