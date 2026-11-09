import { expect, test } from "bun:test";
import { defaultSettings, patchSettings, validateSettings } from "./settings";

test("settings defaults and patches validate enums and normalize overrides", () => {
  expect(validateSettings({})).toEqual(defaultSettings);
  const settings = patchSettings(defaultSettings, {
    language: "ja",
    keybindings: { "settings.open": "shift+ctrl+s", "navigation.back": null },
  });
  expect(settings.keybindings).toEqual({
    "settings.open": "Ctrl+Shift+S",
    "navigation.back": null,
  });
  expect(patchSettings(settings, { contextDisplay: "used" }).language).toBe(
    "ja",
  );
  expect(patchSettings(settings, { keybindings: {} }).keybindings).toEqual({});
  for (const value of [
    null,
    [],
    { language: "fr" },
    { contextDisplay: "total" },
    { shell: "cmd" },
    { blockImages: "true" },
    { keybindings: [] },
    { keybindings: { bad: "Ctrl+B" } },
    { keybindings: { "settings.open": "Mod+B" } },
  ])
    expect(() => validateSettings(value)).toThrow();
});

test("utility selections validate independently, preserve settings, and clear", () => {
  const old = {
    language: "ja",
    contextDisplay: "used",
    keybindings: {},
  } as const;
  expect(validateSettings(old)).toEqual({
    ...old,
    shell: "git-bash",
    blockImages: false,
    imageGenerationModel: null,
    decisionModel: null,
  });
  const imageGenerationModel = {
    provider: "unavailable-provider",
    id: "image-1",
  };
  const decisionModel = { provider: "typesafe", id: "jev-latest" };
  const selected = patchSettings(validateSettings(old), {
    imageGenerationModel,
    decisionModel,
  });
  expect(selected).toEqual({
    ...old,
    shell: "git-bash",
    blockImages: false,
    imageGenerationModel,
    decisionModel,
  });
  expect(patchSettings(selected, { language: "en" })).toEqual({
    ...selected,
    language: "en",
  });
  expect(patchSettings(selected, { imageGenerationModel: null })).toEqual({
    ...selected,
    imageGenerationModel: null,
  });
  expect(patchSettings(selected, { decisionModel: null })).toEqual({
    ...selected,
    decisionModel: null,
  });
  for (const field of ["imageGenerationModel", "decisionModel"]) {
    for (const value of [
      false,
      "model",
      [],
      {},
      { provider: "p" },
      { id: "m" },
      { provider: "", id: "m" },
      { provider: "p", id: " " },
      { provider: 1, id: "m" },
      { provider: "p", id: 1 },
      { provider: "p", id: "m", headers: {} },
    ]) {
      expect(() => validateSettings({ [field]: value })).toThrow();
    }
  }
});

test("shell and image blocking patches preserve other settings", () => {
  const selected = patchSettings(defaultSettings, {
    shell: "powershell",
    blockImages: true,
  });
  expect(selected).toEqual({
    ...defaultSettings,
    shell: "powershell",
    blockImages: true,
  });
  expect(patchSettings(selected, { language: "ja" }).shell).toBe("powershell");
});
