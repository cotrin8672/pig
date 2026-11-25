import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { CredentialStore } from "@earendil-works/pi-ai";
import "./bun-package-manager";

// Extensions relaunch Pi as `execPath argv[1]` (pi-codex-subagents); in pig
// argv[1] is the desktop host script, so point it at the bundled Pi CLI.
const piCli = fileURLToPath(
  new URL(
    "./bundle/cli.js",
    import.meta.resolve("@earendil-works/pi-coding-agent"),
  ),
);
if (existsSync(piCli)) process.argv[1] = piCli;

// shortcut: SDK 1.5.2's AuthStorage is private; recheck this path on SDK upgrades.
export const { AuthStorage } = (await import(
  new URL(
    "./core/auth-storage.js",
    import.meta.resolve("@earendil-works/pi-coding-agent"),
  ).href
)) as { AuthStorage: { create(path?: string): CredentialStore } };

export const {
  CURRENT_SESSION_VERSION,
  ModelRuntime,
  SessionManager,
  SettingsManager,
  DefaultResourceLoader,
  createAgentSessionRuntime,
  createEventBus,
  createMcpExtension,
  createCodemodeExtension,
  createToolSearchExtension,
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
