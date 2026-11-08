import type {
  AuthEvent,
  AuthPrompt,
  ImageContent,
} from "@earendil-works/pi-ai";
import type {
  AgentSession,
  AgentSessionEvent,
} from "@earendil-works/pi-coding-agent";
import type {
  DesktopState,
  SessionFlags,
  UiPreferences,
} from "./desktop-state";
import type {
  ExtensionDialogRequest,
  ExtensionDialogResponse,
} from "./extension-dialog";
import type { ModelOverride } from "./model-overrides";
import type { Settings, SettingsPatch } from "./settings";
import type { TerminalUICommand, TerminalUIEvent } from "./terminal-ui";
import type { Transcript } from "./transcript";

export type {
  ExtensionDialogRequest,
  ExtensionDialogResponse,
} from "./extension-dialog";

export type WireEvent =
  | Exclude<AgentSessionEvent, { type: "message_update" }>
  | Omit<Extract<AgentSessionEvent, { type: "message_update" }>, "message">;

// Built from pi's ModelRuntime: built-ins, models.json and extension-registered providers.
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
  path?: string;
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
export type ContextUsage = NonNullable<
  ReturnType<AgentSession["getContextUsage"]>
>;
export interface ModelSelection {
  model?: ModelInfo;
  effort: Effort;
  effortLevels: Effort[];
  contextUsage?: ContextUsage | null;
}
export interface Snapshot extends ModelSelection {
  info: SessionInfo;
  transcript: Transcript;
  pendingDialogs: ExtensionDialogRequest[];
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
  pendingDialogs: ExtensionDialogRequest[];
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
export interface PromptAccepted {
  disposition: "started" | "queued" | "handled";
}

export type RPCSchema = {
  bun: {
    requests: {
      prompt: {
        params: { sessionId: string; text: string; images?: ImageContent[] };
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
      answerExtensionDialog: {
        params: ExtensionDialogResponse;
        // biome-ignore lint/suspicious/noConfusingVoidType: Electrobun's empty response convention.
        response: void;
      };
      openSessionLink: { params: { url: string }; response: Snapshot };
      // biome-ignore lint/suspicious/noConfusingVoidType: Electrobun's empty response convention.
      setUiPreferences: { params: UiPreferences; response: void };
      openSession: {
        params: { cwd: string; path?: string; id?: string };
        response: Snapshot;
      };
      // `timestamp` identifies a transcript message (user for rewind, assistant for fork).
      rewindSession: {
        params: { sessionId: string; timestamp: number };
        response: Snapshot;
      };
      forkSession: {
        params: { sessionId: string; timestamp: number };
        response: Snapshot;
      };
      removeProject: { params: { cwd: string }; response: string[] };
      // biome-ignore lint/suspicious/noConfusingVoidType: Electrobun's empty response convention.
      logout: { params: { provider: string }; response: void };
      setModel: {
        params: { sessionId: string; provider: string; id: string };
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
        params: { sessionId: string; effort: Effort };
        response: ModelSelection;
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
      terminalUI: TerminalUICommand;
      abort: { sessionId: string };
      closeSession: { sessionId: string };
      installPackage: { opId: string; name: string };
      uninstallPackage: { opId: string; source: string };
      updatePackage: { opId: string; source: string };
    };
  };
  webview: {
    requests: Record<never, never>;
    messages: {
      projects: string[];
      desktopState: DesktopState;
      extensionDialogs: {
        sessionId: string;
        requests: ExtensionDialogRequest[];
      };
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
      terminalUI: TerminalUIEvent;
      notification: Notice;
      error: { message: string };
      packageOp: PackageOpStatus;
      installed: InstalledPackage[];
    };
  };
};
