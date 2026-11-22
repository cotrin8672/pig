import type { Pointer } from "bun:ffi";
import { dlopen, ptr } from "bun:ffi";
import { Console } from "node:console";
import { writeSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { desktopRpc } from "../shared/desktop-rpc";
import {
  type DesktopWindow,
  installDesktopPlatform,
  type WindowEvent,
} from "./desktop-platform";

// stdout belongs to the parent protocol. SDK and extension logging goes to stderr.
Object.assign(globalThis, { console: new Console(process.stderr) });
class OversizeFrame extends Error {}
const maxFrameBody = 64 * 1024 * 1024 - 2; // Record separator and newline.
function write(frame: unknown[]) {
  const json = JSON.stringify(frame);
  // UTF-8 is at most 3 bytes per UTF-16 unit; skip the byte scan for small frames.
  if (
    json.length > maxFrameBody ||
    (json.length * 3 > maxFrameBody && Buffer.byteLength(json) > maxFrameBody)
  )
    throw new OversizeFrame(
      "The desktop response exceeds the 64 MiB IPC limit.",
    );
  const bytes = Buffer.from(`\x1e${json}\n`);
  for (let offset = 0; offset < bytes.length; ) {
    offset += writeSync(1, bytes, offset, bytes.length - offset);
  }
}

type Flags = {
  handle: number;
  maximized: boolean;
  minimized: boolean;
  focused: boolean;
};
type AttachedWindow = {
  update(event: WindowEvent, flags?: Flags): void;
  attach(generation: number, flags: Flags): void;
  packet(generation: number, data: unknown): void;
};
const windows = new Map<string, AttachedWindow>();
const pending = new Map<number, (ok: boolean, value: unknown) => void>();
let nativeSequence = 0;
function native<T>(method: string, ...args: unknown[]) {
  const id = ++nativeSequence;
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => finish(false, "Native operation timed out."),
      300_000,
    );
    function finish(ok: boolean, value: unknown) {
      clearTimeout(timer);
      pending.delete(id);
      if (ok) resolve(value as T);
      else reject(new Error(String(value)));
    }
    pending.set(id, finish);
    try {
      write(["native", id, method, args]);
    } catch (error) {
      finish(false, error);
    }
  });
}
const run = (method: string, ...args: unknown[]) =>
  void native(method, ...args).catch(console.error);
let beforeQuit: (() => boolean) | undefined;

// The shell result is synchronous: OAuth must distinguish a failed URL hand-off.
const shell = dlopen("shell32.dll", {
  ShellExecuteW: {
    args: ["ptr", "ptr", "ptr", "ptr", "ptr", "i32"],
    returns: "i64",
  },
});
const wide = (text: string) => Buffer.from(`${text}\0`, "utf16le");
const openVerb = wide("open");
function openInShell(target: string) {
  const value = wide(target);
  return (
    shell.symbols.ShellExecuteW(
      null,
      ptr(openVerb),
      ptr(value),
      null,
      null,
      1,
    ) > 32
  );
}

installDesktopPlatform({
  downloads: process.env.PIG_TAURI_DOWNLOADS ?? join(homedir(), "Downloads"),
  version: process.env.PIG_TAURI_VERSION ?? "—",
  usesLegacyUpdater: false,
  defaultShell: "powershell",
  createWindow(id, offset, handlers): DesktopWindow {
    const events = new Map<WindowEvent, () => void>();
    let flags: Flags | undefined;
    let generation = 0;
    let alive = true;
    const createRpc = () => {
      const epoch = generation;
      return desktopRpc<"bun", "webview">(handlers, (packet) => {
        if (!epoch || epoch !== generation)
          throw new Error("Window disconnected.");
        try {
          write(["packet", id, epoch, packet]);
        } catch (error) {
          // No bytes were written on overflow. Keep the same request ID.
          if (!(error instanceof OversizeFrame) || packet[0] !== "reply")
            throw error;
          write([
            "packet",
            id,
            epoch,
            ["reply", packet[1], false, error.message],
          ]);
        }
      });
    };
    let rpc = createRpc();
    windows.set(id, {
      attach(next, state) {
        if (generation) events.get("navigate")?.();
        rpc.close();
        generation = next;
        rpc = createRpc();
        flags = state;
        events.get(state.focused ? "focus" : "blur")?.();
        events.get("ready")?.();
      },
      packet(epoch, value) {
        if (epoch === generation) void rpc.receive(value);
      },
      update(event, state) {
        if (state) flags = state;
        if (event === "close") {
          alive = false;
          rpc.close();
          windows.delete(id);
        }
        events.get(event)?.();
      },
    });
    write(["create", id, offset]);
    return {
      get ptr() {
        return (flags?.handle ?? null) as Pointer | null;
      },
      isAlive: () => alive,
      isMaximized: () => flags?.maximized ?? false,
      isMinimized: () => flags?.minimized ?? false,
      minimize: () => run("minimize", id),
      toggleMaximize: () => run("toggleMaximize", id),
      close: () => run("close", id),
      applyBackdrop: (appearance) =>
        native<void>("backdrop", id, appearance.backdrop),
      on(event, callback) {
        events.set(event, callback);
      },
      send(name, payload) {
        if (generation && alive) rpc.publish(name, payload);
      },
      flushDrafts: () =>
        generation && alive ? rpc.request.flushDrafts() : Promise.resolve(),
    };
  },
  onBeforeQuit(handler) {
    beforeQuit = handler;
  },
  quit() {
    write(["quit"]);
  },
  async choosePath(kind) {
    return (await native<string | null>("pick", kind)) ?? undefined;
  },
  showMessageBox: (input) => native<number>("dialog", input),
  showMenu(items, choose) {
    void native<string | null>("menu", items)
      .then((item) => {
        if (item) choose(item);
      })
      .catch(console.error);
  },
  showNotification: (body) => run("notify", body),
  openExternal(url) {
    if (typeof url !== "string") return false;
    try {
      const parsed = new URL(url);
      return (
        ["http:", "https:"].includes(parsed.protocol) &&
        !parsed.username &&
        !parsed.password &&
        openInShell(parsed.href)
      );
    } catch {
      return false;
    }
  },
  openPath: openInShell,
  showItemInFolder(path) {
    const explorer = join(
      process.env.SystemRoot ?? "C:\\Windows",
      "explorer.exe",
    );
    Bun.spawn([explorer, "/select,", path], {
      stdout: "ignore",
      stderr: "ignore",
      windowsHide: true,
    }).unref();
  },
  clipboardReadText: () => native<string | null>("clipboardRead"),
  clipboardWriteText: (text) => native<void>("clipboardWrite", text),
  clipboardReadImage: () => null, // Windows images use the existing PNG/DIB path.
  clipboardWriteImage() {
    throw new Error("Use the Windows image clipboard.");
  },
});

const { openWindow } = await import("./app");
const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
input.on("line", (line) => {
  try {
    const [kind, a, b, c] = JSON.parse(line);
    if (kind === "attach") windows.get(a)?.attach(b, c);
    else if (kind === "packet") windows.get(a)?.packet(b, c);
    else if (kind === "windowEvent") windows.get(a)?.update(b, c);
    else if (kind === "nativeResult") pending.get(a)?.(b, c);
    else if (kind === "open-more") openWindow();
    else if (kind === "beforeQuit" && beforeQuit?.()) write(["quit"]);
  } catch (error) {
    console.error("Invalid Tauri host frame:", error);
  }
});
// Do not leave this host running if Tauri is forcibly terminated.
input.on("close", () => process.exit(0));
