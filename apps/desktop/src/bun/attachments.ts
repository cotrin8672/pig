import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join, resolve } from "node:path";
import type { ImageContent } from "@earendil-works/pi-ai";
import { desktopConfigDir } from "./desktop-config";

export const attachmentsDir = join(desktopConfigDir, "attachments");
const maxAttachmentBytes = 50 * 1024 * 1024;

/** Content-addressed and never rewritten, so a sent path keeps its sent bytes. */
export async function storeAttachment(
  bytes: Buffer,
  ext: string,
  dir = attachmentsDir,
) {
  if (bytes.length > maxAttachmentBytes)
    throw new Error("Each attachment must be at most 50 MiB.");
  const safeExt = /^\.[A-Za-z0-9]{1,10}$/.test(ext) ? ext.toLowerCase() : "";
  const path = join(
    dir,
    `${createHash("sha256").update(bytes).digest("hex")}${safeExt}`,
  );
  await mkdir(dir, { recursive: true });
  await writeFile(path, bytes, { flag: "wx" }).catch((error) => {
    if (error?.code !== "EEXIST") throw error;
  });
  return path;
}

export const storeFile = (name: string, data: string, dir?: string) =>
  storeAttachment(Buffer.from(data, "base64"), extname(name), dir);

export const storeImage = (image: ImageContent, dir?: string) =>
  storeAttachment(
    Buffer.from(image.data, "base64"),
    `.${image.mimeType.split("/")[1]?.replace("jpeg", "jpg")}`,
    dir,
  );

export async function attachmentPreview(path: string, dir = attachmentsDir) {
  if (
    dirname(resolve(path)) !== resolve(dir) ||
    !/^[a-f0-9]{64}\.(png|jpe?g|gif|webp)$/i.test(basename(path))
  )
    return null;
  try {
    const bytes = await readFile(path);
    if (bytes.length > maxAttachmentBytes) return null;
    const ext = extname(path).slice(1).toLowerCase();
    return `data:image/${ext === "jpg" ? "jpeg" : ext};base64,${bytes.toString("base64")}`;
  } catch {
    return null;
  }
}

export { withAttachmentPaths } from "../shared/attachments";
