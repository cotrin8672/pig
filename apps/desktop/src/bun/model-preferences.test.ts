import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ModelPreferences } from "./model-preferences";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});
async function fixture() {
  const directory = await mkdtemp(
    join(process.env.PI_SCRATCH_DIR ?? tmpdir(), "model-preferences-"),
  );
  directories.push(directory);
  return join(directory, "settings", "disabled-models.json");
}
test("defaults to all enabled and persists per-provider choices", async () => {
  const file = await fixture();
  const preferences = new ModelPreferences(file);
  await preferences.load();
  expect(preferences.disabled).toEqual([]);
  await preferences.setEnabled("anthropic", "shared-id", false);
  await preferences.setEnabled("openai-codex", "shared-id", false);
  await preferences.setEnabled("anthropic", "shared-id", true);
  const reloaded = new ModelPreferences(file);
  await reloaded.load();
  expect(reloaded.disabled).toEqual(["openai-codex/shared-id"]);
});
test("serializes concurrent writes without losing other models", async () => {
  const file = await fixture();
  const preferences = new ModelPreferences(file);
  await Promise.all([
    preferences.setEnabled("anthropic", "a", false),
    preferences.setEnabled("anthropic", "b", false),
    preferences.setEnabled("anthropic", "a", false),
  ]);
  expect(JSON.parse(await readFile(file, "utf8"))).toEqual([
    "anthropic/b",
    "anthropic/a",
  ]);
});
test("rejects corrupt preferences without overwriting them", async () => {
  const file = await fixture();
  await mkdir(join(file, ".."), { recursive: true });
  await writeFile(file, "{}");
  await expect(new ModelPreferences(file).load()).rejects.toThrow(
    "Invalid model preferences",
  );
  expect(await readFile(file, "utf8")).toBe("{}");
});
test("failed writes preserve current state and do not poison queue", async () => {
  const file = await fixture();
  const blocker = join(file, "..");
  await writeFile(blocker, "not a directory");
  const preferences = new ModelPreferences(file);
  await expect(
    preferences.setEnabled("anthropic", "a", false),
  ).rejects.toThrow();
  expect(preferences.disabled).toEqual([]);
  await rm(blocker);
  await preferences.setEnabled("anthropic", "b", false);
  expect(preferences.disabled).toEqual(["anthropic/b"]);
});

test("bulk visibility updates are atomic and preserve other providers", async () => {
  const preferences = new ModelPreferences(await fixture());
  await preferences.setEnabled("anthropic", "keep", false);
  await preferences.setManyEnabled("openai-codex", ["a", "b", "a"], false);
  expect(preferences.disabled).toEqual([
    "anthropic/keep",
    "openai-codex/a",
    "openai-codex/b",
  ]);
  await preferences.setManyEnabled("openai-codex", ["a", "b"], true);
  expect(preferences.disabled).toEqual(["anthropic/keep"]);
});
test("bulk and individual writes can run concurrently without lost changes", async () => {
  const preferences = new ModelPreferences(await fixture());
  await Promise.all([
    preferences.setManyEnabled("openai-codex", ["a", "b"], false),
    preferences.setEnabled("anthropic", "c", false),
    preferences.setEnabled("openai-codex", "b", true),
  ]);
  expect(preferences.disabled).toEqual(["openai-codex/a", "anthropic/c"]);
});
