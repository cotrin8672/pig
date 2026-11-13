import { expect, mock, test } from "bun:test";
import { PhotonImage } from "@silvia-odwyer/photon";
import { dibToBmp } from "./windows-clipboard";

mock.module("electrobun/bun", () => ({ ContextMenu: {}, Utils: {} }));
const { decodeDataUrl, imageExtension, encodePng } = await import("./images");

test("decodes base64 image data URLs only", () => {
  const decoded = decodeDataUrl("data:image/png;base64,aGk=");
  expect(decoded?.mimeType).toBe("image/png");
  expect(decoded?.bytes.toString()).toBe("hi");
  expect(decodeDataUrl("data:text/html;base64,aGk=")).toBeUndefined();
  expect(decodeDataUrl("https://example.com/a.png")).toBeUndefined();
});

test("Windows clipboard DIB bytes are converted to actual PNG, not mislabeled base64", () => {
  const dib = Buffer.alloc(44);
  dib.writeUInt32LE(40, 0);
  dib.writeInt32LE(1, 4);
  dib.writeInt32LE(1, 8);
  dib.writeUInt16LE(1, 12);
  dib.writeUInt16LE(24, 14);
  dib.writeUInt32LE(4, 20);
  dib[42] = 255; // BGR red pixel, padded to four bytes.
  const png = encodePng(dibToBmp(dib));
  expect([...png.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  const image = PhotonImage.new_from_byteslice(png);
  try {
    expect(image.get_width()).toBe(1);
    expect(image.get_height()).toBe(1);
    expect([...image.get_raw_pixels()]).toEqual([255, 0, 0, 255]);
  } finally {
    image.free();
  }
});

test("derives safe file extensions", () => {
  expect(imageExtension("image/jpeg")).toBe("jpg");
  expect(imageExtension("image/svg+xml")).toBe("svg");
  expect(imageExtension("image/../../x")).toBe("img");
});
