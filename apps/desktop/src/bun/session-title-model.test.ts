import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DefaultModel } from "../shared/rpc-schema";
import { writeDefaultModel } from "./default-model";
import {
  readSessionTitleModel,
  writeSessionTitleModel,
} from "./session-title-model";

const namespace = "archimedes.sessionName";
const title = { provider: "openrouter", id: "vendor/small:free" };
const reference = "openrouter/vendor/small:free";

test("title model is saved in the Pi profile independently of the chat model and resets only its own key", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pig-session-title-"));
  const file = join(dir, "settings.json");
  try {
    expect(await readSessionTitleModel(dir)).toBeNull();
    const other = {
      packages: ["npm:@pi-archimedes/session-name"],
      [namespace]: { reasoning: "low" },
    };
    await writeFile(file, JSON.stringify(other));
    expect(await writeSessionTitleModel(title, [title], dir)).toBe(reference);
    expect(await readSessionTitleModel(dir)).toBe(reference);

    const chat = { provider: "openai-codex", id: "chat" };
    await writeDefaultModel(chat, [chat], dir);
    expect(JSON.parse(await readFile(file, "utf8"))).toEqual({
      ...other,
      defaultProvider: chat.provider,
      defaultModel: chat.id,
      [namespace]: { reasoning: "low", model: reference },
    });

    expect(await writeSessionTitleModel(null, [], dir)).toBeNull();
    expect(await readSessionTitleModel(dir)).toBeNull();
    expect(JSON.parse(await readFile(file, "utf8"))).toEqual({
      ...other,
      defaultProvider: chat.provider,
      defaultModel: chat.id,
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("an unavailable selection, invalid settings or JSONC cannot overwrite the shared profile", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pig-session-title-"));
  const file = join(dir, "settings.json");
  try {
    const original = '{"packages":["npm:@pi-archimedes/session-name"]}';
    await writeFile(file, original);
    for (const invalid of [undefined, {}, title]) {
      await expect(
        writeSessionTitleModel(invalid as DefaultModel, [], dir),
      ).rejects.toThrow("available, enabled");
      expect(await readFile(file, "utf8")).toBe(original);
    }
    for (const malformed of [
      '{"archimedes.sessionName":',
      '{"archimedes.sessionName":[]}',
      '{/* important comment */ "packages": []}',
    ]) {
      await writeFile(file, malformed);
      await expect(writeSessionTitleModel(title, [title], dir)).rejects.toThrow(
        namespace,
      );
      expect(await readFile(file, "utf8")).toBe(malformed);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
