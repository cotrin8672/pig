import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { convertToPng } from "@earendil-works/pi-coding-agent";
import { ContextMenu, Utils } from "electrobun/bun";

const maxRemoteBytes = 50 * 1024 * 1024;

export function decodeDataUrl(src: string) {
  const match = /^data:(image\/[\w.+-]+);base64,([A-Za-z0-9+/=\s]*)$/.exec(src);
  if (!match) return undefined;
  return { mimeType: match[1], bytes: Buffer.from(match[2], "base64") };
}

export function imageExtension(mimeType: string) {
  const subtype = mimeType.split("/")[1]?.split(/[+;]/)[0] ?? "";
  return subtype === "jpeg"
    ? "jpg"
    : /^[a-z0-9-]{1,10}$/.test(subtype)
      ? subtype
      : "img";
}

// The webview passes back the same src it rendered: an inline data URL or a Markdown https URL.
async function loadImage(src: unknown) {
  if (typeof src !== "string") throw new Error("Invalid image.");
  const inline = decodeDataUrl(src);
  if (inline) return inline;
  if (!/^https?:\/\//i.test(src)) throw new Error("Unsupported image source.");
  const response = await fetch(src);
  if (!response.ok)
    throw new Error(`Could not download image (${response.status}).`);
  const mimeType =
    response.headers.get("content-type")?.split(";")[0].trim() ?? "";
  if (!mimeType.startsWith("image/"))
    throw new Error("The link is not an image.");
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > maxRemoteBytes) throw new Error("Image is too large.");
  return { mimeType, bytes };
}

export async function copyImage(src: unknown) {
  const { mimeType, bytes } = await loadImage(src);
  const png =
    mimeType === "image/png"
      ? bytes
      : await convertToPng(bytes.toString("base64"), mimeType).then(
          (converted) => converted && Buffer.from(converted.data, "base64"),
        );
  if (!png) throw new Error("Could not convert image for the clipboard.");
  Utils.clipboardWriteImage(png);
}

export async function saveImage(src: unknown) {
  const { mimeType, bytes } = await loadImage(src);
  const path = join(
    Utils.paths.downloads,
    `pig-image-${Date.now()}.${imageExtension(mimeType)}`,
  );
  await writeFile(path, bytes, { flag: "wx" });
  Utils.showItemInFolder(path);
  return path;
}

let menuImage: string | undefined;
export function initImageMenu(report: (error: unknown) => void) {
  ContextMenu.on("context-menu-clicked", (event) => {
    const { action } = (event as { data: { action: string } }).data;
    const src = menuImage;
    if (action === "image-copy") void copyImage(src).catch(report);
    else if (action === "image-save") void saveImage(src).catch(report);
  });
}
export function showImageMenu(
  src: string,
  labels: { copy: string; save: string },
) {
  menuImage = src;
  ContextMenu.showContextMenu([
    { label: labels.copy, action: "image-copy" },
    { label: labels.save, action: "image-save" },
  ]);
}
