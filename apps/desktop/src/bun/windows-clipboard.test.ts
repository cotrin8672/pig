import { expect, test } from "bun:test";
import { dibToBmp } from "./windows-clipboard";

function dib(header = 40, bits = 24, compression = 0, colors = 0) {
  const masks = header === 40 && compression === 3 ? 12 : 0;
  const palette = (colors || (bits <= 8 ? 2 ** bits : 0)) * 4;
  const bytes = Buffer.alloc(header + masks + palette + 4);
  bytes.writeUInt32LE(header, 0);
  bytes.writeInt32LE(1, 4);
  bytes.writeInt32LE(1, 8);
  bytes.writeUInt16LE(1, 12);
  bytes.writeUInt16LE(bits, 14);
  bytes.writeUInt32LE(compression, 16);
  bytes.writeUInt32LE(4, 20);
  bytes.writeUInt32LE(colors, 32);
  return bytes;
}

test("packed DIB, bitfields, palettes and DIBV5 get correct BMP pixel offsets", () => {
  for (const [bytes, offset] of [
    [dib(), 54],
    [dib(40, 32, 3), 66],
    [dib(40, 8), 1078],
    [dib(40, 8, 0, 4), 70],
    [dib(124, 32, 3), 138],
  ] as const) {
    const bmp = dibToBmp(bytes);
    expect(bmp.toString("ascii", 0, 2)).toBe("BM");
    expect(bmp.readUInt32LE(2)).toBe(bmp.length);
    expect(bmp.readUInt32LE(10)).toBe(offset);
    expect(bmp.subarray(14)).toEqual(bytes);
  }
  expect(() => dibToBmp(Buffer.alloc(10))).toThrow("Invalid");
  const invalid = dib();
  invalid.writeUInt32LE(9999, 0);
  expect(() => dibToBmp(invalid)).toThrow("Unsupported");
  const missingPixels = dib().subarray(0, 40);
  expect(() => dibToBmp(missingPixels)).toThrow("pixels");
});

test("Windows PNG copy/paste uses the same format, copies locked memory and reports native failures", async () => {
  // Isolate FFI mocks: never change the user's real OS clipboard or mock DLLs
  // used by other tests in this worker.
  const modulePath = new URL("./windows-clipboard.ts", import.meta.url).href;
  const child = Bun.spawn(
    [
      process.execPath,
      "-e",
      `
    import {expect,mock} from "bun:test";
    import * as ffi from "bun:ffi";
    const {ptr,toArrayBuffer}=ffi;
    Object.defineProperty(process,"platform",{value:"win32"});
    const allocations=new Map(),formats=new Map();
    let owner,closed=0,freed=0,writeFails=false,lockFails=false;
    const native={
      OpenClipboard:value=>{owner=value;return 1;},
      CloseClipboard:()=>{closed++;return 1;},
      EmptyClipboard:()=>{formats.clear();return 1;},
      RegisterClipboardFormatW:()=>49152,
      IsClipboardFormatAvailable:format=>Number(formats.has(format)),
      GetClipboardData:format=>formats.get(format)??null,
      SetClipboardData:(format,handle)=>{if(writeFails)return null;formats.set(format,handle);return handle;},
      GlobalAlloc:(_flags,size)=>{const buffer=Buffer.alloc(Number(size)),handle=ptr(buffer);allocations.set(handle,buffer);return handle;},
      GlobalLock:handle=>lockFails?null:handle,
      GlobalUnlock:()=>1,
      GlobalSize:handle=>BigInt(allocations.get(handle).length),
      GlobalFree:handle=>{freed++;allocations.delete(handle);return null;},
    };
    mock.module("bun:ffi",()=>({...ffi,ptr,toArrayBuffer,dlopen:()=>({symbols:native})}));
    const {readWindowsClipboardImage:read,writeWindowsClipboardImage:write}=await import(${JSON.stringify(modulePath)});
    const png=Uint8Array.from([137,80,78,71,13,10,26,10,1,2,3]);
    await write(png,123);
    expect(owner).toBe(123);
    expect(formats.has(49152)).toBe(true);
    const image=await read();
    expect(image.format).toBe("png");expect(image.bytes).toEqual(Buffer.from(png));
    allocations.get(formats.get(49152)).fill(0);
    expect(image.bytes).toEqual(Buffer.from(png)); // snapshot survives unlock/clipboard replacement
    formats.clear();expect(await read()).toBeNull();
    const handle=native.GlobalAlloc(2,44);formats.set(17,handle);
    expect((await read()).format).toBe("dib");
    formats.clear();formats.set(8,handle);expect((await read()).format).toBe("dib");
    lockFails=true;await expect(read()).rejects.toThrow("Could not read");lockFails=false;
    const beforeFailure=closed;
    writeFails=true;await expect(write(png,123)).rejects.toThrow("Could not copy");
    expect(freed).toBe(1);expect(closed).toBe(beforeFailure+1);
    await expect(write(png,null)).rejects.toThrow("open window");
    console.log("clipboard regression passed");
  `,
    ],
    { stdout: "pipe", stderr: "pipe" },
  );
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  expect(code, stderr).toBe(0);
  expect(stdout).toContain("clipboard regression passed");
});
