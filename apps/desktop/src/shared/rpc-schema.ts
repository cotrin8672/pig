import type { AuthEvent, AuthPrompt } from "@earendil-works/pi-ai";
import type {
  DesktopState,
  SessionFlags,
  UiPreferences,
} from "./desktop-state";
import type { ExtensionUIEvent, UIReply } from "./extension-ui";
import type { ModelOverride } from "./model-overrides";
import type {
  InstalledPackage,
  PackageEvent,
  PackageOperation,
  PackageOperationResult,
  PackageSearch,
  PackageSearchResult,
} from "./packages";
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
  address: SessionAddress;
  snapshotSeq: number;
  info: SessionInfo;
  transcript: Transcript;
  failure?: string;
  aborted?: boolean;
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

export type RPCSchema = {
  bun: {
    requests: {
      heartbeatUI: {
        params: { clientId: string };
        response: { connected: boolean };
      };
      // biome-ignore lint/suspicious/noConfusingVoidType: Electrobun convention.
      packageProfile: { params: void; response: { agentDir: string } };
      packageSearch: { params: PackageSearch; response: PackageSearchResult };
      // biome-ignore lint/suspicious/noConfusingVoidType: Electrobun convention.
      packageInstalled: { params: void; response: InstalledPackage[] };
      packageOperate: {
        params: PackageOperation;
        response: PackageOperationResult;
      };
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
      getPromptReceipt: { params: SendKey; response: PromptReceipt };
      syncDraft: { params: DraftSyncParams; response: DraftSyncResult };
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
    };
  };
  webview: {
    requests: Record<never, never>;
    messages: {
      runtimeEvent: RuntimeEvent;
      extensionUIEvent: ExtensionUIEvent;
      terminalEvent: TerminalHostEvent;
      packageEvent: PackageEvent;
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
