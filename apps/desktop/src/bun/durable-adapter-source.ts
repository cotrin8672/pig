import type { Context, WatchHandle } from "@earendil-works/chord";
import { withAbortSignal } from "@earendil-works/chord/context";
import type {
  AgentChange,
  Conversation,
  ConversationDocToken,
  ConversationView,
  Harness,
  JsonObject,
  TaskGraph,
  Tx,
} from "@earendil-works/pi-durable";
import type {
  DocumentState,
  Unsubscribe,
} from "../../../../packages/config/src";
import type { AdapterBackend } from "./adapter-backend";

export interface DurableAdapterSourceOptions {
  harness: Harness;
  conversation: Conversation;
  context: Context;
  session: { id: string; cwd: string };
  assertCurrent(): void;
  /** Same host operation line as admission/model/fork. Rechecks the epoch when dequeued. */
  operate?<T>(action: () => Promise<T>): Promise<T>;
  onChange?(): void;
  onFailure?(error: unknown): void;
}

/** Native windows + LIVE graph + token-addressed custom docs. No SDK/EventBus/Tool.execute. */
export class DurableAdapterSource implements AdapterBackend {
  readonly session: { id: string; cwd: string };
  private readonly lifetime = new AbortController();
  private readonly watches = new Set<WatchHandle<unknown>>();
  private readonly acquiring = new Set<Promise<unknown>>();
  private readonly listeners = new Set<() => void>();
  private view?: ConversationView;
  private graph?: TaskGraph;
  private starting?: Promise<void>;
  private disposal?: Promise<void>;
  private queued = false;
  failure?: string;

  constructor(private readonly options: DurableAdapterSourceOptions) {
    this.session = Object.freeze({ ...options.session });
  }

  private context(signal?: AbortSignal): Context {
    return withAbortSignal(
      signal
        ? AbortSignal.any([this.lifetime.signal, signal])
        : this.lifetime.signal,
      this.options.context,
    );
  }

  assertCurrent(): void {
    this.lifetime.signal.throwIfAborted();
    if (this.failure) throw new Error(this.failure);
    this.options.assertCurrent();
  }

  start(): Promise<void> {
    this.starting ??= this.attach();
    return this.starting;
  }

  private async attach(): Promise<void> {
    this.assertCurrent();
    const results = await Promise.allSettled([
      this.acquire(this.options.conversation.watch(this.context()), (value) => {
        this.view = value;
      }),
      this.acquire(
        this.options.harness.watchTaskGraph(this.context()),
        (value) => {
          this.graph = value;
        },
      ),
    ]);
    const failed = results.find((result) => result.status === "rejected");
    if (failed?.status === "rejected") {
      await this.dispose();
      throw failed.reason;
    }
    this.assertCurrent();
  }

  private track<T>(promise: Promise<T>): Promise<T> {
    this.acquiring.add(promise);
    void promise.then(
      () => this.acquiring.delete(promise),
      () => this.acquiring.delete(promise),
    );
    return promise;
  }

  private async acquire<T>(
    promise: Promise<WatchHandle<T>>,
    receive: (value: T) => void,
  ): Promise<void> {
    const watch = await this.track(promise);
    if (this.lifetime.signal.aborted) {
      await watch.stop();
      return;
    }
    this.keep(watch);
    receive(structuredClone(watch.value));
    watch.start(async (call) => {
      if (this.lifetime.signal.aborted) return;
      this.assertCurrent();
      if (call.kind === "failed") {
        this.fail(call.error);
        return;
      }
      receive(structuredClone(call.value));
      this.invalidate();
    });
  }

  private keep<T>(watch: WatchHandle<T>): void {
    this.watches.add(watch as WatchHandle<unknown>);
    void watch.closed.then((end) => {
      this.watches.delete(watch as WatchHandle<unknown>);
      if (
        !this.lifetime.signal.aborted &&
        end.kind !== "stopped" &&
        end.kind !== "aborted"
      ) {
        this.fail(
          "error" in end
            ? end.error
            : new Error(`Native watch ended: ${end.kind}`),
        );
      }
    });
  }

  private fail(error: unknown): void {
    if (this.failure || this.lifetime.signal.aborted) return;
    this.failure = error instanceof Error ? error.message : String(error);
    try {
      this.options.onFailure?.(error);
    } catch (callbackError) {
      this.failure += `; onFailure: ${String(callbackError)}`;
    }
    this.invalidate();
  }

  private invalidate(): void {
    if (this.queued || this.lifetime.signal.aborted) return;
    this.queued = true;
    queueMicrotask(() => {
      this.queued = false;
      if (this.lifetime.signal.aborted) return;
      try {
        this.options.onChange?.();
      } catch (error) {
        this.fail(error);
      }
      for (const listener of this.listeners) {
        try {
          listener();
        } catch (error) {
          this.fail(error);
        }
      }
    });
  }

  conversation(): Readonly<ConversationView> {
    this.assertCurrent();
    if (!this.view) throw new Error("NATIVE_SOURCE_NOT_READY");
    return structuredClone(this.view);
  }

  taskGraph(): Readonly<TaskGraph> {
    this.assertCurrent();
    if (!this.graph) throw new Error("NATIVE_SOURCE_NOT_READY");
    return structuredClone(this.graph);
  }

  isStreaming(): boolean {
    this.assertCurrent();
    return Object.values(this.graph?.tasks ?? {}).some(
      (task) => task.conversationId === this.options.conversation.id,
    );
  }

  /** Invalidation only. AdapterRuntime owns immediate/coalesced listener delivery. */
  subscribe(listener: () => void): Unsubscribe {
    this.assertCurrent();
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  async snapshot<T extends JsonObject>(
    token: ConversationDocToken<T>,
    signal: AbortSignal,
  ): Promise<Readonly<T> | undefined> {
    this.assertCurrent();
    signal.throwIfAborted();
    const value = await this.options.harness.snapshot(
      token,
      this.options.conversation.id,
      this.context(signal),
    );
    this.assertCurrent();
    signal.throwIfAborted();
    return value === undefined ? undefined : structuredClone(value);
  }

  async watchDocument<T extends JsonObject>(
    token: ConversationDocToken<T>,
    listener: (state: DocumentState<T>) => void,
    signal: AbortSignal,
  ): Promise<Unsubscribe | undefined> {
    this.assertCurrent();
    signal.throwIfAborted();
    const watch = await this.track(
      this.options.harness.watchDoc(
        token,
        this.options.conversation.id,
        this.context(signal),
      ),
    );
    if (!watch) return undefined;
    // Native context cancellation is not enough for an injected/delayed acquisition.
    if (signal.aborted || this.lifetime.signal.aborted) {
      await watch.stop();
      return undefined;
    }
    this.keep(watch);
    let alive = true;
    const stop = () => {
      if (!alive) return;
      alive = false;
      signal.removeEventListener("abort", stop);
      void watch.stop();
    };
    signal.addEventListener("abort", stop, { once: true });
    void watch.closed.then(() => {
      alive = false;
      signal.removeEventListener("abort", stop);
    });
    try {
      this.assertCurrent();
      listener({ value: structuredClone(watch.value), retired: false });
      watch.start(async (call) => {
        if (!alive || this.lifetime.signal.aborted) return;
        this.assertCurrent();
        if (call.kind === "failed") {
          this.fail(call.error);
          return;
        }
        listener({ value: structuredClone(call.value), retired: call.retired });
      });
    } catch (error) {
      stop();
      throw error;
    }
    return stop;
  }

  private operate<T>(
    signal: AbortSignal,
    action: (ctx: Context) => Promise<T>,
  ): Promise<T> {
    const run = async () => {
      this.assertCurrent();
      signal.throwIfAborted();
      const result = await action(this.context(signal));
      this.assertCurrent();
      signal.throwIfAborted();
      this.invalidate();
      return result;
    };
    return this.options.operate ? this.options.operate(run) : run();
  }

  configure(change: AgentChange, signal: AbortSignal): Promise<void> {
    return this.operate(signal, (ctx) =>
      this.options.conversation.configure(change, ctx),
    );
  }

  commit<T>(
    change: (tx: Tx) => T | Promise<T>,
    signal: AbortSignal,
  ): Promise<T> {
    return this.operate(signal, (ctx) =>
      this.options.conversation.commit(async (tx) => {
        this.assertCurrent();
        signal.throwIfAborted();
        const result = await change(tx);
        this.assertCurrent();
        signal.throwIfAborted();
        return result;
      }, ctx),
    );
  }

  dispose(): Promise<void> {
    if (this.disposal) return this.disposal;
    this.lifetime.abort(new Error("NATIVE_SOURCE_DISPOSED"));
    this.listeners.clear();
    this.disposal = Promise.all(
      [...this.watches].map((watch) => watch.stop()),
    ).then(async () => {
      await Promise.allSettled([...this.acquiring]);
      await Promise.all([...this.watches].map((watch) => watch.stop()));
      this.watches.clear();
    });
    return this.disposal;
  }
}

export async function createDurableAdapterSource(
  options: DurableAdapterSourceOptions,
): Promise<DurableAdapterSource> {
  const source = new DurableAdapterSource(options);
  await source.start();
  return source;
}
