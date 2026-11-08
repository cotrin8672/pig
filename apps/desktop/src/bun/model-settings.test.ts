import { expect, test } from "bun:test";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sanitizeOverride } from "../shared/model-overrides";
import { readModelOverrides, writeModelOverride } from "./model-settings";

const fixture = async () =>
  join(
    await mkdtemp(join(process.env.PI_SCRATCH_DIR ?? tmpdir(), "models-json-")),
    "models.json",
  );

test("sanitizeOverride keeps valid fields and rejects unknown or invalid input", () => {
  expect(
    sanitizeOverride({
      name: "  fast ",
      contextWindow: 1_000_000,
      maxTokens: 64_000,
      thinkingLevelMap: { max: null, xhigh: "xhigh" },
      input: ["text", "image"],
      compat: { forceAdaptiveThinking: true },
    }),
  ).toEqual({
    name: "fast",
    contextWindow: 1_000_000,
    maxTokens: 64_000,
    thinkingLevelMap: { max: null, xhigh: "xhigh" },
    input: ["text", "image"],
    compat: { forceAdaptiveThinking: true },
  });
  expect(sanitizeOverride({})).toEqual({});
  for (const bad of [
    null,
    [],
    { baseUrl: "http://evil" },
    { name: " " },
    { contextWindow: 0 },
    { maxTokens: 1.5 },
    { thinkingLevelMap: { turbo: "x" } },
    { input: ["image"] },
    { compat: { thinkingFormat: "qwen" } },
  ])
    expect(() => sanitizeOverride(bad)).toThrow();
});

test("writeModelOverride edits one entry and preserves the rest of models.json", async () => {
  const file = await fixture();
  await writeFile(
    file,
    JSON.stringify({
      providers: {
        local: { baseUrl: "http://localhost", models: [{ id: "m" }] },
        anthropic: { modelOverrides: { other: { name: "Other" } } },
      },
    }),
  );
  await writeModelOverride("anthropic", "a", { maxTokens: 1000 }, file);
  await writeModelOverride("openai", "b", { name: "B" }, file);
  expect(await readModelOverrides(file)).toEqual({
    "anthropic/other": { name: "Other" },
    "anthropic/a": { maxTokens: 1000 },
    "openai/b": { name: "B" },
  });
  await writeModelOverride("openai", "b", {}, file);
  const json = JSON.parse(await readFile(file, "utf8"));
  expect(json.providers.openai).toBeUndefined();
  expect(json.providers.local).toEqual({
    baseUrl: "http://localhost",
    models: [{ id: "m" }],
  });
});

test("JSONC models.json is never rewritten", async () => {
  const file = await fixture();
  const original = '{\n  // keep me\n  "providers": {}\n}\n';
  await writeFile(file, original);
  await expect(
    writeModelOverride("x", "y", { name: "Y" }, file),
  ).rejects.toThrow("not plain JSON");
  expect(await readFile(file, "utf8")).toBe(original);
});
