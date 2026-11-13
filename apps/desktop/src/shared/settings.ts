import { actionIds, type KeyOverrides, normalizeCombo } from "./keymap";

export interface UtilityModelSelection {
  provider: string;
  id: string;
}

export interface Settings {
  language: "en" | "ja";
  contextDisplay: "remaining" | "used";
  usageDisplay: "remaining" | "used";
  shell: "git-bash" | "powershell";
  blockImages: boolean;
  fontFamily: string;
  codeFontFamily: string;
  keybindings: KeyOverrides;
  imageGenerationModel: UtilityModelSelection | null;
  classificationModel: UtilityModelSelection | null;
}
export type SettingsPatch = Partial<Settings>;
export const defaultSettings: Settings = {
  language: "en",
  contextDisplay: "remaining",
  usageDisplay: "remaining",
  shell: "git-bash",
  blockImages: false,
  fontFamily: "",
  codeFontFamily: "",
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
  const usageDisplay =
    input.usageDisplay === undefined ? "remaining" : input.usageDisplay;
  const shell = input.shell ?? "git-bash";
  const blockImages = input.blockImages ?? false;
  if (
    !["en", "ja"].includes(language) ||
    !["git-bash", "powershell"].includes(shell) ||
    typeof blockImages !== "boolean" ||
    !["remaining", "used"].includes(contextDisplay) ||
    !["remaining", "used"].includes(usageDisplay)
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
      // Ignore the removed send shortcut without discarding the rest of saved settings.
      if (action === "composer.send") continue;
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
    usageDisplay,
    shell,
    blockImages,
    fontFamily: validateFontFamily(input.fontFamily),
    codeFontFamily: validateFontFamily(input.codeFontFamily),
    keybindings,
    imageGenerationModel: validateModelSelection(input.imageGenerationModel),
    classificationModel: validateModelSelection(input.classificationModel),
  };
}
function validateFontFamily(value: unknown): string {
  if (value === undefined) return "";
  if (
    typeof value !== "string" ||
    value.length > 256 ||
    // biome-ignore lint/suspicious/noControlCharactersInRegex: Reject control characters in saved CSS family names.
    /[\u0000-\u001f\u007f]/.test(value)
  )
    throw new Error("Invalid font family.");
  return value.trim();
}

export function patchSettings(
  current: Settings,
  patch: SettingsPatch,
): Settings {
  return validateSettings({ ...current, ...patch });
}
