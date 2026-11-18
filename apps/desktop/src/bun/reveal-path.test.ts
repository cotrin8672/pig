import { expect, test } from "bun:test";
import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { revealPath } from "./reveal-path";
import { validateSessionScope } from "./session-scope";

test("Markdown links reveal the exact file from their chat folder, without opening the file itself", async () => {
  const cwd = await realpath(await mkdtemp(join(tmpdir(), "pig-reveal-")));
  try {
    const folder = join(cwd, "docs");
    await mkdir(folder);
    const name = "手順 100% #1.md";
    const file = join(folder, name);
    await Bun.write(file, "report");
    const selected: string[] = [];
    const opened: string[] = [];
    const shell = {
      showItemInFolder: (path: string) => selected.push(path),
      openPath: (path: string) => {
        opened.push(path);
        return true;
      },
    };
    const validate = (dir: string) => validateSessionScope(dir, [cwd], "");

    const href = pathToFileURL(file);
    await revealPath(
      { href: `docs/${encodeURIComponent(name)}#L8`, cwd },
      shell,
      validate,
    );
    await revealPath({ href: href.href }, shell, validate);
    await revealPath({ href: href.pathname, cwd }, shell, validate);
    if (process.platform === "win32") {
      await revealPath({ href: href.pathname.slice(1) }, shell, validate);
      await revealPath(
        { href: href.pathname.slice(1).replaceAll("/", "%5C") },
        shell,
        validate,
      );
    }
    await revealPath({ path: file }, shell, validate);
    expect(selected).toEqual(
      Array(process.platform === "win32" ? 6 : 4).fill(file),
    );

    await revealPath({ href: "docs/", cwd }, shell, validate);
    await revealPath({ href: "docs/deleted.md", cwd }, shell, validate);
    expect(opened).toEqual([folder, folder]);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("unscoped relative links, non-file schemes and malformed paths never reach the file manager", async () => {
  const opened: string[] = [];
  const shell = {
    showItemInFolder: (path: string) => opened.push(path),
    openPath: (path: string) => {
      opened.push(path);
      return true;
    },
  };
  const validate = (dir: string) => validateSessionScope(dir, [], "");
  for (const input of [
    { href: "docs/note.md" },
    { href: "docs/note.md", cwd: tmpdir() },
    { href: "https://example.com/docs" },
    { href: "file://example.com/share/file.md" },
    { href: "//example.com/docs" },
    { href: "%5C%5Cexample.com%5Cdocs" },
    { href: "docs/a%00.md" },
    { href: "docs/a%xx.md" },
    { path: "docs/note.md" },
  ])
    await expect(revealPath(input, shell, validate)).rejects.toThrow();
  expect(opened).toEqual([]);
});
