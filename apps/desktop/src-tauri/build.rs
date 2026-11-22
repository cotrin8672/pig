fn main() {
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "preview_host",
            "preview_ipc_ping",
            "preview_report",
        ]),
    ))
    .expect("build Tauri preview assets and permissions");
}
