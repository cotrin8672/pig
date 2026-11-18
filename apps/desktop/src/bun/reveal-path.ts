import { stat } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { type FileReveal, isFileLink } from "../shared/file-links";

function linkPath(href: string) {
  if (typeof href !== "string" || !isFileLink(href))
    throw new Error("Not a local file link.");
  if (/^file:\/\//i.test(href)) {
    const url = new URL(href);
    if (url.hostname) throw new Error("Not a local file URL.");
    return fileURLToPath(url);
  }
  const path = decodeURIComponent(href.split(/[?#]/, 1)[0]);
  // Some Markdown producers write Windows destinations as /C:/...
  return process.platform === "win32"
    ? path.replace(/^\/([a-z]:[\\/])/i, "$1")
    : path;
}

export async function revealPath(
  input: FileReveal,
  shell: {
    showItemInFolder(path: string): void;
    openPath(path: string): boolean;
  },
  validateScope: (cwd: string) => Promise<void>,
) {
  const path = "href" in input ? linkPath(input.href) : input.path;
  const cwd = "href" in input ? input.cwd : undefined;
  if (
    typeof path !== "string" ||
    !path ||
    /[\p{Cc}]/u.test(path) ||
    ("href" in input && /^[\\/]{2}/.test(path)) ||
    (process.platform === "win32" &&
      (/^\\\\[?.][\\/]/.test(path) ||
        /[:<>"|?*]/.test(path.replace(/^[a-z]:[\\/]/i, "")))) ||
    (!isAbsolute(path) && !cwd)
  )
    throw new Error("Not a local file path.");
  if (cwd !== undefined) await validateScope(cwd);

  // Reveal the file without launching it. A missing file leads to its folder.
  const requested = resolve(cwd ?? "", path);
  for (let target = requested; ; target = dirname(target)) {
    const info = await stat(target).catch((error) => {
      if (error.code !== "ENOENT" && error.code !== "ENOTDIR") throw error;
      return undefined;
    });
    if (target === requested && info?.isFile())
      return shell.showItemInFolder(target);
    if (info?.isDirectory()) {
      if (!shell.openPath(target))
        throw new Error("Could not open the folder.");
      return;
    }
    if (dirname(target) === target) throw new Error("File folder not found.");
  }
}
