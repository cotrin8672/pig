use std::ffi::c_void;
use tauri::AppHandle;
use windows::{
    core::{h, implement, IUnknown, Interface, Ref, Result, BOOL, GUID, HSTRING, PCWSTR},
    Data::Xml::Dom::XmlDocument,
    Win32::{
        Foundation::CLASS_E_NOAGGREGATION,
        System::Com::{
            CoRegisterClassObject, IClassFactory, IClassFactory_Impl, CLSCTX_LOCAL_SERVER,
            REGCLS_MULTIPLEUSE,
        },
        UI::Notifications::{
            INotificationActivationCallback, INotificationActivationCallback_Impl,
            NOTIFICATION_USER_INPUT_DATA,
        },
    },
    UI::Notifications::{ToastNotification, ToastNotificationManager},
};

// Dev registration must not redirect clicks on notifications from an installed build.
#[cfg(debug_assertions)]
const IDENTITY: (&str, &str, GUID) = (
    "dev.pig.tauri.debug",
    "pig (dev)",
    GUID::from_u128(0x6ed05d8c_0027_47ec_a705_69e1d4a48224),
);
#[cfg(not(debug_assertions))]
const IDENTITY: (&str, &str, GUID) = (
    "dev.pig.tauri",
    "pig",
    GUID::from_u128(0x13b603cb_9960_4153_b420_3e5babbb4b37),
);

pub fn register(app: &AppHandle) -> std::result::Result<(), Box<dyn std::error::Error>> {
    let (id, name, clsid) = IDENTITY;
    let executable = std::env::current_exe()?;
    let executable = executable.to_str().ok_or("Invalid executable path")?;
    let clsid_key = format!("{{{clsid:?}}}");
    let classes = windows_registry::CURRENT_USER.create(r"Software\Classes")?;
    classes
        .create(format!(r"CLSID\{clsid_key}\LocalServer32"))?
        .set_string("", format!("\"{executable}\""))?;
    let identity = classes.create(format!(r"AppUserModelId\{id}"))?;
    identity.set_string("DisplayName", name)?;
    identity.set_string("CustomActivator", clsid_key)?;

    // The window has already initialized the UI thread's COM apartment.
    let factory: IClassFactory = Factory(app.clone()).into();
    unsafe { CoRegisterClassObject(&clsid, &factory, CLSCTX_LOCAL_SERVER, REGCLS_MULTIPLEUSE)? };
    Ok(())
}

pub fn show(app: &AppHandle, body: &str) -> std::result::Result<(), String> {
    let (send, receive) = std::sync::mpsc::sync_channel(1);
    let body = body.to_owned();
    app.run_on_main_thread(move || {
        let result = (|| {
            let toast = ToastNotification::CreateToastNotification(&toast_xml(&body)?)?;
            ToastNotificationManager::CreateToastNotifierWithId(&HSTRING::from(IDENTITY.0))?
                .Show(&toast)
        })();
        let _ = send.send(result);
    })
    .map_err(|error| error.to_string())?;
    receive
        .recv()
        .map_err(|error| error.to_string())?
        .map_err(|error| error.to_string())
}

fn toast_xml(body: &str) -> Result<XmlDocument> {
    let xml = XmlDocument::new()?;
    xml.LoadXml(h!(r#"<toast><visual><binding template="ToastGeneric"><text>pig</text><text/></binding></visual></toast>"#))?;
    xml.GetElementsByTagName(h!("text"))?
        .Item(1)?
        .SetInnerText(&HSTRING::from(body))?;
    Ok(xml)
}

#[implement(IClassFactory)]
struct Factory(AppHandle);

impl IClassFactory_Impl for Factory_Impl {
    fn CreateInstance(
        &self,
        outer: Ref<IUnknown>,
        iid: *const GUID,
        out: *mut *mut c_void,
    ) -> Result<()> {
        if !outer.is_null() {
            return Err(CLASS_E_NOAGGREGATION.into());
        }
        let activation: INotificationActivationCallback = Activation(self.0.clone()).into();
        unsafe { activation.query(iid, out).ok() }
    }

    fn LockServer(&self, _: BOOL) -> Result<()> {
        Ok(())
    }
}

// A COM activator handles both the popup and Windows notification history.
#[implement(INotificationActivationCallback)]
struct Activation(AppHandle);

impl INotificationActivationCallback_Impl for Activation_Impl {
    fn Activate(
        &self,
        _: &PCWSTR,
        _: &PCWSTR,
        _: *const NOTIFICATION_USER_INPUT_DATA,
        _: u32,
    ) -> Result<()> {
        let app = self.0.clone();
        self.0
            .run_on_main_thread(move || {
                let raise = || -> tauri::Result<()> {
                    if let Some(window) = crate::native::focused(&app) {
                        window.show()?;
                        if window.is_minimized()? {
                            window.unminimize()?;
                        }
                        window.set_focus()?;
                    }
                    Ok(())
                };
                if let Err(error) = raise() {
                    eprintln!("Could not focus the pig window: {error}");
                }
            })
            .map_err(|error| {
                windows::core::Error::new(windows::Win32::Foundation::E_FAIL, error.to_string())
            })
    }
}

#[cfg(debug_assertions)]
pub fn check_activation(
    app: &AppHandle,
    window: &tauri::WebviewWindow,
) -> std::result::Result<(), String> {
    let factory: IClassFactory = Factory(app.clone()).into();
    let activation: INotificationActivationCallback =
        unsafe { factory.CreateInstance(None::<&IUnknown>) }.map_err(|error| error.to_string())?;
    window.minimize().map_err(|error| error.to_string())?;
    unsafe { activation.Activate(PCWSTR::null(), PCWSTR::null(), &[]) }
        .map_err(|error| error.to_string())?;
    if window.is_minimized().map_err(|error| error.to_string())? {
        return Err("Notification activation left the window minimized".into());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    #[test]
    fn notification_body_stays_plain_text() {
        let body = "日本語 <tag> & text";
        let xml = super::toast_xml(body).unwrap();
        assert_eq!(
            xml.GetElementsByTagName(windows::core::h!("text"))
                .unwrap()
                .Item(1)
                .unwrap()
                .InnerText()
                .unwrap(),
            body
        );
    }
}
