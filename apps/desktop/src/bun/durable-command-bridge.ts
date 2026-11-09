import type {
  AdapterSources,
  CommandConversation,
  PigConfig,
  SessionAdapter,
  Unsubscribe,
} from "../../../../packages/config/src";
import type { CommandRegistry, CommandRequest } from "./command-registry";
import type { DurableAdapterSource } from "./durable-adapter-source";

/** Command-scoped native reads. No handles escape to the renderer; cancellation also releases late watches. */
export function bindCommandConversation(
  source: DurableAdapterSource,
  signal: AbortSignal,
  assertCurrent: () => void,
  onFailure: (error: unknown) => void,
): CommandConversation {
  const cleanups = new Set<Unsubscribe>();
  const assert = () => {
    signal.throwIfAborted();
    assertCurrent();
    source.assertCurrent();
  };
  const assertToken = (token: unknown) => {
    const definition = (
      token as {
        definition?: {
          scope?: unknown;
          kind?: unknown;
          version?: unknown;
          family?: unknown;
        };
      } | null
    )?.definition;
    if (
      !definition ||
      definition.scope !== "conversation" ||
      definition.family !== undefined ||
      typeof definition.kind !== "string" ||
      !definition.kind ||
      !Number.isSafeInteger(definition.version) ||
      Number(definition.version) < 1
    )
      throw new Error("INVALID_CONVERSATION_DOC_TOKEN");
  };
  const track = (cleanup: Unsubscribe): Unsubscribe => {
    let alive = true;
    const stop = () => {
      if (!alive) return;
      alive = false;
      cleanups.delete(stop);
      cleanup();
    };
    if (signal.aborted) stop();
    else cleanups.add(stop);
    return stop;
  };
  signal.addEventListener(
    "abort",
    () => {
      for (const cleanup of [...cleanups]) cleanup();
    },
    { once: true },
  );
  const listener = <T>(
    callback: (value: T) => void | Promise<void>,
    coalesce = false,
  ) => {
    if (typeof callback !== "function")
      throw new Error("INVALID_COMMAND_LISTENER");
    let active = true;
    let running = false;
    const pending: T[] = [];
    const stop = track(() => {
      active = false;
      pending.length = 0;
    });
    const drain = async () => {
      try {
        while (active && pending.length && !signal.aborted) {
          const next = pending.shift() as T;
          assert();
          await callback(next);
        }
      } catch (error) {
        if (!signal.aborted) onFailure(error);
        stop();
      } finally {
        running = false;
      }
    };
    return {
      stop,
      dispatch(value: T) {
        if (!active || signal.aborted) return;
        if (coalesce) pending.length = 0;
        if (pending.length >= 1000) {
          stop();
          onFailure(new Error("COMMAND_DOCUMENT_BACKLOG"));
          return;
        }
        pending.push(structuredClone(value));
        if (running) return;
        running = true;
        queueMicrotask(() => {
          void drain();
        });
      },
    };
  };
  const sources: AdapterSources = {
    conversation: () => {
      assert();
      return source.conversation();
    },
    taskGraph: () => {
      assert();
      return source.taskGraph();
    },
    subscribe: (callback) => {
      assert();
      const delivery = listener(callback, true);
      const detach = source.subscribe(() => delivery.dispatch(undefined));
      const stop = track(() => {
        detach();
        delivery.stop();
      });
      delivery.dispatch(undefined);
      return stop;
    },
    snapshot: async (token) => {
      assert();
      assertToken(token);
      const value = await source.snapshot(token, signal);
      assert();
      return value;
    },
    watchDocument: async (token, callback) => {
      assert();
      assertToken(token);
      const delivery = listener(callback);
      try {
        const detach = await source.watchDocument(
          token,
          delivery.dispatch,
          signal,
        );
        if (!detach) {
          delivery.stop();
          return undefined;
        }
        const stop = track(() => {
          detach();
          delivery.stop();
        });
        if (signal.aborted) {
          stop();
          return undefined;
        }
        assert();
        return stop;
      } catch (error) {
        delivery.stop();
        throw error;
      }
    },
  };
  return {
    session: { ...source.session },
    sources,
    controller: {
      configure: async (change) => {
        assert();
        await source.configure(change, signal);
        assert();
      },
      commit: async (change) => {
        assert();
        const value = await source.commit(change, signal);
        assert();
        return value;
      },
    },
  };
}

/** Private host adapter, injected AFTER user-config validation; never mutates user config. */
export function commandAdapterConfig(
  config: PigConfig,
  registry: CommandRegistry,
  invoke: (request: CommandRequest) => Promise<void>,
): PigConfig {
  const ids = new Set(config.sessionAdapters?.map((adapter) => adapter.id));
  const commands = [
    ...(config.commands ?? []),
    {
      id: "config.reload",
      title: "Reload configuration",
      allowWhileStreaming: true,
    },
  ];
  const adapters: SessionAdapter[] = [];
  const owners = new Map<string, string>();
  for (let offset = 0; offset < commands.length; offset += 256) {
    const base = `pig.host-commands.${registry.generation}.${offset}`;
    let id = base;
    for (let suffix = 1; ids.has(id); suffix++) id = `${base}.${suffix}`;
    ids.add(id);
    const selected = commands.slice(offset, offset + 256);
    for (const command of selected) owners.set(command.id, id);
    adapters.push({
      id,
      connect(context) {
        for (const command of selected)
          context.commands.register({
            id: command.id,
            title: command.title,
            allowWhileStreaming: command.allowWhileStreaming,
            run: (input) =>
              invoke({
                generation: registry.generation,
                commandId: command.id,
                conversationId: context.session.id,
                input,
              }),
          });
      },
    });
  }
  if ((config.sessionAdapters?.length ?? 0) + adapters.length > 128)
    throw new Error(
      "HOST_COMMAND_ADAPTER_CAPACITY: reserve a scope for host command keymaps",
    );
  return {
    ...config,
    sessionAdapters: [...(config.sessionAdapters ?? []), ...adapters],
    keymaps: (config.keymaps ?? []).map((binding) => {
      if (binding.adapter !== undefined) return binding;
      const adapter = owners.get(binding.command);
      if (!adapter) throw new Error("COMMAND_UNAVAILABLE");
      return { ...binding, adapter };
    }),
  };
}
