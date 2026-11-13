import { type en, ja } from "../shared/i18n";
import { type ActionId, actionIds } from "../shared/keymap";
import type { SettingsCategory } from "./store";

type Dictionary = typeof en;
export type TextKey = {
  [K in keyof Dictionary]: Dictionary[K] extends string ? K : never;
}[keyof Dictionary];

/** Labels shared by the keyboard settings and the search palette. */
export const actionLabels: Record<ActionId, TextKey> = {
  "appearance.toggleBackdrop": "Toggle backdrop",
  "navigation.back": "Back",
  "navigation.forward": "Forward",
  "settings.open": "Open settings",
  "search.open": "Search everything",
  "pane.splitRows": "paneSplitRows",
  "pane.splitColumns": "paneSplitColumns",
  "pane.close": "paneClose",
  "pane.left": "paneLeft",
  "pane.right": "paneRight",
  "pane.up": "paneUp",
  "pane.down": "paneDown",
  "composer.queue": "Queue follow-up",
  "composer.steer": "Steer response",
  "composer.newline": "Insert newline",
};

export const settingsCategories: { id: SettingsCategory; label: TextKey }[] = [
  { id: "general", label: "General" },
  { id: "appearance", label: "Appearance" },
  { id: "keyboard", label: "Keyboard shortcuts" },
  { id: "updates", label: "appUpdateTitle" },
];

/**
 * Settings reachable from the search palette. `id` is the element's
 * `data-setting`; settings-search.test.tsx checks every id is rendered.
 */
export const settingTargets: {
  id: string;
  category: SettingsCategory;
  label: TextKey;
}[] = [
  { id: "default-model", category: "general", label: "Default model" },
  { id: "language", category: "general", label: "Language" },
  { id: "agent-shell", category: "general", label: "Agent shell" },
  { id: "block-images", category: "general", label: "Block images" },
  { id: "context-display", category: "general", label: "Context display" },
  { id: "usage-display", category: "general", label: "usageDisplay" },
  { id: "theme-color", category: "appearance", label: "themeColor" },
  { id: "backdrop", category: "appearance", label: "Window backdrop" },
  { id: "window-opacity", category: "appearance", label: "Window opacity" },
  { id: "interface-font", category: "appearance", label: "Interface font" },
  { id: "code-font", category: "appearance", label: "Code font" },
  { id: "chat-renderers", category: "appearance", label: "Chat renderers" },
  { id: "app-update", category: "updates", label: "appUpdateTitle" },
  { id: "pi-data", category: "updates", label: "piDataTitle" },
  ...actionIds.map((action) => ({
    id: `shortcut-${action}`,
    category: "keyboard" as const,
    label: actionLabels[action],
  })),
];

/** Both languages, so English terms keep working in the Japanese UI. */
export function bilingual(key: TextKey, english: Dictionary) {
  return english[key] === ja[key] ? english[key] : `${english[key]} ${ja[key]}`;
}
