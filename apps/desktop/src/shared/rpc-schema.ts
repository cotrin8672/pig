import type {
  AuthEvent,
  AuthPrompt,
  ImageContent,
} from "@earendil-works/pi-ai";
import type {
  DesktopState,
  SessionFlags,
  UiPreferences,
} from "./desktop-state";
import type { ModelOverride } from "./model-overrides";
import type { ProjectFlags } from "./projects";
import type { Settings, SettingsPatch } from "./settings";
import type { Transcript } from "./transcript";

export type WireEvent = {
  type: "snapshot";
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
export interface PromptAccepted {
  disposition: "started" | "queued" | "handled";
}

export type RPCSchema = {
  bun: {
    requests: {
      prompt: {
        params: {
          sessionId: string;
          text: string;
          requestId: string;
          images?: ImageContent[];
        };
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
        params: { cwd: string; id?: string };
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
      setProjectState: {
        params: { cwd: string } & ProjectFlags;
        response: DesktopState;
      };
      openProjectFolder: { params: { cwd: string }; response: boolean };
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
      abort: { sessionId: string };
      closeSession: { sessionId: string };
    };
  };
  webview: {
    requests: Record<never, never>;
    messages: {
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
