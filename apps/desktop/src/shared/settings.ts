import { actionIds, type KeyOverrides, normalizeCombo } from "./keymap";

export interface UtilityModelSelection {
  provider: string;
  id: string;
}

export interface Settings {
  language: "en" | "ja";
  contextDisplay: "remaining" | "used";
  keybindings: KeyOverrides;
  imageGenerationModel: UtilityModelSelection | null;
  classificationModel: UtilityModelSelection | null;
}
export type SettingsPatch = Partial<Settings>;
export const defaultSettings: Settings = {
  language: "en",
  contextDisplay: "remaining",
  keybindings: {},
  imageGenerationModel: null,
  classificationModel: null,
};
function validateModelSelection(value: unknown): UtilityModelSelection | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid utility model selection.");
  const { provider, id } = value as UtilityModelSelection;
  if (
    typeof provider !== "string" ||
    !provider.trim() ||
    typeof id !== "string" ||
    !id.trim() ||
    Object.keys(value).some((key) => key !== "provider" && key !== "id")
  )
    throw new Error("Invalid utility model selection.");
  return { provider, id };
}
export function validateSettings(value: unknown): Settings {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid settings.");
  const input = value as Partial<Settings>;
  const language = input.language === undefined ? "en" : input.language;
  const contextDisplay =
    input.contextDisplay === undefined ? "remaining" : input.contextDisplay;
  if (
    !["en", "ja"].includes(language) ||
    !["remaining", "used"].includes(contextDisplay)
  )
    throw new Error("Invalid settings.");
  const keybindings: KeyOverrides = {};
  if (input.keybindings !== undefined) {
    if (
      !input.keybindings ||
      typeof input.keybindings !== "object" ||
      Array.isArray(input.keybindings)
    )
      throw new Error("Invalid keybindings.");
    for (const [action, combo] of Object.entries(input.keybindings)) {
      if (
        !actionIds.includes(action as (typeof actionIds)[number]) ||
        (combo !== null &&
          (typeof combo !== "string" || !normalizeCombo(combo)))
      )
        throw new Error("Invalid keybinding.");
      keybindings[action as (typeof actionIds)[number]] =
        combo === null ? null : normalizeCombo(combo);
    }
  }
  return {
    language,
    contextDisplay,
    keybindings,
    imageGenerationModel: validateModelSelection(input.imageGenerationModel),
    classificationModel: validateModelSelection(input.classificationModel),
  };
}
export function patchSettings(
  current: Settings,
  patch: SettingsPatch,
): Settings {
  return validateSettings({ ...current, ...patch });
}
