import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { addMiseNodeToPath } from "./mise-node-path";

const windows = process.platform === "win32";
const node = windows ? "node.exe" : "node";
const mise = windows ? "mise.exe" : "mise";
const key = windows ? "Path" : "PATH";
let home: string;
let tools: string;
let installed: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "pig mise "));
  tools = join(home, "tools");
  installed = join(home, "installed node");
  for (const dir of [tools, installed]) mkdirSync(dir);
  writeFileSync(join(installed, node), "", { mode: 0o755 });
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

test("appends only the mise Node directory and skips the lookup once Node is on PATH", async () => {
  const misePath = join(tools, mise);
  writeFileSync(misePath, "", { mode: 0o755 });
  const env = { [key]: tools };
  const resolveNode = mock(async () => `${join(installed, node)}\r\n`);

  await addMiseNodeToPath(env, home, resolveNode);
  expect(env).toEqual({ [key]: `${tools}${delimiter}${installed}` });
  expect(resolveNode).toHaveBeenCalledWith(misePath, {
    cwd: home,
    env: {
      [key]: tools,
      MISE_AUTO_INSTALL: "false",
      MISE_NOT_FOUND_AUTO_INSTALL: "false",
      MISE_OFFLINE: "true",
      MISE_YES: "false",
    },
  });

  await addMiseNodeToPath(env, home, resolveNode);
  expect(resolveNode).toHaveBeenCalledTimes(1);
});

test("leaves PATH unchanged when mise is missing", async () => {
  const env = { [key]: tools };
  const resolveNode = mock(async () => join(installed, node));
  await addMiseNodeToPath(env, home, resolveNode);
  expect(resolveNode).not.toHaveBeenCalled();
  expect(env[key]).toBe(tools);
});

test("ignores failed mise lookups and invalid or missing Node paths", async () => {
  writeFileSync(join(tools, mise), "", { mode: 0o755 });
  const env = { [key]: tools };
  await addMiseNodeToPath(env, home, async () => {
    throw new Error("mise failed");
  });
  for (const invalid of [node, join(tools, node), `${installed}\n${node}`]) {
    await addMiseNodeToPath(env, home, async () => invalid);
  }
  expect(env[key]).toBe(tools);
});
