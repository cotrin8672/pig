use tauri::{
    http::{header, Method, Request, Response, StatusCode},
    Manager, WebviewWindow,
};
use webview2_com::{take_pwstr, NavigationStartingEventHandler};

// A separate origin lets the frame run its own scripts without relaxing the
// app's CSP. The response sandbox applies even without the iframe attribute.
const CSP: &str = "sandbox allow-scripts; default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none'; frame-ancestors http://tauri.localhost https://tauri.localhost";

const SHELL: &str = r#"<!doctype html><meta charset="utf-8"><script>
(() => {
  if (window === parent) return;
  try { void parent.document; return; } catch {}
  const load = (event) => {
    if (event.source !== parent ||
        !["http://tauri.localhost", "https://tauri.localhost"].includes(event.origin) ||
        event.data?.type !== "pig:widget-document" ||
        typeof event.data.html !== "string") return;
    removeEventListener("message", load);
    // The response CSP and opaque sandbox origin survive document.open().
    document.open();
    document.write(event.data.html);
    document.close();
  };
  addEventListener("message", load);
  parent.postMessage({ type: "pig:widget-ready" }, "*");
})();
</script>"#;

pub fn serve(request: Request<Vec<u8>>) -> Response<&'static [u8]> {
    let allowed = request.method() == Method::GET && request.uri().path_and_query()
        .is_some_and(|path| path.as_str() == "/frame");
    Response::builder()
        .status(if allowed { StatusCode::OK } else { StatusCode::NOT_FOUND })
        .header(header::CONTENT_TYPE, "text/html; charset=utf-8")
        .header(header::CONTENT_SECURITY_POLICY, CSP)
        .header(header::REFERRER_POLICY, "no-referrer")
        .header(header::X_CONTENT_TYPE_OPTIONS, "nosniff")
        .body(if allowed { SHELL.as_bytes() } else { b"" })
        .unwrap()
}

pub fn restrict_frames(window: &WebviewWindow) -> tauri::Result<()> {
    let app = window.app_handle().clone();
    window.with_webview(move |view| {
        let probe_app = crate::smoke().then(|| app.clone());
        let installed = unsafe {
            view.controller().CoreWebView2().and_then(|webview| {
                webview.add_FrameNavigationStarting(
                    &NavigationStartingEventHandler::create(Box::new(move |_, args| {
                        if let Some(args) = args {
                            let mut uri = Default::default();
                            args.Uri(&mut uri)?;
                            let uri = take_pwstr(uri);
                            // Frame CSP alone does not constrain self-navigation.
                            let allowed = matches!(
                                uri.as_str(),
                                "about:blank" | "about:srcdoc" | "http://pig-widget.localhost/frame"
                            );
                            args.SetCancel(!allowed)?;
                            if let Some(app) = &probe_app {
                                if uri == "http://pig-widget.localhost/frame?navigation-test" {
                                    app.state::<crate::Probe>()
                                        .blocked_navigation
                                        .store(true, std::sync::atomic::Ordering::Release);
                                }
                            }
                        }
                        Ok(())
                    })),
                    &mut 0,
                )
            })
        };
        if let Err(error) = installed {
            eprintln!("Cannot isolate HTML widget navigation: {error}");
            app.state::<crate::Bridge>()
                .exiting
                .store(true, std::sync::atomic::Ordering::Release);
            app.exit(1);
        }
    })
}
