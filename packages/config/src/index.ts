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
export interface SourceEntry {
  id: string;
  type: string;
  timestamp: string;
  customType?: string;
  data?: unknown;
  message?: unknown;
}
export interface SourceEvent {
  type: string;
  [key: string]: unknown;
}
export interface ToolObservation {
  toolCallId: string;
  toolName: string;
  parentToolCallId?: string;
  args?: unknown;
  result?: unknown;
  phase: "running" | "finished";
  isError?: boolean;
  origin: "history" | "live";
}
export interface ExtensionCommand {
  name: string;
  invocationName: string;
  source: string;
  description?: string;
}
export interface AdapterSources {
  entries(scope: "branch" | "all"): readonly SourceEntry[];
  tools(): readonly ToolObservation[];
  /** Immediately called, then on source changes. Reading history never runs commands. */
  subscribe(listener: () => void | Promise<void>): Unsubscribe;
  onEvent(listener: (event: SourceEvent) => void | Promise<void>): Unsubscribe;
  onBus(
    channel: string,
    listener: (data: unknown) => void | Promise<void>,
  ): Unsubscribe;
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
  pi: {
    commands(): readonly ExtensionCommand[];
    /** Calls the resolved handler, never sends a slash command as a model prompt. */
    invoke(command: {
      name: string;
      source: string;
      args?: string;
      allowWhileStreaming?: boolean;
    }): Promise<void>;
    emit(channel: string, data: Json): void;
  };
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
export interface PigConfig {
  apiVersion: 1;
  sessionAdapters?: readonly SessionAdapter[];
  keymaps?: readonly AdapterKeymap[];
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
