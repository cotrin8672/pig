import type { AuthEvent, AuthPrompt } from "@earendil-works/pi-ai";
import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import type { Transcript } from "./transcript";

export type WireEvent =
  | Exclude<AgentSessionEvent, { type: "message_update" }>
  | Omit<Extract<AgentSessionEvent, { type: "message_update" }>, "message">;

export const providers = [
  { id: "openai-codex", name: "OpenAI (ChatGPT Plus/Pro)" },
  { id: "anthropic", name: "Anthropic (Claude Pro/Max)" },
] as const;
export type ProviderId = (typeof providers)[number]["id"];
export interface ModelInfo {
  provider: string;
  id: string;
  name: string;
}
export interface SessionInfo {
  id: string;
  cwd: string;
  path?: string;
  title: string;
  modified: number;
}
export interface Snapshot {
  info: SessionInfo;
  transcript: Transcript;
  model?: ModelInfo;
}
// WezTerm-style window appearance: `opacity` is the window background alpha
// (0.3..1), `backdrop` the Windows 11 DWM system backdrop behind it.
export type Backdrop = "none" | "acrylic" | "mica";
export interface Appearance {
  backdrop: Backdrop;
  opacity: number;
}
export interface Bootstrap {
  projects: string[];
  providers: { id: ProviderId; name: string; loggedIn: boolean }[];
  models: ModelInfo[];
}
export type LoginFrame = { loginId: string; provider: ProviderId } & (
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
export type RPCSchema = {
  bun: {
    requests: {
      // biome-ignore lint/suspicious/noConfusingVoidType: Electrobun's parameterless RPC convention.
      bootstrap: { params: void; response: Bootstrap };
      // biome-ignore lint/suspicious/noConfusingVoidType: Electrobun's parameterless RPC convention.
      appearance: { params: void; response: Appearance };
      listSessions: { params: { cwd: string }; response: SessionInfo[] };
      openSession: {
        params: { cwd: string; path?: string; id?: string };
        response: Snapshot;
      };
      removeProject: { params: { cwd: string }; response: string[] };
      // biome-ignore lint/suspicious/noConfusingVoidType: Electrobun's empty response convention.
      logout: { params: { provider: ProviderId }; response: void };
      setModel: {
        params: { sessionId: string; provider: string; id: string };
        response: ModelInfo;
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
    };
    messages: {
      // biome-ignore lint/suspicious/noConfusingVoidType: Electrobun's parameterless RPC convention.
      addProject: void;
      setAppearance: Appearance;
      windowControl: { action: "minimize" | "toggleMaximize" | "close" };
      startLogin: { provider: ProviderId; loginId: string };
      resolveLogin: { loginId: string; value: string };
      cancelLogin: { loginId: string };
      openExternal: { url: string };
      prompt: { sessionId: string; text: string };
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
      appearance: Appearance;
      windowState: { maximized: boolean };
      appearanceError: { message: string };
      agentEvent: { sessionId: string; event: WireEvent };
      loginFrame: LoginFrame;
      error: { message: string };
      packageOp: PackageOpStatus;
      installed: InstalledPackage[];
    };
  };
};
