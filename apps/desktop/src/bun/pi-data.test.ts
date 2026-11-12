import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Subprocess: the agent dir is resolved once at import from HOME/env.
test("legacy pig profile is inventoried read-only and imported copy-only", async () => {
  const home = await mkdtemp(join(tmpdir(), "pig-pi-data-"));
  try {
    const script = `
      import { expect } from "bun:test";
      import { mkdir, readFile, writeFile } from "node:fs/promises";
      import { join } from "node:path";
      const home = ${JSON.stringify(home)};
      const legacy = join(home, ".config/pig/pi-agent"), standard = join(home, ".pi/agent");
      const cwdDir = "--fixture--";
      await mkdir(join(legacy, "sessions", cwdDir), { recursive: true });
      await mkdir(join(standard, "sessions", cwdDir), { recursive: true });
      const header = (id) => JSON.stringify({ type: "session", id, cwd: home }) + "\\n";
      await writeFile(join(legacy, "auth.json"), JSON.stringify({ a: { type: "api_key", key: "legacy-a" }, b: { type: "api_key", key: "legacy-b" } }));
      await writeFile(join(standard, "auth.json"), JSON.stringify({ b: { type: "api_key", key: "standard-b" } }));
      await writeFile(join(legacy, "sessions", cwdDir, "1_new.jsonl"), header("new"));
      await writeFile(join(legacy, "sessions", cwdDir, "2_diff.jsonl"), header("diff"));
      await writeFile(join(standard, "sessions", cwdDir, "2_diff.jsonl"), header("diff") + "{}\\n");
      await writeFile(join(legacy, "sessions", cwdDir, "3_bad.jsonl"), "not json");
      const before = await readFile(join(legacy, "auth.json"), "utf8");
      const data = await import(${JSON.stringify(new URL("./pi-data.ts", import.meta.url).href)});
      const report = await data.piDataReport();
      expect(report.agentDir).toBe(standard);
      expect(report.agentDirSource).toBe("default");
      expect(report.legacyAuth[0]).toMatchObject({ state: "ok", missing: ["a"], conflict: ["b"] });
      expect(JSON.stringify(report)).not.toContain("legacy-a");
      expect(report.legacySessions).toMatchObject({ state: "ok", missing: 1, conflict: 1, invalid: 1 });
      await expect(data.importLegacyAuth(join(home, "elsewhere.json"), ["a"])).rejects.toThrow("Unknown");
      expect(await data.importLegacyAuth(join(legacy, "auth.json"), ["a", "b"])).toEqual({ copied: 1, skipped: 1 });
      const auth = JSON.parse(await readFile(join(standard, "auth.json"), "utf8"));
      expect(auth.a.key).toBe("legacy-a");
      expect(auth.b.key).toBe("standard-b");
      expect(await data.importLegacySessions()).toEqual({ copied: 1, skipped: 1 });
      expect(await readFile(join(standard, "sessions", cwdDir, "2_diff.jsonl"), "utf8")).toBe(header("diff") + "{}\\n");
      expect(await readFile(join(standard, "sessions", cwdDir, "1_new.jsonl"), "utf8")).toBe(header("new"));
      expect(await data.importLegacySessions()).toEqual({ copied: 0, skipped: 2 });
      expect(await readFile(join(legacy, "auth.json"), "utf8")).toBe(before);
    `;
    const env: Record<string, string | undefined> = {
      ...process.env,
      HOME: home,
      USERPROFILE: home,
    };
    delete env.PI_CODING_AGENT_DIR;
    delete env.PI_CODING_AGENT_SESSION_DIR;
    const child = Bun.spawn([process.execPath, "--eval", script], {
      cwd: join(import.meta.dir, "../.."),
      env,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [code, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    expect({ code, stdout, stderr }).toMatchObject({ code: 0 });
  } finally {
    await rm(home, { recursive: true, force: true });
  }
}, 30_000);
