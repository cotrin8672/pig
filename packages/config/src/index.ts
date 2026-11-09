import type { Provider } from "@earendil-works/pi-ai";
import type {
  AgentChange,
  AgentState,
  ConversationDocToken,
  ConversationView,
  Extension,
  HarnessOptions,
  JsonObject,
  TaskGraph,
  ToolRegistration,
  Tx,
} from "@earendil-works/pi-durable";
import type { SessionView } from "./models";

export * from "./models";

export type Json =
  | null
  | boolean
  | number
  | string
  | Json[]
  | { [key: string]: Json };
export type Unsubscribe = () => void;
export interface DocumentState<T extends JsonObject> {
  value: Readonly<T>;
  retired: boolean;
}
export interface AdapterSources {
  /** Detached transcript window (with before), and built-in documents only. */
  conversation(): Readonly<ConversationView>;
  /** Workspace-wide LIVE tasks, not execution history. Disappearance is not success. */
  taskGraph(): Readonly<TaskGraph>;
  /** Immediately called, then coalesced invalidations. Reads never execute commands. */
  subscribe(listener: () => void | Promise<void>): Unsubscribe;
  snapshot<T extends JsonObject>(
    token: ConversationDocToken<T>,
  ): Promise<Readonly<T> | undefined>;
  /** Initial native watch value, then changes, including retirement. Missing stays missing. */
  watchDocument<T extends JsonObject>(
    token: ConversationDocToken<T>,
    listener: (state: DocumentState<T>) => void | Promise<void>,
  ): Promise<Unsubscribe | undefined>;
}
/** Trusted host operations, bound to the target conversation and cancellation lifetime. */
export interface AdapterController {
  configure(change: AgentChange): Promise<void>;
  /** Read documents through tx ONLY inside this callback; snapshot/watch can deadlock. */
  commit<T>(change: (tx: Tx) => T | Promise<T>): Promise<T>;
}
export interface AdapterContext {
  session: { id: string; cwd: string };
  sources: AdapterSources;
  views: {
    set(view: SessionView): void;
    remove(id: string): void;
  };
  commands: {
    register(command: {
      id: string;
      title: string;
      allowWhileStreaming?: boolean;
      run(input: Json | undefined): void | Promise<void>;
    }): void;
  };
  /** Available only during an explicitly invoked adapter command; never Tool.execute. */
  controller: AdapterController;
  scope: {
    signal: AbortSignal;
    onDispose(cleanup: Unsubscribe): void;
    interval(
      callback: () => void | Promise<void>,
      milliseconds: number,
    ): Unsubscribe;
  };
}
export interface SessionAdapter {
  id: string;
  connect(context: AdapterContext):
    | void
    | Unsubscribe
    | Promise<// biome-ignore lint/suspicious/noConfusingVoidType: Async connections may return no cleanup.
      void | Unsubscribe>;
}
export interface AdapterKeymap {
  keys: string;
  adapter: string;
  command: string;
  when: "chat" | "composer" | "panel";
}
/** Definitions installed in the workspace registry are NOT automatically selected. */
export type AgentProfile = Pick<
  AgentState,
  "model" | "thinkingLevel" | "instructions" | "cwd" | "maxTurns"
> & {
  extensions: readonly Extension[];
  tools: readonly ToolRegistration[];
  modelTools?: readonly ToolRegistration[];
};
export interface WorkspaceConfigContext {
  workspaceId: string;
  cwd: string;
}
export type ProviderFactoryContext =
  | { scope: "catalog" }
  | ({ scope: "workspace" } & WorkspaceConfigContext);
/** Return a fresh native Provider on every catalog or workspace invocation. */
export type ProviderFactory = (
  context: ProviderFactoryContext,
) => Provider | Promise<Provider>;
/** Explicit absolute resource paths; no implicit discovery or package loading. */
export interface ResourcePaths {
  instructions: readonly string[];
  skills: readonly string[];
  prompts: readonly string[];
}
export interface ConfigResourceSelection {
  global?: ResourcePaths;
  project?: ResourcePaths;
}
export interface RuntimeConfig {
  extensions?: readonly Extension[];
  providers?: readonly Provider[];
  providerFactories?: readonly ProviderFactory[];
  /** Resolved once per workspace lifetime; selection changes require a restart. */
  resources?: (
    workspace: WorkspaceConfigContext,
  ) => ConfigResourceSelection | Promise<ConfigResourceSelection>;
  profiles?: Readonly<Record<string, AgentProfile>>;
  defaultProfile?: string;
  conversationCreated?: HarnessOptions["conversationCreated"];
}
export interface CommandConversation {
  session: { id: string; cwd: string };
  sources: AdapterSources;
  controller: AdapterController;
}
export interface CommandContext {
  scope: { signal: AbortSignal };
  /** Absent for global invocations without a conversation. */
  conversation?: CommandConversation;
}
export interface HostCommand {
  /** Namespaced ID. config.reload and app built-in IDs are reserved. */
  id: string;
  title: string;
  scope: "global" | "conversation";
  allowWhileStreaming?: boolean;
  /** Omitted: only undefined input is accepted. Bounded JSON is always checked. */
  validateInput?: (input: Json | undefined) => void;
  /** A reason disables the command. Not a replacement for runtime permission checks. */
  enabled?: (ctx: CommandContext) => string | undefined;
  confirmation?: string;
  run(ctx: CommandContext, input: Json | undefined): void | Promise<void>;
}
/** Host bindings are deliberately separate from the WebView's AdapterKeymap DTO. */
export interface HostCommandKeymap {
  keys: string;
  command: string;
  when: AdapterKeymap["when"];
  adapter?: never;
}
export type ConfigKeymap = AdapterKeymap | HostCommandKeymap;
export interface PigConfig {
  apiVersion: 2;
  runtime?: RuntimeConfig;
  commands?: readonly HostCommand[];
  sessionAdapters?: readonly SessionAdapter[];
  keymaps?: readonly ConfigKeymap[];
}
export function defineConfig(config: PigConfig): PigConfig {
  return config;
}

export interface ViewEnvelope {
  adapterId: string;
  revision: number;
  view: SessionView;
}
export interface SessionUIState {
  generation: string;
  views: ViewEnvelope[];
  commands: { adapterId: string; id: string; title: string; busy: boolean }[];
  keymaps: AdapterKeymap[];
  diagnostics: { adapterId: string; message: string }[];
}
export interface SessionActionRequest {
  generation: string;
  adapterId: string;
  commandId: string;
  /** Mandatory for view actions; absent only for registered keyboard commands. */
  viewId?: string;
  revision?: number;
  actionId?: string;
  input?: Json;
}
