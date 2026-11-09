import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultSettings, patchSettings } from "../shared/settings";
import { loadSettings, saveSettings } from "./settings";

test("missing and corrupt settings default without overwriting; valid saves round trip", async () => {
  const directory = await mkdtemp(
    join(process.env.PI_SCRATCH_DIR ?? tmpdir(), "pig-settings-"),
  );
  const file = join(directory, "settings.json");
  try {
    expect(await loadSettings(file)).toEqual(defaultSettings);
    await writeFile(file, "{broken");
    expect(await loadSettings(file)).toEqual(defaultSettings);
    expect(await readFile(file, "utf8")).toBe("{broken");
    await writeFile(file, JSON.stringify({ language: "xx" }));
    expect(await loadSettings(file)).toEqual(defaultSettings);
    const old = {
      language: "ja",
      contextDisplay: "used",
      keybindings: { "settings.open": null },
    } as const;
    await writeFile(file, JSON.stringify(old));
    expect(await loadSettings(file)).toEqual({
      ...old,
      shell: "git-bash",
      blockImages: false,
      imageGenerationModel: null,
      decisionModel: null,
    });
    const next = patchSettings(defaultSettings, {
      language: "ja",
      contextDisplay: "used",
      shell: "powershell",
      blockImages: true,
      keybindings: { "settings.open": null },
      imageGenerationModel: { provider: "disconnected-image", id: "image-1" },
      decisionModel: { provider: "typesafe", id: "jev-latest" },
    });
    await saveSettings(file, next);
    expect(await loadSettings(file)).toEqual(next);
    const cleared = patchSettings(next, {
      imageGenerationModel: null,
      decisionModel: null,
    });
    await saveSettings(file, cleared);
    expect(await loadSettings(file)).toEqual(cleared);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
