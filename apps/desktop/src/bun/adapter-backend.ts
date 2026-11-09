import type {
  AgentChange,
  ConversationDocToken,
  ConversationView,
  JsonObject,
  TaskGraph,
  Tx,
} from "@earendil-works/pi-durable";
import type {
  DocumentState,
  Unsubscribe,
} from "../../../../packages/config/src";

/** One host-owned conversation/epoch. No SDK, event bus, submission or Tool.execute port. */
export interface AdapterBackend {
  readonly session: { id: string; cwd: string };
  assertCurrent(): void;
  isStreaming(): boolean;
  conversation(): Readonly<ConversationView>;
  taskGraph(): Readonly<TaskGraph>;
  /** Invalidation only; AdapterRuntime supplies the immediate notification. */
  subscribe(listener: () => void): Unsubscribe;
  snapshot<T extends JsonObject>(
    token: ConversationDocToken<T>,
    signal: AbortSignal,
  ): Promise<Readonly<T> | undefined>;
  /** Delivers initial native value and retirement; late attachment must still be stoppable. */
  watchDocument<T extends JsonObject>(
    token: ConversationDocToken<T>,
    listener: (state: DocumentState<T>) => void,
    signal: AbortSignal,
  ): Promise<Unsubscribe | undefined>;
  /** Host binds Context, cancellation, permissions and conversation identity. */
  configure(change: AgentChange, signal: AbortSignal): Promise<void>;
  /** Callback reads through tx only, never through snapshot/watch. */
  commit<T>(
    change: (tx: Tx) => T | Promise<T>,
    signal: AbortSignal,
  ): Promise<T>;
}
