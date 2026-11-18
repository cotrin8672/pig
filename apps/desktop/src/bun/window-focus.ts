import { dlopen, type Pointer, ptr } from "bun:ffi";

const user =
  process.platform === "win32"
    ? dlopen("user32.dll", {
        GetForegroundWindow: { args: [], returns: "ptr" },
        GetGUIThreadInfo: { args: ["u32", "ptr"], returns: "i32" },
      }).symbols
    : undefined;

/** Alt+Tab can leave keyboard focus on the host HWND rather than its WebView. */
export function hasHostKeyboardFocus(hwnd: Pointer | null) {
  if (!user || !hwnd || user.GetForegroundWindow() !== hwnd) return false;
  // 64-bit GUITHREADINFO: cbSize, flags, six HWNDs and a RECT.
  const info = Buffer.alloc(72);
  info.writeUInt32LE(info.length);
  return (
    user.GetGUIThreadInfo(0, ptr(info)) !== 0 &&
    info.readBigUInt64LE(16) === BigInt(hwnd) && // hwndFocus
    user.GetForegroundWindow() === hwnd
  );
}
