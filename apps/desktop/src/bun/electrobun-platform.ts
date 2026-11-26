import Electrobun, {
  BrowserView,
  BrowserWindow,
  ContextMenu,
  Updater,
  Utils,
} from "electrobun/bun";
import type { RPCSchema } from "../shared/rpc-schema";
import { applyBackdrop, setNativeEnvironment } from "./appearance";
import type { DesktopPlatform } from "./desktop-platform";
import { hasHostKeyboardFocus } from "./window-focus";

export async function electrobunPlatform(
  channel: string,
): Promise<DesktopPlatform> {
  let url = "views://mainview/index.html";
  if (channel === "dev") {
    setNativeEnvironment(
      "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS",
      `${process.env.WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS ?? ""} --remote-debugging-port=9229`.trim(),
    );
    try {
      await fetch("http://localhost:5173", {
        method: "HEAD",
        signal: AbortSignal.timeout(1000),
      });
      url = "http://localhost:5173";
    } catch {
      console.log("[view] Using bundled webview");
    }
  }
  setNativeEnvironment("WEBVIEW2_DEFAULT_BACKGROUND_COLOR", "00000000");
  let menu: ((action: string) => void) | undefined;
  ContextMenu.on("context-menu-clicked", (event) => {
    const { action } = (event as { data: { action: string } }).data;
    menu?.(action);
  });
  return {
    userData: Utils.paths.userData,
    downloads: Utils.paths.downloads,
    version: await Updater.localInfo.version(),
    usesLegacyUpdater: true,
    defaultShell: "git-bash",
    createWindow(_id, offset, handlers) {
      const rpc = BrowserView.defineRPC<RPCSchema>({
        maxRequestTime: 600_000,
        handlers,
      });
      const window = new BrowserWindow({
        transparent: true,
        title: "pig",
        titleBarStyle: "hiddenInset",
        url,
        rpc,
        frame: { x: 100 + offset, y: 80 + offset, width: 1280, height: 840 },
      });
      let focused = true;
      window.on("blur", () => {
        focused = false;
      });
      window.on("focus", () => {
        const wasFocused = focused;
        focused = true;
        if (process.platform !== "win32" || wasFocused) return;
        setTimeout(() => {
          if (
            focused &&
            BrowserWindow.getById(window.id) &&
            hasHostKeyboardFocus(window.ptr)
          )
            window.activate();
        }, 0);
      });
      return {
        get ptr() {
          return window.ptr;
        },
        isAlive: () => !!BrowserWindow.getById(window.id),
        isMaximized: () => window.isMaximized(),
        isMinimized: () => window.isMinimized(),
        minimize: () => window.minimize(),
        toggleMaximize: () =>
          window.isMaximized() ? window.unmaximize() : window.maximize(),
        close: () => window.close(),
        applyBackdrop: (appearance) => applyBackdrop(window.ptr, appearance),
        send: (name, payload) => {
          void (rpc.send as (name: string, payload: unknown) => unknown)(
            name,
            payload,
          );
        },
        flushDrafts: () => rpc.request.flushDrafts(),
        on(event, callback) {
          if (event === "ready") window.webview.on("dom-ready", callback);
          else if (event === "navigate")
            window.webview.on("will-navigate", callback);
          else if (event !== "closeRequested") window.on(event, callback);
        },
      };
    },
    onBeforeQuit(handler) {
      Electrobun.events.on("before-quit", (event) => {
        if (!handler()) event.response = { allow: false };
      });
    },
    quit: () => Utils.quit(),
    async choosePath(kind) {
      const [path] = await Utils.openFileDialog({
        canChooseFiles: kind === "json",
        canChooseDirectory: kind === "folder",
        allowsMultipleSelection: false,
        ...(kind === "json" ? { allowedFileTypes: "json" } : {}),
      });
      return path;
    },
    async showMessageBox(input) {
      return (await Utils.showMessageBox({ ...input, type: "warning" }))
        .response;
    },
    showMenu(items, choose) {
      menu = choose;
      ContextMenu.showContextMenu(items);
    },
    showNotification: (body) => Utils.showNotification({ title: "pig", body }),
    openExternal: (url) => Utils.openExternal(url),
    openPath: (path) => Utils.openPath(path),
    showItemInFolder: (path) => Utils.showItemInFolder(path),
    clipboardReadText: () => Utils.clipboardReadText(),
    clipboardWriteText: (text) => {
      Utils.clipboardWriteText(text);
    },
    clipboardReadImage: () => Utils.clipboardReadImage(),
    clipboardWriteImage: (png) => {
      Utils.clipboardWriteImage(png);
    },
  };
}
