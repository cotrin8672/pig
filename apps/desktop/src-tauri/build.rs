fn main() {
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "pig_connect",
            "pig_packet",
            "preview_ipc_ping",
            "pig_smoke_done",
        ]),
    ))
    .expect("build Tauri preview assets and permissions");
}
