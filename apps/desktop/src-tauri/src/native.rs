use serde::Deserialize;
use serde_json::{json, Value};
use tauri::{
    window::{Effect, EffectsBuilder},
    AppHandle, Manager, WebviewWindow,
};
use tauri_plugin_dialog::{
    DialogExt, MessageDialogButtons, MessageDialogKind, MessageDialogResult,
};
pub(super) fn focused(app: &AppHandle) -> Option<WebviewWindow> {
    let windows = app.webview_windows();
    windows
        .values()
        .find(|window| window.is_focused().unwrap_or(false))
        .or_else(|| windows.values().next())
        .cloned()
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Warning {
    title: String,
    message: String,
    buttons: Vec<String>,
    cancel_id: usize,
}

pub fn call(app: &AppHandle, method: &str, args: &[Value]) -> Result<Value, String> {
    let string = |index: usize| {
        args.get(index)
            .and_then(Value::as_str)
            .ok_or("Missing native argument")
    };
    let failure = |error: tauri::Error| error.to_string();
    let window = || -> Result<WebviewWindow, String> {
        app.get_webview_window(string(0)?)
            .ok_or("Window is closed.".into())
    };
    match method {
        "updateCheck" | "updatePrepare" | "updateInstall" => {
            return tauri::async_runtime::block_on(crate::updates::call(app, method, args));
        }
        "minimize" => window()?.minimize().map_err(failure)?,
        "toggleMaximize" => {
            let window = window()?;
            if window.is_maximized().map_err(failure)? {
                window.unmaximize().map_err(failure)?;
            } else {
                window.maximize().map_err(failure)?;
            }
        }
        "close" => window()?.destroy().map_err(failure)?,
        "backdrop" => {
            let window = window()?;
            let effects = match string(1)? {
                "acrylic" => Some(EffectsBuilder::new().effect(Effect::Acrylic).build()),
                "mica" => Some(EffectsBuilder::new().effect(Effect::Mica).build()),
                "none" => None,
                _ => return Err("Invalid backdrop.".into()),
            };
            window.set_effects(effects).map_err(failure)?;
        }
        "pick" => {
            let mut picker = app.dialog().file();
            if let Some(parent) = focused(app) {
                picker = picker.set_parent(&parent);
            }
            let selected = match string(0)? {
                "folder" => picker.blocking_pick_folder(),
                "json" => picker.add_filter("JSON", &["json"]).blocking_pick_file(),
                _ => return Err("Invalid picker kind.".into()),
            };
            return Ok(json!(selected.and_then(|file| file.into_path().ok())));
        }
        "dialog" => {
            let input: Warning = serde_json::from_value(args.first().cloned().unwrap_or_default())
                .map_err(|e| e.to_string())?;
            // The safe default is always Cancel, including Escape/close.
            if let [cancel, confirm] = input.buttons.as_slice() {
                let result = app
                    .dialog()
                    .message(input.message)
                    .title(input.title)
                    .buttons(MessageDialogButtons::OkCancelCustom(
                        confirm.clone(),
                        cancel.clone(),
                    ))
                    .blocking_show_with_result();
                return Ok(json!(usize::from(
                    matches!(result, MessageDialogResult::Custom(label) if label == *confirm)
                )));
            }
            let [retry, cancel, discard]: [String; 3] =
                input.buttons.try_into().map_err(|_| "Invalid buttons")?;
            let value = app
                .dialog()
                .message(input.message)
                .title(input.title)
                .kind(MessageDialogKind::Warning)
                .buttons(MessageDialogButtons::YesNoCancelCustom(
                    retry.clone(),
                    discard.clone(),
                    cancel,
                ))
                .blocking_show_with_result();
            return Ok(json!(match value {
                MessageDialogResult::Custom(label) if label == retry => 0,
                MessageDialogResult::Custom(label) if label == discard => 2,
                _ => input.cancel_id,
            }));
        }
        "menu" => {
            let items: Vec<MenuItem> =
                serde_json::from_value(args.first().cloned().unwrap_or_default())
                    .map_err(|error| error.to_string())?;
            if items.is_empty() || items.len() > 32 {
                return Err("Invalid menu.".into());
            }
            let owner = focused(app)
                .ok_or("No window for context menu.")?
                .hwnd()
                .map_err(failure)?
                .0 as isize;
            let (send, receive) = std::sync::mpsc::sync_channel(1);
            app.run_on_main_thread(move || {
                let _ = send.send(popup(owner, &items));
            })
            .map_err(failure)?;
            return receive
                .recv()
                .map_err(|error| error.to_string())?
                .map(|action| json!(action));
        }
        "notify" => crate::notifications::show(app, string(0)?)?,
        "clipboardRead" => {
            let mut clipboard = arboard::Clipboard::new().map_err(|error| error.to_string())?;
            return match clipboard.get_text() {
                Ok(text) => Ok(json!(text)),
                Err(arboard::Error::ContentNotAvailable) => Ok(Value::Null),
                Err(error) => Err(error.to_string()),
            };
        }
        "clipboardWrite" => {
            arboard::Clipboard::new()
                .and_then(|mut clipboard| clipboard.set_text(string(0).unwrap_or_default()))
                .map_err(|error| error.to_string())?;
        }
        _ => return Err("Unknown native operation.".into()),
    }
    Ok(Value::Null)
}

#[derive(Deserialize)]
struct MenuItem {
    #[serde(rename = "type")]
    kind: Option<String>,
    action: Option<String>,
    label: Option<String>,
    accelerator: Option<String>,
    enabled: Option<bool>,
}

#[repr(C)]
struct Point {
    x: i32,
    y: i32,
}

#[link(name = "user32")]
extern "system" {
    fn CreatePopupMenu() -> isize;
    fn DestroyMenu(menu: isize) -> i32;
    fn AppendMenuW(menu: isize, flags: u32, id: usize, label: *const u16) -> i32;
    fn GetCursorPos(point: *mut Point) -> i32;
    fn TrackPopupMenuEx(
        menu: isize,
        flags: u32,
        x: i32,
        y: i32,
        window: isize,
        params: *const (),
    ) -> i32;
}

fn popup(owner: isize, items: &[MenuItem]) -> Result<Option<String>, String> {
    let menu = unsafe { CreatePopupMenu() };
    if menu == 0 {
        return Err("Could not create the context menu.".into());
    }
    struct Menu(isize);
    impl Drop for Menu {
        fn drop(&mut self) {
            unsafe {
                DestroyMenu(self.0);
            }
        }
    }
    let menu = Menu(menu);
    for (index, item) in items.iter().enumerate() {
        let divider = item.kind.as_deref() == Some("divider");
        let flags = if divider {
            0x0800
        } else if item.enabled == Some(false) {
            0x0001
        } else {
            0
        };
        let label = item.label.as_deref().unwrap_or("").replace('&', "&&");
        let label = match &item.accelerator {
            Some(shortcut) => format!("{label}\t{shortcut}"),
            None => label,
        };
        let label: Vec<u16> = label.encode_utf16().chain([0]).collect();
        if unsafe { AppendMenuW(menu.0, flags, index + 1, label.as_ptr()) } == 0 {
            return Err("Could not build the context menu.".into());
        }
    }
    let mut point = Point { x: 0, y: 0 };
    if unsafe { GetCursorPos(&mut point) } == 0 {
        return Err("Could not locate the cursor.".into());
    }
    // TPM_RETURNCMD | TPM_RIGHTBUTTON, so results never look like another window's event.
    let choice =
        unsafe { TrackPopupMenuEx(menu.0, 0x0102, point.x, point.y, owner, std::ptr::null()) };
    Ok(items
        .get(choice.wrapping_sub(1) as usize)
        .and_then(|item| item.action.clone()))
}
