use serde_json::{json, Value};
use std::sync::Mutex;
use tauri::{AppHandle, Manager};
use tauri_plugin_updater::{Update, UpdaterExt};

#[derive(Default)]
pub struct Prepared(Mutex<Option<(Update, Vec<u8>)>>);

pub async fn call(app: &AppHandle, method: &str, args: &[Value]) -> Result<Value, String> {
    if option_env!("PIG_INSTALLER_VERSION").is_none() {
        return Err("Not an installer build".into());
    }
    let prepared = app.state::<Prepared>();
    if method == "updateInstall" {
        let (update, bytes) = prepared
            .0
            .lock()
            .unwrap()
            .take()
            .ok_or("No verified update")?;
        update.install(bytes).map_err(|e| e.to_string())?;
        return Ok(Value::Null);
    }
    let feed = match args.first().and_then(Value::as_bool) {
        Some(true) => "inclusive",
        Some(false) => "stable",
        None => return Err("Missing update preference".into()),
    };
    let url =
        format!("https://github.com/cotrin8672/pig/releases/download/tauri-updates/{feed}.json");
    let handle = app.clone();
    let update = app
        .updater_builder()
        .on_before_exit(move || {
            let bridge = handle.state::<crate::Bridge>();
            bridge
                .exiting
                .store(true, std::sync::atomic::Ordering::Release);
            bridge.stop();
            handle.cleanup_before_exit();
        })
        .endpoints(vec![url.parse().unwrap()])
        .and_then(|builder| builder.build())
        .map_err(|e| e.to_string())?
        .check()
        .await
        .map_err(|e| e.to_string())?;
    if method == "updateCheck" {
        return Ok(json!(update.map(|u| u.version)));
    }
    let update = update
        .filter(|u| Some(u.version.as_str()) == args.get(1).and_then(Value::as_str))
        .ok_or("Update changed; check again")?;
    let bytes = update
        .download(|_, _| {}, || {})
        .await
        .map_err(|e| e.to_string())?;
    *prepared.0.lock().unwrap() = Some((update, bytes));
    Ok(Value::Null)
}
