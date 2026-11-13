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
    { usageDisplay: "total" },
    { usageDisplay: null },
    { shell: "cmd" },
    { blockImages: "true" },
    { keybindings: [] },
    { keybindings: { bad: "Ctrl+B" } },
    { keybindings: { "settings.open": "Mod+B" } },
  ])
    expect(() => validateSettings(value)).toThrow();
});

test("removed send shortcut does not reset other saved settings", () => {
  const settings = validateSettings({
    language: "ja",
    shell: "powershell",
    keybindings: { "composer.send": "Enter", "composer.steer": "Ctrl+S" },
  });
  expect(settings.language).toBe("ja");
  expect(settings.shell).toBe("powershell");
  expect(settings.keybindings).toEqual({ "composer.steer": "Ctrl+S" });
});

test("utility selections validate independently, preserve settings, and clear", () => {
  const old = {
    language: "ja",
    contextDisplay: "used",
    keybindings: {},
  } as const;
  expect(validateSettings(old)).toEqual({
    ...old,
    usageDisplay: "remaining",
    shell: "git-bash",
    blockImages: false,
    fontFamily: "",
    codeFontFamily: "",
    imageGenerationModel: null,
    classificationModel: null,
  });
  const imageGenerationModel = {
    provider: "unavailable-provider",
    id: "image-1",
  };
  const classificationModel = { provider: "typesafe", id: "jev-latest" };
  const selected = patchSettings(validateSettings(old), {
    imageGenerationModel,
    classificationModel,
  });
  expect(selected).toEqual({
    ...old,
    usageDisplay: "remaining",
    shell: "git-bash",
    blockImages: false,
    fontFamily: "",
    codeFontFamily: "",
    imageGenerationModel,
    classificationModel,
  });
  expect(patchSettings(selected, { language: "en" })).toEqual({
    ...selected,
    language: "en",
  });
  expect(patchSettings(selected, { imageGenerationModel: null })).toEqual({
    ...selected,
    imageGenerationModel: null,
  });
  expect(patchSettings(selected, { classificationModel: null })).toEqual({
    ...selected,
    classificationModel: null,
  });
  for (const field of ["imageGenerationModel", "classificationModel"]) {
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

test("font families default, normalize, validate, and reset independently", () => {
  const selected = patchSettings(defaultSettings, {
    fontFamily: "  游ゴシック  ",
    codeFontFamily: "Cascadia Code",
  });
  expect(selected.fontFamily).toBe("游ゴシック");
  expect(selected.codeFontFamily).toBe("Cascadia Code");
  expect(patchSettings(selected, { language: "ja" }).fontFamily).toBe(
    "游ゴシック",
  );
  expect(patchSettings(selected, { fontFamily: "" })).toEqual({
    ...selected,
    fontFamily: "",
  });
  for (const field of ["fontFamily", "codeFontFamily"]) {
    for (const value of [
      null,
      123,
      [],
      {},
      "x".repeat(257),
      "bad\nfont",
      "bad\u0000font",
    ])
      expect(() => validateSettings({ [field]: value })).toThrow();
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
