import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("session discovery reads headers only, normalizes header paths and rejects foreign ownership", async () => {
  const home = await mkdtemp(join(tmpdir(), "pig-session-files-"));
  try {
    const script = `
      import {expect} from "bun:test";
      import {mkdir, readFile, writeFile} from "node:fs/promises";
      import {existsSync} from "node:fs";
      import {join} from "node:path";
      import {SessionManager} from ${JSON.stringify(new URL("./sdk.ts", import.meta.url).href)};
      import {listSessionFiles,resolveSessionFile,removeSessionFile,sameSessionPath} from ${JSON.stringify(new URL("./session-files.ts", import.meta.url).href)};
      const cwd = join(${JSON.stringify(home)}, "project");
      await mkdir(cwd);
      expect(sameSessionPath("",process.cwd())).toBe(false);
      const manager = SessionManager.create(cwd);
      manager.appendMessage({role:"user",content:"Persisted",timestamp:1});
      const id = manager.getSessionId(), file = manager.getSessionFile();
      const lines = (await readFile(file,"utf8")).split("\\n");
      const header = JSON.parse(lines[0]);
      if (process.platform === "win32") header.cwd = cwd.replaceAll("\\\\", "/").toUpperCase();
      lines[0] = JSON.stringify(header);
      await writeFile(file, lines.join("\\n"));
      const listed = await listSessionFiles(cwd);
      expect(listed).toHaveLength(1);
      expect(listed[0]).toMatchObject({id,cwd});
      const list = SessionManager.list;
      SessionManager.list = async () => {throw new Error("Must not read transcript bodies to find a session");};
      expect(await resolveSessionFile(cwd,id)).toBe(file);
      await expect(resolveSessionFile(cwd,"missing-id")).rejects.toThrow("not found");
      for(const invalid of ["../escape", "", "123", "x/y"]) await expect(resolveSessionFile(cwd,invalid)).rejects.toThrow("Invalid SDK session ID");
      header.cwd = join(cwd,"other");
      lines[0] = JSON.stringify(header);
      await writeFile(file, lines.join("\\n"));
      await expect(resolveSessionFile(cwd,id)).rejects.toThrow("does not belong");
      await expect(removeSessionFile(cwd,id)).rejects.toThrow("does not belong");
      expect(existsSync(file)).toBe(true);
      SessionManager.list = list;
      expect(await listSessionFiles(cwd)).toHaveLength(0);
    `;
    const child = Bun.spawn([process.execPath, "--eval", script], {
      cwd: join(import.meta.dir, "../.."),
      env: { ...process.env, HOME: home, USERPROFILE: home, PI_OFFLINE: "1" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [code, out, error] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    expect(code, out + error).toBe(0);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
}, 30_000);
