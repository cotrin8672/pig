import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DefaultModel } from "../shared/rpc-schema";
import { readDefaultModel, writeDefaultModel } from "./default-model";

const model = { provider: "openai-codex", id: "gpt-6.1-sol" };

test("default model persists in pi settings, survives reload and resets without losing other settings", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pig-default-model-"));
  const file = join(directory, "settings.json");
  try {
    expect(readDefaultModel(directory)).toBeNull();
    const other = {
      packages: ["npm:example"],
      modelThinkingLevels: { a: "high" },
    };
    await writeFile(file, JSON.stringify(other));
    expect(await writeDefaultModel(model, [model], directory)).toEqual(model);
    expect(readDefaultModel(directory)).toEqual(model);
    expect(JSON.parse(await readFile(file, "utf8"))).toEqual({
      ...other,
      defaultProvider: model.provider,
      defaultModel: model.id,
    });
    expect(await writeDefaultModel(null, [], directory)).toBeNull();
    expect(readDefaultModel(directory)).toBeNull();
    expect(JSON.parse(await readFile(file, "utf8"))).toMatchObject(other);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("invalid, unknown and disabled default models never change the settings file", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pig-default-model-"));
  const file = join(directory, "settings.json");
  try {
    const original = '{"theme":"dark"}';
    await writeFile(file, original);
    for (const invalid of [undefined, {}, { provider: 1, id: "x" }, model]) {
      await expect(
        writeDefaultModel(invalid as DefaultModel, [], directory),
      ).rejects.toThrow("available, enabled");
      expect(await readFile(file, "utf8")).toBe(original);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("corrupt pi settings are reported and preserved rather than overwritten", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pig-default-model-"));
  const file = join(directory, "settings.json");
  try {
    const original = '{"packages":';
    await writeFile(file, original);
    expect(() => readDefaultModel(directory)).toThrow();
    await expect(
      writeDefaultModel(model, [model], directory),
    ).rejects.toThrow();
    expect(await readFile(file, "utf8")).toBe(original);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
