import { dlopen, type Pointer, ptr } from "bun:ffi";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { defaultAppearance, validateAppearance } from "../shared/appearance";
import type { Appearance } from "../shared/rpc-schema";

export { validateAppearance } from "../shared/appearance";

export async function loadAppearance(file: string): Promise<Appearance> {
  try {
    return validateAppearance(JSON.parse(await readFile(file, "utf8")));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT")
      console.error("Cannot load appearance:", error);
    return { ...defaultAppearance, opacity: { ...defaultAppearance.opacity } };
  }
}

export async function saveAppearance(file: string, appearance: Appearance) {
  await mkdir(dirname(file), { recursive: true });
  const temporary = `${file}.${crypto.randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(appearance));
  await rename(temporary, file);
}

const dwm =
  process.platform === "win32"
    ? dlopen("dwmapi.dll", {
        DwmSetWindowAttribute: {
          args: ["ptr", "u32", "ptr", "u32"],
          returns: "i32",
        },
        DwmExtendFrameIntoClientArea: { args: ["ptr", "ptr"], returns: "i32" },
        DwmEnableBlurBehindWindow: { args: ["ptr", "ptr"], returns: "i32" },
      })
    : undefined;

const user =
  process.platform === "win32"
    ? dlopen("user32.dll", {
        GetWindowLongW: { args: ["ptr", "i32"], returns: "i32" },
        SetWindowLongW: { args: ["ptr", "i32", "i32"], returns: "i32" },
        SetWindowPos: {
          args: ["ptr", "ptr", "i32", "i32", "i32", "i32", "u32"],
          returns: "i32",
        },
        RedrawWindow: { args: ["ptr", "ptr", "ptr", "u32"], returns: "i32" },
      })
    : undefined;

const gdi =
  process.platform === "win32"
    ? dlopen("gdi32.dll", {
        CreateRectRgn: { args: ["i32", "i32", "i32", "i32"], returns: "ptr" },
        DeleteObject: { args: ["ptr"], returns: "i32" },
      })
    : undefined;

export function windowStyleForBackdrop(style: number) {
  // Keep WS_CAPTION: removing it makes maximized windows suppress taskbar auto-hide.
  // hiddenInset's WM_NCCALCSIZE hides the titlebar, not the style bits Windows needs.
  // Remove WS_CLIPCHILDREN; retain the standard caption, resize and Snap flags.
  return (style & ~0x02000000) | 0x00cf0000;
}

export function applyBackdrop(hwnd: Pointer | null, appearance: Appearance) {
  if (!dwm) return;
  if (!hwnd) throw new Error("Cannot apply backdrop to a closed window.");
  let frameChanged = false;
  if (user) {
    const windowStyle = user.symbols.GetWindowLongW(hwnd, -16);
    // Preserve native window semantics; hiddenInset owns caption layout.
    const nextStyle = windowStyleForBackdrop(windowStyle);
    if (nextStyle !== windowStyle) {
      user.symbols.SetWindowLongW(hwnd, -16, nextStyle);
      frameChanged = true;
    }
  }
  const check = (result: number) => {
    // shortcut: Windows 10 has no system backdrops, upgrade to Windows 11 build 22621+.
    if (result < 0)
      throw new Error(
        `Windows backdrop unavailable (HRESULT 0x${(result >>> 0).toString(16)}). Windows 11 22H2 or later is required.`,
      );
  };
  // Transparent WebView2 can expose a white redirection surface during DWM's
  // maximize/restore animation even while the Acrylic attribute remains set.
  // DWMWA_TRANSITIONS_FORCEDISABLED: keep Acrylic; disable only native animation.
  const disableTransitions = new Int32Array([1]);
  check(dwm.symbols.DwmSetWindowAttribute(hwnd, 3, ptr(disableTransitions), 4));
  const dark = new Int32Array([1]);
  check(dwm.symbols.DwmSetWindowAttribute(hwnd, 20, ptr(dark), 4));
  // Full-client glass (-1) also paints native caption buttons beneath our
  // auto-hiding toolbar. A 1px frame keeps DWM corners/shadows without that
  // extra set; the empty blur region below enables alpha for the whole view.
  const margins = new Int32Array([1, 1, 1, 1]);
  check(dwm.symbols.DwmExtendFrameIntoClientArea(hwnd, ptr(margins)));
  if (gdi) {
    // Windowed WebView2 still needs DWM alpha enabled, even with NOREDIRECTIONBITMAP.
    const region = gdi.symbols.CreateRectRgn(0, 0, -1, -1);
    if (!region) throw new Error("Cannot create the Windows alpha region.");
    // DWM_BLURBEHIND uses the Windows x64 ABI; an empty region enables alpha without blur.
    const blur = new ArrayBuffer(24);
    const data = new DataView(blur);
    data.setUint32(0, 3, true); // DWM_BB_ENABLE | DWM_BB_BLURREGION
    data.setInt32(4, 1, true);
    data.setBigUint64(8, BigInt(region), true);
    try {
      check(dwm.symbols.DwmEnableBlurBehindWindow(hwnd, ptr(blur)));
    } finally {
      gdi.symbols.DeleteObject(region);
    }
  }
  const type = new Int32Array([
    { none: 1, mica: 2, acrylic: 3 }[appearance.backdrop],
  ]);
  const result = dwm.symbols.DwmSetWindowAttribute(hwnd, 38, ptr(type), 4);
  // Pre-22H2 Windows has no attribute 38; "none" needs no backdrop, so it must not fail there.
  if (appearance.backdrop !== "none") check(result);
  // Apply cached frame changes only after alpha clears, the backdrop, and
  // transition suppression are ready; otherwise frame recalculation can flash white.
  if (
    user &&
    frameChanged &&
    !user.symbols.SetWindowPos(hwnd, null, 0, 0, 0, 0, 0x37)
  )
    throw new Error("Cannot recalculate the Windows client frame.");
  // RDW_INVALIDATE | RDW_ERASE | RDW_ALLCHILDREN | RDW_FRAME.
  user?.symbols.RedrawWindow(hwnd, null, null, 0x485);
}

export function setNativeEnvironment(name: string, value: string) {
  process.env[name] = value;
  if (process.platform !== "win32") return;
  // Bun's process.env does not update the Win32 environment read by WebView2.
  const kernel = dlopen("kernel32.dll", {
    SetEnvironmentVariableW: { args: ["ptr", "ptr"], returns: "i32" },
  });
  try {
    const nameBuffer = Buffer.from(`${name}\0`, "utf16le");
    const valueBuffer = Buffer.from(`${value}\0`, "utf16le");
    if (
      !kernel.symbols.SetEnvironmentVariableW(ptr(nameBuffer), ptr(valueBuffer))
    )
      throw new Error(`Cannot set ${name}`);
  } finally {
    kernel.close();
  }
}
