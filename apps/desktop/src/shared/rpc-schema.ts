import type { AuthEvent, AuthPrompt } from "@earendil-works/pi-ai";
import type {
  SessionActionRequest,
  SessionUIState,
} from "../../../../packages/config/src";
import type {
  DesktopState,
  SessionFlags,
  UiPreferences,
} from "./desktop-state";
import type { ExtensionUIEvent, UIReply } from "./extension-ui";
import type { ModelOverride } from "./model-overrides";
import type { ProjectFlags } from "./projects";
import type {
  DraftSyncParams,
  DraftSyncResult,
  OpenSessionParams,
  OpenState,
  PromptAccepted,
  PromptParams,
  PromptReceipt,
  RuntimeEvent,
  RuntimeRecoveryState,
  RuntimeViewState,
  SendKey,
  SessionAddress,
} from "./runtime-contract";
import type { Settings, SettingsPatch } from "./settings";
import type { TerminalClientCommand, TerminalHostEvent } from "./terminal-ui";
import type { Transcript } from "./transcript";

export type { PromptAccepted } from "./runtime-contract";

export type WireEvent = {
  type: "snapshot";
  address: SessionAddress;
  snapshotSeq: number;
  transcript: Transcript;
  failure?: string;
  aborted?: boolean;
  sessionUI?: SessionUIState;
  configError?: string;
};

// Provider catalog and authentication status supplied by pi-ai.
export interface ProviderInfo {
  id: string;
  name: string;
  oauth?: { label?: string; subscription: boolean };
  // Ambient-only providers (e.g. env/ADC) have no interactive API-key login.
  apiKey: boolean;
  configured: boolean;
  // "stored", "runtime", or a human label such as an env var name.
  source?: string;
  stored: boolean;
  extension: boolean;
}
export type AuthMethod = "oauth" | "api_key";
export interface UtilityModelInfo {
  provider: string;
  id: string;
  name: string;
}
export interface ModelInfo {
  provider: string;
  id: string;
  name: string;
  contextWindow?: number;
  reasoning?: boolean;
  vision?: boolean;
  maxTokens?: number;
  // Supported levels for per-model settings (raw) and the deduped slider stops.
  thinkingLevels?: Effort[];
  effortLevels?: Effort[];
  // pi settings.json modelThinkingLevels entry, if any.
  defaultEffort?: Effort;
  effectiveDefaultEffort?: Effort;
  // Present only for anthropic-messages models, where the protocol applies.
  adaptiveThinking?: boolean;
}
export interface SessionInfo {
  id: string;
  cwd: string;
  title: string;
  modified: number;
}
export interface SessionTarget {
  cwd: string;
  id: string;
}
export interface Notice {
  kind?: "completion" | "package";
  message: string;
  level: "info" | "success" | "warning" | "error";
  session?: SessionTarget;
}
export type Effort =
  | "off"
  | "minimal"
  | "low"
  | "medium"
  | "high"
  | "xhigh"
  | "max";
export interface ContextUsage {
  tokens: number | null;
  contextWindow: number;
  percent: number | null;
}
export interface ModelSelection {
  model?: ModelInfo;
  effort: Effort;
  effortLevels: Effort[];
  contextUsage?: ContextUsage | null;
}
export interface Snapshot extends ModelSelection {
  modelCatalog?: ModelInfo[];
  /** A history preview is readable but must never grant runtime capabilities. */
  ready?: false;
  address: SessionAddress;
  snapshotSeq: number;
  info: SessionInfo;
  transcript: Transcript;
  failure?: string;
  aborted?: boolean;
  sessionUI?: SessionUIState;
  configError?: string;
}
// WezTerm-style window appearance: `opacity` stores background alpha per mode
// (0..1), `backdrop` the Windows 11 DWM system backdrop behind it.
export type Backdrop = "none" | "acrylic" | "mica";
export interface Appearance {
  backdrop: Backdrop;
  opacity: Record<Backdrop, number>;
  effect: "acrylic" | "mica";
}
export interface Bootstrap {
  projects: string[];
  generalCwd: string;
  providers: ProviderInfo[];
  models: ModelInfo[];
  imageModels: UtilityModelInfo[];
  classificationModels: UtilityModelInfo[];
  classificationProviders: string[];
  disabledModels: string[];
  // pi models.json modelOverrides keyed by modelKey.
  modelOverrides: Record<string, ModelOverride>;
  desktop: DesktopState;
}
export type LoginFrame = { loginId: string; provider: string } & (
  | { kind: "event"; event: AuthEvent }
  | { kind: "prompt"; prompt: AuthPrompt }
  | { kind: "promptEnd" }
  | { kind: "success" | "cancelled" }
  | { kind: "error"; message: string }
);

export type PackageType = "extension" | "skill" | "theme" | "prompt";
// One npm `pi-package` gallery card, mirroring https://pi.dev/packages.
export interface MarketPackage {
  name: string;
  version: string;
  description: string;
  publisher?: string;
  date: string;
  monthlyDownloads: number;
  types: PackageType[];
  npmUrl?: string;
  repoUrl?: string;
}
// One entry of the user's pi settings `packages` (npm, git or local source).
export interface InstalledPackage {
  source: string;
  scope: "user" | "project";
  name?: string;
  version?: string;
  description?: string;
  types: PackageType[];
  updateAvailable: boolean;
}
export type PackageOpStatus = {
  opId: string;
  source: string;
  action: "install" | "uninstall" | "update";
} & ({ status: "running" | "done" } | { status: "error"; message: string });

export interface SlashCommand {
  name: string;
  description?: string;
  category: "extension" | "skill" | "prompt";
}

export type RPCSchema = {
  bun: {
    requests: {
      getChatRendererBundle: {
        // biome-ignore lint/suspicious/noConfusingVoidType: Electrobun convention.
        params: void;
        response: { file: string; source: string | null; error?: string };
      };
      invokeSessionAction: {
        params: SessionAddress & SessionActionRequest;
        // biome-ignore lint/suspicious/noConfusingVoidType: Electrobun convention.
        response: void;
      };
      reloadAdapterConfig: {
        // biome-ignore lint/suspicious/noConfusingVoidType: Electrobun convention.
        params: void;
        response: { state: "pending" | "applied" | "failed" };
      };
      heartbeatUI: {
        params: { clientId: string };
        response: { connected: boolean };
      };
      searchPackages: {
        params: { query: string; page: number };
        response: { items: MarketPackage[]; total: number; pageSize: number };
      };
      // name -> https image URL (null when the package has no preview).
      packagePreviews: {
        params: { names: string[] };
        response: Record<string, string | null>;
      };
      // biome-ignore lint/suspicious/noConfusingVoidType: Electrobun's parameterless RPC convention.
      listInstalled: { params: void; response: InstalledPackage[] };
      prompt: {
        params: PromptParams;
        response: PromptAccepted;
      };
      // biome-ignore lint/suspicious/noConfusingVoidType: Electrobun's parameterless RPC convention.
      bootstrap: { params: void; response: Bootstrap };
      // biome-ignore lint/suspicious/noConfusingVoidType: Electrobun's parameterless RPC convention.
      appearance: { params: void; response: Appearance };
      // biome-ignore lint/suspicious/noConfusingVoidType: Electrobun's parameterless RPC convention.
      settings: { params: void; response: Settings };
      listSessions: { params: { cwd: string }; response: SessionInfo[] };
      renameSession: {
        params: SessionTarget & { name: string };
        response: SessionInfo;
      };
      setSessionState: {
        params: SessionTarget & SessionFlags;
        response: DesktopState;
      };
      deleteSession: { params: SessionTarget; response: DesktopState };
      markSessionRead: {
        params: SessionTarget & { completionId: string };
        response: DesktopState;
      };
      openSessionLink: { params: { url: string }; response: Snapshot };
      // biome-ignore lint/suspicious/noConfusingVoidType: Electrobun's empty response convention.
      setUiPreferences: { params: UiPreferences; response: void };
      openSession: {
        params: OpenSessionParams;
        response: Snapshot;
      };
      rewindSession: {
        params: SessionAddress & { entryId: string };
        response: Snapshot;
      };
      forkSession: {
        params: SessionAddress & { entryId: string };
        response: Snapshot;
      };
      getOpenState: { params: { openId: string }; response: OpenState };
      // biome-ignore lint/suspicious/noConfusingVoidType: Electrobun convention.
      cancelOpen: { params: { openId: string }; response: void };
      getSessionSnapshot: { params: SessionAddress; response: Snapshot };
      getSessionHistory: {
        params: SessionAddress & { revision: string; before: string };
        response: Transcript;
      };
      listSlashCommands: { params: SessionAddress; response: SlashCommand[] };
      completeSlashArguments: {
        params: SessionAddress & { name: string; argumentPrefix: string };
        response: { value: string; label: string; description?: string }[];
      };
      getPromptReceipt: { params: SendKey; response: PromptReceipt };
      cancelPrompt: { params: SendKey; response: PromptReceipt };
      getRecovery: { params: SessionAddress; response: RuntimeRecoveryState };
      syncDraft: { params: DraftSyncParams; response: DraftSyncResult };
      discardRecovery: {
        params: { current: SessionAddress; retained: SessionAddress };
        // biome-ignore lint/suspicious/noConfusingVoidType: Electrobun convention.
        response: void;
      };
      // biome-ignore lint/suspicious/noConfusingVoidType: Electrobun convention.
      resolveExtensionUI: { params: UIReply; response: void };
      terminalCommand: {
        params: TerminalClientCommand & SessionAddress;
        // biome-ignore lint/suspicious/noConfusingVoidType: Electrobun convention.
        response: void;
      };
      // biome-ignore lint/suspicious/noConfusingVoidType: Electrobun convention.
      abort: { params: SessionAddress; response: void };
      // biome-ignore lint/suspicious/noConfusingVoidType: Electrobun convention.
      closeSession: { params: SessionAddress; response: void };
      reloadSession: {
        params: SessionAddress;
        response: { state: "applied" | "pending" };
      };
      // biome-ignore lint/suspicious/noConfusingVoidType: Electrobun convention.
      runtimeState: { params: void; response: RuntimeViewState };
      removeProject: { params: { cwd: string }; response: string[] };
      setProjectState: {
        params: { cwd: string } & ProjectFlags;
        response: DesktopState;
      };
      openProjectFolder: { params: { cwd: string }; response: boolean };
      // biome-ignore lint/suspicious/noConfusingVoidType: Electrobun's empty response convention.
      logout: { params: { provider: string }; response: void };
      refreshProviderModels: {
        params: { provider: string };
        // biome-ignore lint/suspicious/noConfusingVoidType: Electrobun's empty response convention.
        response: void;
      };
      setModel: {
        params: SessionAddress & { provider: string; id: string };
        response: ModelSelection;
      };
      setModelEnabled: {
        params: { provider: string; id: string; enabled: boolean };
        response: string[];
      };
      setModelsEnabled: {
        params: { provider: string; ids: string[]; enabled: boolean };
        response: string[];
      };
      setModelOverride: {
        params: { provider: string; id: string; override: ModelOverride };
        // biome-ignore lint/suspicious/noConfusingVoidType: Electrobun's empty response convention.
        response: void;
      };
      setDefaultEffort: {
        params: { provider: string; id: string; effort: Effort | null };
        // biome-ignore lint/suspicious/noConfusingVoidType: Electrobun's empty response convention.
        response: void;
      };
      setEffort: {
        params: SessionAddress & { effort: Effort };
        response: ModelSelection;
      };
      // biome-ignore lint/suspicious/noConfusingVoidType: Electrobun's empty response convention.
      copyImage: { params: { src: string }; response: void };
      saveImage: { params: { src: string }; response: string };
      /** Stores a dropped/pasted file and returns its absolute path. */
      storeAttachment: {
        params: { name: string; data: string };
        response: string;
      };
    };
    messages: {
      // biome-ignore lint/suspicious/noConfusingVoidType: Electrobun's parameterless RPC convention.
      addProject: void;
      setAppearance: Appearance;
      setSettings: SettingsPatch;
      windowControl: { action: "minimize" | "toggleMaximize" | "close" };
      startLogin: { provider: string; method: AuthMethod; loginId: string };
      resolveLogin: { loginId: string; value: string };
      cancelLogin: { loginId: string };
      openExternal: { url: string };
      // src is a rendered image: a base64 data URL or an http(s) Markdown image URL.
      imageMenu: { src: string };
      connectUI: { clientId: string };
      disconnectUI: { clientId: string };
      installPackage: { opId: string; name: string };
      uninstallPackage: { opId: string; source: string };
      updatePackage: { opId: string; source: string };
    };
  };
  webview: {
    requests: {
      // biome-ignore lint/suspicious/noConfusingVoidType: Electrobun convention.
      flushDrafts: { params: void; response: void };
    };
    messages: {
      runtimeEvent: RuntimeEvent;
      extensionUIEvent: ExtensionUIEvent;
      terminalEvent: TerminalHostEvent;
      packageOp: PackageOpStatus;
      installed: InstalledPackage[];
      sessionEvent: WireEvent;
      projects: string[];
      desktopState: DesktopState;
      appearance: Appearance;
      settings: Settings;
      windowState: { maximized: boolean };
      appearanceError: { message: string };
      agentEvent: {
        sessionId: string;
        event: WireEvent;
        contextUsage?: ContextUsage | null;
      };
      loginFrame: LoginFrame;
      notification: Notice;
      error: { message: string };
    };
  };
};
