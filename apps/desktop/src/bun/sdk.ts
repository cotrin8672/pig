import type { CredentialStore } from "@earendil-works/pi-ai";

// shortcut: SDK 1.5.2's AuthStorage is private; recheck this path on SDK upgrades.
export const { AuthStorage } = (await import(
  new URL(
    "./core/auth-storage.js",
    import.meta.resolve("@earendil-works/pi-coding-agent"),
  ).href
)) as { AuthStorage: { create(path?: string): CredentialStore } };

export const {
  ModelRuntime,
  SessionManager,
  SettingsManager,
  DefaultResourceLoader,
  createAgentSessionRuntime,
  createEventBus,
  createAgentSessionServices,
  createAgentSessionFromServices,
  createBashTool,
  createPowerShellTool,
  createReadTool,
  createEditTool,
  createWriteTool,
  createBashToolDefinition,
  createPowerShellToolDefinition,
  resizeImage,
  formatDimensionNote,
  defineTool,
  Theme,
  initTheme,
  getAgentDir,
  loadSkillsFromDir,
  createSyntheticSourceInfo,
} = await import("@earendil-works/pi-coding-agent");
