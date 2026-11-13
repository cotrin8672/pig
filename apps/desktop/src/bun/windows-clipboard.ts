import { dlopen, type Pointer, ptr, toArrayBuffer } from "bun:ffi";

// Electrobun 1.18 writes registered PNG, but its Windows reader only reads
// CF_DIB (and returns it without PNG conversion). Keep both formats explicit.
const user =
  process.platform === "win32"
    ? dlopen("user32.dll", {
        OpenClipboard: { args: ["ptr"], returns: "i32" },
        CloseClipboard: { args: [], returns: "i32" },
        EmptyClipboard: { args: [], returns: "i32" },
        RegisterClipboardFormatW: { args: ["ptr"], returns: "u32" },
        GetClipboardData: { args: ["u32"], returns: "ptr" },
        IsClipboardFormatAvailable: { args: ["u32"], returns: "i32" },
        SetClipboardData: { args: ["u32", "ptr"], returns: "ptr" },
      })
    : undefined;
const kernel =
  process.platform === "win32"
    ? dlopen("kernel32.dll", {
        GlobalAlloc: { args: ["u32", "u64"], returns: "ptr" },
        GlobalLock: { args: ["ptr"], returns: "ptr" },
        GlobalUnlock: { args: ["ptr"], returns: "i32" },
        GlobalSize: { args: ["ptr"], returns: "u64" },
        GlobalFree: { args: ["ptr"], returns: "ptr" },
      })
    : undefined;
const pngName = Buffer.from("PNG\0", "utf16le");

async function opened<T>(owner: Pointer | null, action: () => T): Promise<T> {
  if (!user) throw new Error("Windows clipboard is unavailable.");
  for (let attempt = 0; !user.symbols.OpenClipboard(owner); attempt++) {
    if (attempt >= 4)
      throw new Error("Could not open the clipboard. Try pasting again.");
    await Bun.sleep(10);
  }
  try {
    return action();
  } finally {
    user.symbols.CloseClipboard();
  }
}

export async function readWindowsClipboardImage() {
  if (!user || !kernel) throw new Error("Windows clipboard is unavailable.");
  const u = user.symbols,
    k = kernel.symbols;
  return opened(null, () => {
    const png = u.RegisterClipboardFormatW(ptr(pngName));
    if (!png) throw new Error("Could not register the PNG clipboard format.");
    // Prefer lossless PNG, including images copied by pig. Screenshots and
    // other applications may instead expose CF_DIBV5 (17) or CF_DIB (8).
    const format = [png, 17, 8].find((value) =>
      u.IsClipboardFormatAvailable(value),
    );
    if (format === undefined) return null;
    const handle = u.GetClipboardData(format);
    if (!handle) throw new Error("Could not read the clipboard image.");
    const size = Number(k.GlobalSize(handle));
    if (!size || size > 50 * 1024 * 1024)
      throw new Error("Clipboard image is empty or too large.");
    const memory = k.GlobalLock(handle);
    if (!memory) throw new Error("Could not read the clipboard image.");
    try {
      return {
        format: format === png ? ("png" as const) : ("dib" as const),
        bytes: Buffer.from(new Uint8Array(toArrayBuffer(memory, 0, size))),
      };
    } finally {
      k.GlobalUnlock(handle);
    }
  });
}

export async function writeWindowsClipboardImage(
  bytes: Uint8Array,
  owner: Pointer | null,
) {
  if (!user || !kernel || !owner)
    throw new Error("Cannot copy an image without an open window.");
  const u = user.symbols,
    k = kernel.symbols;
  await opened(owner, () => {
    const format = u.RegisterClipboardFormatW(ptr(pngName));
    if (!format)
      throw new Error("Could not register the PNG clipboard format.");
    const handle = k.GlobalAlloc(2, bytes.length); // GMEM_MOVEABLE; ownership transfers on success.
    if (!handle) throw new Error("Could not allocate the clipboard image.");
    let transferred = false;
    try {
      const memory = k.GlobalLock(handle);
      if (!memory) throw new Error("Could not write the clipboard image.");
      try {
        new Uint8Array(toArrayBuffer(memory, 0, bytes.length)).set(bytes);
      } finally {
        k.GlobalUnlock(handle);
      }
      if (!u.EmptyClipboard() || !u.SetClipboardData(format, handle))
        throw new Error("Could not copy the image to the clipboard.");
      transferred = true;
    } finally {
      if (!transferred) k.GlobalFree(handle);
    }
  });
}

/** Add the BMP file header omitted by Windows' packed DIB clipboard formats. */
export function dibToBmp(bytes: Uint8Array) {
  const dib = Buffer.from(bytes);
  if (dib.length < 40) throw new Error("Invalid clipboard bitmap.");
  const header = dib.readUInt32LE(0),
    bits = dib.readUInt16LE(14),
    compression = dib.readUInt32LE(16);
  if (![40, 52, 56, 108, 124].includes(header) || header > dib.length)
    throw new Error("Unsupported clipboard bitmap header.");
  const colors = dib.readUInt32LE(32) || (bits <= 8 ? 2 ** bits : 0);
  const masks =
    header === 40 ? (compression === 3 ? 12 : compression === 6 ? 16 : 0) : 0;
  const offset = 14 + header + masks + colors * 4;
  if (offset >= dib.length + 14)
    throw new Error("Invalid clipboard bitmap pixels.");
  const bmp = Buffer.alloc(14 + dib.length);
  bmp.write("BM");
  bmp.writeUInt32LE(bmp.length, 2);
  bmp.writeUInt32LE(offset, 10);
  dib.copy(bmp, 14);
  return bmp;
}
