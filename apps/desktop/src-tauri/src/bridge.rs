use serde_json::{json, Value};
use std::{
    collections::HashMap,
    io::{self, BufRead, BufReader, BufWriter, Read, Write},
    path::PathBuf,
    process::{Child, Command, Stdio},
    sync::{
        atomic::{AtomicBool, AtomicU32, Ordering},
        mpsc::{sync_channel, SyncSender},
        Mutex,
    },
};
use tauri::{ipc::Channel, AppHandle, Manager, WebviewWindow};

const MAX_FRAME: u64 = 64 * 1024 * 1024;
const HOST_PREFIX: u8 = 0x1e;
type Page = (u32, Channel<Value>);

pub struct Bridge {
    input: SyncSender<Vec<u8>>,
    child: Mutex<Child>,
    pages: Mutex<HashMap<String, Page>>,
    next_page: AtomicU32,
    pub exiting: AtomicBool,
}

impl Bridge {
    pub fn start(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
        let (bun, root, entry) = match std::env::var_os("PIG_TAURI_BUN") {
            Some(path) if cfg!(debug_assertions) => (
                PathBuf::from(path),
                PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(".."),
                "src/bun/tauri-host.ts",
            ),
            _ => {
                let root = app.path().resource_dir()?.join("host");
                (
                    root.join("bin/bun.exe"),
                    root.join("app"),
                    "bun/tauri-host.js",
                )
            }
        };
        let launcher_path = std::env::var_os("PATH").unwrap_or_default();
        let mut path: Vec<_> = std::env::split_paths(&launcher_path).collect();
        let system_root = std::env::var_os("SystemRoot").unwrap_or_else(|| "C:\\Windows".into());
        path.push(PathBuf::from(system_root).join("System32/WindowsPowerShell/v1.0"));
        if let Some(bin) = bun.parent() {
            path.push(bin.to_owned());
        }
        let mut command = Command::new(bun);
        command
            .current_dir(root)
            .args(["--no-env-file", "--no-install", entry])
            // Set the initial process environment: Bun's executable search can
            // use its startup PATH even after JS mutates process.env.
            .env("PATH", std::env::join_paths(path)?)
            .env("PIG_TAURI_VERSION", app.package_info().version.to_string())
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit());
        if std::env::var_os("PIG_DESKTOP_CONFIG_DIR").is_none() {
            command.env(
                "PIG_DESKTOP_CONFIG_DIR",
                app.path().app_config_dir()?.join("pig"),
            );
        }
        if let Ok(dir) = app.path().download_dir() {
            command.env("PIG_TAURI_DOWNLOADS", dir);
        }
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            command.creation_flags(0x08000000); // CREATE_NO_WINDOW
        }
        let mut child = command.spawn()?;
        let stdin = child.stdin.take().ok_or("Missing Bun stdin")?;
        let stdout = child.stdout.take().ok_or("Missing Bun stdout")?;
        let (input, rx) = sync_channel::<Vec<u8>>(128);
        app.manage(Self {
            input,
            child: Mutex::new(child),
            pages: Mutex::new(HashMap::new()),
            next_page: AtomicU32::new(0),
            exiting: AtomicBool::new(false),
        });
        std::thread::spawn(move || {
            let mut writer = BufWriter::new(stdin);
            for frame in rx {
                if let Err(error) = writer.write_all(&frame).and_then(|_| writer.flush()) {
                    eprintln!("Bun input: {error}");
                    break;
                }
            }
        });
        let app = app.clone();
        std::thread::spawn(move || {
            let mut reader = BufReader::new(stdout);
            let mut line = Vec::new();
            loop {
                line.clear();
                match read_line(&mut reader, &mut line) {
                    Ok(false) => break,
                    Ok(true) if line.first() == Some(&HOST_PREFIX) => {
                        match serde_json::from_slice::<Vec<Value>>(&line[1..]) {
                            Ok(frame) => host_frame(&app, &frame),
                            Err(error) => eprintln!("Invalid Bun frame: {error}"),
                        }
                    }
                    Ok(true) => {} // Native extensions may log to inherited stdout.
                    Err(error) => {
                        eprintln!("Bun output: {error}");
                        break;
                    }
                }
            }
            if !app.state::<Bridge>().exiting.swap(true, Ordering::AcqRel) {
                eprintln!("The Bun host disconnected.");
                app.exit(1);
            }
        });
        Ok(())
    }

    pub fn write(&self, frame: Value) -> Result<(), String> {
        let mut frame = serde_json::to_vec(&frame).map_err(|error| error.to_string())?;
        if frame.len() as u64 >= MAX_FRAME {
            return Err("Oversize IPC frame".into());
        }
        frame.push(b'\n');
        self.input
            .try_send(frame)
            .map_err(|error| error.to_string())
    }

    pub fn reset(&self, label: &str) {
        self.pages.lock().unwrap().remove(label);
    }

    pub fn stop(&self) {
        if let Ok(mut child) = self.child.lock() {
            // On the normal path Bun has flushed sessions before allowing exit.
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

fn read_line(reader: &mut impl BufRead, line: &mut Vec<u8>) -> io::Result<bool> {
    if reader.take(MAX_FRAME + 1).read_until(b'\n', line)? == 0 {
        return Ok(false);
    }
    if line.len() as u64 > MAX_FRAME || line.last() != Some(&b'\n') {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "Invalid IPC frame length",
        ));
    }
    Ok(true)
}

#[tauri::command]
pub fn pig_connect(window: WebviewWindow, channel: Channel<Value>) -> Result<u32, String> {
    let bridge = window.state::<Bridge>();
    let generation = bridge.next_page.fetch_add(1, Ordering::Relaxed) + 1;
    let label = window.label();
    let state = crate::flags(&window);
    let mut pages = bridge.pages.lock().unwrap();
    pages.insert(label.to_owned(), (generation, channel));
    if let Err(error) = bridge.write(json!(["attach", label, generation, state])) {
        pages.remove(label);
        return Err(error);
    }
    Ok(generation)
}

#[tauri::command]
pub fn pig_packet(window: WebviewWindow, generation: u32, packet: Value) -> Result<(), String> {
    let bridge = window.state::<Bridge>();
    let label = window.label();
    let pages = bridge.pages.lock().unwrap();
    if pages.get(label).map(|page| page.0) != Some(generation) {
        return Err("Stale pig page".into());
    }
    bridge.write(json!(["packet", label, generation, packet]))
}

fn host_frame(app: &AppHandle, frame: &[Value]) {
    match frame {
        [kind, label, offset] if kind == "create" => {
            let (Some(label), Some(offset)) = (label.as_str(), offset.as_u64()) else {
                return;
            };
            let label = label.to_owned();
            let handle = app.clone();
            if let Err(error) = app.run_on_main_thread(move || {
                if let Err(error) = crate::create_window(&handle, &label, offset as f64) {
                    eprintln!("Could not create pig window: {error}");
                    handle.exit(1);
                }
            }) {
                eprintln!("Could not schedule pig window creation: {error}");
                app.exit(1);
            }
        }
        [kind, label, generation, packet] if kind == "packet" => {
            let (Some(label), Some(generation)) = (label.as_str(), generation.as_u64()) else {
                return;
            };
            let bridge = app.state::<Bridge>();
            let page = bridge.pages.lock().unwrap().get(label).cloned();
            if let Some((current, channel)) = page {
                if u64::from(current) == generation {
                    let _ = channel.send(packet.clone());
                }
            }
        }
        [kind, id, operation, args] if kind == "native" => {
            let (Some(id), Some(operation), Some(args)) =
                (id.as_u64(), operation.as_str(), args.as_array())
            else {
                return;
            };
            let app = app.clone();
            let operation = operation.to_owned();
            let args = args.clone();
            tauri::async_runtime::spawn_blocking(move || {
                let result = crate::native::call(&app, &operation, &args);
                let frame = match result {
                    Ok(value) => json!(["nativeResult", id, true, value]),
                    Err(error) => json!(["nativeResult", id, false, error]),
                };
                let _ = app.state::<Bridge>().write(frame);
            });
        }
        [kind] if kind == "quit" => {
            app.state::<Bridge>().exiting.store(true, Ordering::Release);
            app.exit(0);
        }
        _ => eprintln!("Unrecognized Bun host frame"),
    }
}
