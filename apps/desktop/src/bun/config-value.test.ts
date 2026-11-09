import { Database } from "bun:sqlite";
import { afterEach, expect, mock, spyOn, test } from "bun:test";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as executor from "./command-executor";
import { resolveSavedValue } from "./config-value";
import * as shells from "./shell-paths";

const directories: string[] = [];
afterEach(async () => {
  mock.restore();
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});

test("literal saved values never resolve a shell or execute, and reject ambient env auth", async () => {
  const run = spyOn(executor, "runCommand");
  const shell = spyOn(shells, "resolveGitBash");
  expect(await resolveSavedValue("literal-value")).toBe("literal-value");
  expect(await resolveSavedValue("$$literal-$!value")).toBe("$literal-!value");
  for (const value of [
    "$OPENAI_API_KEY",
    `\${OPENAI_API_KEY}`,
    "prefix-$TOKEN",
  ])
    await expect(resolveSavedValue(value)).rejects.toThrow(
      "Environment references in saved configuration are disabled",
    );
  expect(run).not.toHaveBeenCalled();
  expect(shell).not.toHaveBeenCalled();
});

test("saved command source is stdin-only with portable Bash/sh, timeout and cancellation", async () => {
  const shell = spyOn(shells, "resolveGitBash").mockReturnValue(
    "D:\\PortableGit\\usr\\bin\\bash.exe",
  );
  const run = spyOn(executor, "runCommand").mockResolvedValue({
    stdout: " \n resolved-value\r\n ",
    stderr: "ignored diagnostics",
    exitCode: 0,
  });
  const controller = new AbortController();
  const command = "printf '%s' 'private-token' | cat";
  expect(await resolveSavedValue(`!${command}`, controller.signal)).toBe(
    "resolved-value",
  );
  expect(run.mock.calls).toEqual([
    [
      process.platform === "win32"
        ? "D:\\PortableGit\\usr\\bin\\bash.exe"
        : "/bin/sh",
      ["-s"],
      { input: `${command}\n`, timeout: 10_000, signal: controller.signal },
    ],
  ]);
  expect(JSON.stringify(run.mock.calls[0].slice(0, 2))).not.toContain(
    "private-token",
  );
  expect(shell).toHaveBeenCalledTimes(process.platform === "win32" ? 1 : 0);
});

test("saved command failures are generic with no secret error cause or output", async () => {
  spyOn(shells, "resolveGitBash").mockReturnValue("fixture-bash");
  const run = spyOn(executor, "runCommand");
  const errorLog = spyOn(console, "error").mockImplementation(() => {});
  const warning = spyOn(console, "warn").mockImplementation(() => {});
  const log = spyOn(console, "log").mockImplementation(() => {});
  for (const result of [
    { stdout: "private-output", stderr: "private-stderr", exitCode: 2 },
    { stdout: "  \n", stderr: "private-stderr", exitCode: 0 },
  ]) {
    run.mockResolvedValueOnce(result);
    const error = await resolveSavedValue("!private-source").catch(
      (value: Error) => value,
    );
    expect((error as Error).message).toBe(
      "Failed to resolve saved credential/configuration command",
    );
    expect((error as Error).cause).toBeUndefined();
    expect(Bun.inspect(error)).not.toContain("private-");
  }
  run.mockRejectedValueOnce(
    Object.assign(new Error("private-source private-output"), {
      cause: new Error("private-token"),
    }),
  );
  await expect(resolveSavedValue("!private-source")).rejects.toThrow(
    "Failed to resolve saved credential/configuration command",
  );
  expect(errorLog).not.toHaveBeenCalled();
  expect(warning).not.toHaveBeenCalled();
  expect(log).not.toHaveBeenCalled();
});

test("cancelled saved values do not execute or expose the abort reason", async () => {
  const run = spyOn(executor, "runCommand");
  const controller = new AbortController();
  controller.abort(new Error("private-token"));
  for (const value of ["literal", "!private-source"])
    await expect(resolveSavedValue(value, controller.signal)).rejects.toThrow(
      "Saved configuration resolution cancelled",
    );
  expect(run).not.toHaveBeenCalled();
});

test.skipIf(process.platform !== "win32")(
  "missing portable Git Bash fails closed without executing",
  async () => {
    spyOn(shells, "resolveGitBash").mockReturnValue(undefined);
    const run = spyOn(executor, "runCommand");
    await expect(resolveSavedValue("!private-source")).rejects.toThrow(
      "Failed to resolve saved credential/configuration command",
    );
    expect(run).not.toHaveBeenCalled();
  },
);

test("missing RTK fails saved commands closed, without leaking source", async () => {
  const which = Bun.which;
  spyOn(Bun, "which").mockImplementation((name, options) =>
    name === "rtk" ? null : which(name, options),
  );
  await expect(resolveSavedValue("!printf private-token")).rejects.toThrow(
    "Failed to resolve saved credential/configuration command",
  );
});

test("installed RTK proxy stores neither saved source nor stdout/stderr (including failure)", async () => {
  const directory = await mkdtemp(
    join(process.env.PI_SCRATCH_DIR ?? tmpdir(), "pig-rtk-secret-"),
  );
  directories.push(directory);
  const keys = ["RTK_DB_PATH", "RTK_TEE_DIR", "RTK_TEE"] as const;
  const previous = keys.map((key) => process.env[key]);
  const database = join(directory, "history.db");
  const tee = join(directory, "tee");
  process.env.RTK_DB_PATH = database;
  process.env.RTK_TEE_DIR = tee;
  process.env.RTK_TEE = "always";
  // Synthetic marker only; this test never opens real saved credentials.
  const marker = `synthetic-private-${crypto.randomUUID()}`;
  const source = `printf '  %s\\n' '${marker}'`;
  const log = spyOn(console, "log").mockImplementation(() => {});
  const warning = spyOn(console, "warn").mockImplementation(() => {});
  const errorLog = spyOn(console, "error").mockImplementation(() => {});
  try {
    expect(await resolveSavedValue(`!${source}`)).toBe(marker);
    const error = await resolveSavedValue(
      `!${source}; printf '%s\\n' '${marker}' >&2; exit 7`,
    ).catch((value: Error) => value);
    expect((error as Error).message).toBe(
      "Failed to resolve saved credential/configuration command",
    );
    expect((error as Error).cause).toBeUndefined();
    expect(Bun.inspect(error)).not.toContain(marker);
    const db = new Database(database, { readonly: true });
    try {
      const records = db.query("SELECT * FROM commands").all();
      expect(records).toHaveLength(2);
      expect(JSON.stringify(records)).not.toContain(marker);
      expect(JSON.stringify(records)).not.toContain(source);
      for (const record of records as {
        original_cmd: string;
        rtk_cmd: string;
      }[]) {
        expect(record.original_cmd.endsWith(" -s")).toBe(true);
        expect(record.rtk_cmd.startsWith("rtk proxy ")).toBe(true);
      }
      expect(db.query("SELECT * FROM parse_failures").all()).toEqual([]);
    } finally {
      db.close();
    }
    const files = await readdir(directory, { recursive: true });
    expect(files.some((file) => file.endsWith(".log"))).toBe(false);
    expect((await readFile(database)).includes(Buffer.from(marker))).toBe(
      false,
    );
    expect(log).not.toHaveBeenCalled();
    expect(warning).not.toHaveBeenCalled();
    expect(errorLog).not.toHaveBeenCalled();
  } finally {
    keys.forEach((key, index) => {
      if (previous[index] === undefined) delete process.env[key];
      else process.env[key] = previous[index];
    });
  }
}, 10_000);
