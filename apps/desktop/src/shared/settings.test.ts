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
