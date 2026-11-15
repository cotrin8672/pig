import { dlopen, ptr } from "bun:ffi";
import { openSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

// `mise run dev`: focus the running dev window, or start `pnpm dev` hidden in the
// background with logs in %TEMP%. Bun only; no PowerShell.
const root = resolve(import.meta.dir, "../../..");
const hostPath = join(
  root,
  "apps/desktop/build/dev-win-x64/pig-dev/bin/bun.exe",
).toLowerCase();

const { symbols: user } = dlopen("user32.dll", {
  FindWindowExW: { args: ["ptr", "ptr", "ptr", "ptr"], returns: "ptr" },
  GetWindowThreadProcessId: { args: ["ptr", "ptr"], returns: "u32" },
  IsWindowVisible: { args: ["ptr"], returns: "i32" },
  ShowWindow: { args: ["ptr", "i32"], returns: "i32" },
  SetForegroundWindow: { args: ["ptr"], returns: "i32" },
});
const { symbols: kernel } = dlopen("kernel32.dll", {
  OpenProcess: { args: ["u32", "i32", "u32"], returns: "ptr" },
  QueryFullProcessImageNameW: {
    args: ["ptr", "u32", "ptr", "ptr"],
    returns: "i32",
  },
  CloseHandle: { args: ["ptr"], returns: "i32" },
});

function processPath(pid: number) {
  // PROCESS_QUERY_LIMITED_INFORMATION
  const handle = kernel.OpenProcess(0x1000, 0, pid);
  if (!handle) return "";
  try {
    const buffer = new Uint16Array(1024);
    const size = new Uint32Array([buffer.length]);
    if (!kernel.QueryFullProcessImageNameW(handle, 0, ptr(buffer), ptr(size)))
      return "";
    return String.fromCharCode(...buffer.subarray(0, size[0])).toLowerCase();
  } finally {
    kernel.CloseHandle(handle);
  }
}

function findDevWindow() {
  const pid = new Uint32Array(1);
  for (let hwnd = user.FindWindowExW(null, null, null, null); hwnd; ) {
    if (user.IsWindowVisible(hwnd)) {
      user.GetWindowThreadProcessId(hwnd, ptr(pid));
      if (processPath(pid[0]) === hostPath) return { hwnd, pid: pid[0] };
    }
    hwnd = user.FindWindowExW(null, hwnd, null, null);
  }
}

const running = findDevWindow();
if (running) {
  user.ShowWindow(running.hwnd, 9); // SW_RESTORE
  if (!user.SetForegroundWindow(running.hwnd))
    console.warn("Windows did not allow the app to take focus.");
  console.log(
    `Dev app already running (PID ${running.pid}); reused existing window.`,
  );
  process.exit(0);
}

const outLog = join(tmpdir(), "pig-dev.stdout.log");
const errLog = join(tmpdir(), "pig-dev.stderr.log");
// Run the desktop package script directly; `mise run` already put pnpm on PATH.
const child = Bun.spawn(
  [Bun.which("pnpm") ?? "pnpm", "--dir", "apps/desktop", "run", "dev"],
  {
    cwd: root,
    detached: true,
    windowsHide: true,
    stdin: "ignore",
    stdout: openSync(outLog, "w"),
    stderr: openSync(errLog, "w"),
  },
);
child.unref();
console.log(`Starting dev app in background (PID ${child.pid}).`);
console.log(`Logs: ${outLog} / ${errLog}`);
process.exit(0);
