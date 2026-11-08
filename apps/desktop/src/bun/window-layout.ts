import { dlopen, type Pointer, ptr } from "bun:ffi";
import { join } from "node:path";

type Frame = { x: number; y: number; width: number; height: number };
type WebviewSurface = { ptr: Pointer | null; frame: Frame };
type ClientArea = {
  getRect: (hwnd: Pointer) => ArrayLike<number> | null;
  resize: (view: Pointer, frame: Frame) => void;
};

export function createClientAreaSynchronizer(native?: ClientArea) {
  return (hwnd: Pointer, view: WebviewSurface): boolean => {
    if (!native || !view.ptr) return false;
    const rect = native.getRect(hwnd);
    if (!rect) return false;
    const width = rect[2] - rect[0];
    const height = rect[3] - rect[1];
    // A minimized/destroyed window must not replace the last usable surface with 0x0.
    if (!(width > 0 && height > 0)) return false;
    const frame = { x: 0, y: 0, width, height };
    native.resize(view.ptr, frame);
    view.frame = frame;
    return true;
  };
}

const user =
  process.platform === "win32"
    ? dlopen("user32.dll", {
        GetClientRect: { args: ["ptr", "ptr"], returns: "i32" },
      })
    : undefined;

// Electrobun 1.18.1 has no public BrowserView.setFrame. Use its existing exported
// resize function, which queues the controller update on the native UI thread.
// Load lazily: unit tests and non-desktop Bun processes have no native wrapper.
function openWrapper() {
  return dlopen(join(process.cwd(), "libNativeWrapper.dll"), {
    resizeWebview: {
      args: ["ptr", "f64", "f64", "f64", "f64", "ptr"],
      returns: "void",
    },
  });
}
let wrapper: ReturnType<typeof openWrapper> | undefined;

export const synchronizeClientArea = createClientAreaSynchronizer(
  user
    ? {
        getRect(hwnd) {
          const rect = new Int32Array(4);
          return user.symbols.GetClientRect(hwnd, ptr(rect)) ? rect : null;
        },
        resize(view, frame) {
          wrapper ??= openWrapper();
          // GetClientRect and WebView2 Bounds share Win32 client coordinates.
          // Do not multiply these by the browser's devicePixelRatio.
          wrapper.symbols.resizeWebview(
            view,
            frame.x,
            frame.y,
            frame.width,
            frame.height,
            null,
          );
        },
      }
    : undefined,
);
