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
      const oracle = async () => (await SessionManager.list(cwd)).filter(info=>sameSessionPath(info.cwd,cwd)).map(info=>({id:info.id,cwd,title:info.name??info.firstMessage??"New chat",modified:info.modified.getTime()}));
      expect(listed).toEqual(await oracle());
      // Compare SDK listing semantics, without opening/migrating any file.
      const original = lines.join("\\n");
      const entry = message => JSON.stringify({type:"message",timestamp:"2026-01-02T00:00:00.000Z",message})+"\\n";
      const info = name => JSON.stringify({type:"session_info",name})+"\\n";
      for (const suffix of [
        info(" Named "), info("Cleared")+info("  "),
        entry({role:"user",content:[{type:"text",text:"Second"},{type:"text",text:"question"}],timestamp:100}),
        entry({role:"assistant",content:[{type:"text",text:"Answer"}],timestamp:999999}),
        entry({role:"toolResult",content:[{type:"text",text:"Not activity"}],timestamp:999999999}),
        "incomplete JSON", "\\n"+info("日本語"),
      ]) {
        await writeFile(file,original+suffix);
        expect(await listSessionFiles(cwd)).toEqual(await oracle());
        expect(await readFile(file,"utf8")).toBe(original+suffix);
      }
      await writeFile(file,original);
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
      const previousDir = process.env.PI_CODING_AGENT_SESSION_DIR;
      const alternate = join(${JSON.stringify(home)}, "alternate-sessions");
      await mkdir(alternate);
      await writeFile(join(alternate,"alternate.jsonl"),JSON.stringify({...header,id:"alternate-id",cwd})+"\\n"+entry({role:"user",content:"Alternate directory",timestamp:42}));
      process.env.PI_CODING_AGENT_SESSION_DIR = alternate;
      expect(await listSessionFiles(cwd)).toEqual([{id:"alternate-id",cwd,title:"Alternate directory",modified:42}]);
      if (previousDir === undefined) delete process.env.PI_CODING_AGENT_SESSION_DIR;
      else process.env.PI_CODING_AGENT_SESSION_DIR = previousDir;
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
