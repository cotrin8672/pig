import { randomUUID } from "node:crypto";
import {
  type AdapterContext,
  type AdapterKeymap,
  type Json,
  type PigConfig,
  type SessionActionRequest,
  type SessionUIState,
  type SessionView,
  type Unsubscribe,
  viewActions,
} from "../../../../packages/config/src";
import {
  validateJson,
  validateView,
} from "../../../../packages/config/src/validate";
import type { AdapterBackend } from "./adapter-backend";

type Command = Parameters<AdapterContext["commands"]["register"]>[0];
type StoredView = {
  revision: number;
  view: SessionView;
  json: string;
  actions: ReturnType<typeof viewActions>;
};
type Scope = {
  id: string;
  alive: boolean;
  controller: AbortController;
  cleanups: Set<Unsubscribe>;
  commands: Map<string, Command>;
  views: Map<string, StoredView>;
  running?: Command;
  operation?: AbortController;
};

const MAX_COMMANDS = 256;
const MAX_VIEWS = 128;
const MAX_RESOURCES = 512;
const MAX_FIELD_LENGTH = 16_384;

function boundedText(value: unknown, max: number): asserts value is string {
  if (typeof value !== "string" || !value.trim() || value.length > max)
    throw new Error("INVALID_ADAPTER_TEXT");
}
function jsonCopy<T>(value: T): T {
  validateJson(value);
  return JSON.parse(JSON.stringify(value)) as T;
}

/** One runtime belongs to one backend/session generation. Adapter code never owns engine data. */
export class AdapterRuntime {
  readonly generation = randomUUID();
  private readonly scopes = new Map<string, Scope>();
  private readonly diagnostics = new Map<string, string>();
  private readonly keymaps: AdapterKeymap[];
  private started = false;
  private disposed = false;
  private revision = 0;

  constructor(
    private readonly config: PigConfig,
    private readonly backend: AdapterBackend,
    private readonly changed: () => void,
  ) {
    this.keymaps = structuredClone(
      (config.keymaps ?? []).filter(
        (binding): binding is AdapterKeymap =>
          typeof binding.adapter === "string",
      ),
    );
  }

  get busy(): boolean {
    return [...this.scopes.values()].some((scope) => Boolean(scope.running));
  }

  start(): void {
    if (this.started || this.disposed) return;
    this.started = true;
    const adapters = this.config.sessionAdapters ?? [];
    const counts = new Map<string, number>();
    for (const adapter of adapters)
      counts.set(adapter.id, (counts.get(adapter.id) ?? 0) + 1);
    for (const adapter of adapters) {
      try {
        boundedText(adapter.id, 256);
        if (counts.get(adapter.id) !== 1)
          throw new Error("DUPLICATE_ADAPTER_ID");
        if (typeof adapter.connect !== "function")
          throw new Error("INVALID_ADAPTER_CONNECT");
        if (this.scopes.size >= 128) throw new Error("ADAPTER_LIMIT");
      } catch (error) {
        this.diagnostics.set(String(adapter.id), this.message(error));
        this.changed();
        continue;
      }
      const scope: Scope = {
        id: adapter.id,
        alive: true,
        controller: new AbortController(),
        cleanups: new Set(),
        commands: new Map(),
        views: new Map(),
      };
      this.scopes.set(scope.id, scope);
      // Even synchronous connect work starts after the caller has started its chart.
      void Promise.resolve()
        .then(() => {
          if (!scope.alive) return;
          return adapter.connect(this.context(scope));
        })
        .then((cleanup) => {
          if (cleanup !== undefined) {
            if (typeof cleanup !== "function")
              throw new Error("INVALID_ADAPTER_CLEANUP");
            this.track(scope, cleanup);
          }
        })
        .catch((error: unknown) => this.fail(scope, error));
    }
  }

  snapshot(): SessionUIState {
    return structuredClone({
      generation: this.generation,
      views: [...this.scopes.values()].flatMap((scope) =>
        [...scope.views.values()].map(({ revision, view }) => ({
          adapterId: scope.id,
          revision,
          view,
        })),
      ),
      commands: [...this.scopes.values()].flatMap((scope) =>
        [...scope.commands.values()].map((command) => ({
          adapterId: scope.id,
          id: command.id,
          title: command.title,
          busy: scope.running === command,
        })),
      ),
      keymaps: this.keymaps.filter((keymap) =>
        this.scopes.get(keymap.adapter)?.commands.has(keymap.command),
      ),
      diagnostics: [...this.diagnostics].map(([adapterId, message]) => ({
        adapterId,
        message,
      })),
    });
  }

  async invoke(request: SessionActionRequest): Promise<void> {
    if (!request || request.generation !== this.generation)
      throw new Error("STALE_GENERATION");
    const scope = this.scopes.get(request.adapterId);
    if (!scope) throw new Error("ADAPTER_UNAVAILABLE");
    this.assert(scope);
    const command = scope.commands.get(request.commandId);
    if (!command) throw new Error("COMMAND_UNAVAILABLE");
    if (scope.running) throw new Error("COMMAND_BUSY");
    if (this.backend.isStreaming() && !command.allowWhileStreaming)
      throw new Error("AGENT_BUSY");
    if (request.input !== undefined) validateJson(request.input);
    let input: Json | undefined;
    if (request.viewId !== undefined) {
      const stored = scope.views.get(request.viewId);
      if (!stored || stored.revision !== request.revision)
        throw new Error("STALE_VIEW");
      const action = stored.actions.find(
        (candidate) => candidate.id === request.actionId,
      );
      if (
        !action ||
        action.command !== command.id ||
        action.disabled !== undefined
      )
        throw new Error("ACTION_UNAVAILABLE");
      if (action.fields !== undefined) {
        const fields = request.input;
        if (!fields || typeof fields !== "object" || Array.isArray(fields))
          throw new Error("INVALID_ACTION_FIELDS");
        const names = action.fields.map((field) => field.name);
        if (
          Object.keys(fields).length !== names.length ||
          Object.keys(fields).some((name) => !names.includes(name))
        )
          throw new Error("INVALID_ACTION_FIELDS");
        for (const field of action.fields) {
          const value = fields[field.name];
          if (
            !Object.hasOwn(fields, field.name) ||
            typeof value !== "string" ||
            value.length > MAX_FIELD_LENGTH ||
            (field.required && !value.trim())
          )
            throw new Error("INVALID_ACTION_FIELDS");
        }
        input = jsonCopy({ value: action.input ?? null, fields });
      } else {
        // Client-supplied fixed values are deliberately ignored; the host is authoritative.
        input = action.input === undefined ? undefined : jsonCopy(action.input);
      }
      // Consume the displayed operation revision even when no source state changes.
      stored.revision = ++this.revision;
    } else {
      if (
        request.input !== undefined ||
        request.revision !== undefined ||
        request.actionId !== undefined ||
        !this.keymaps.some(
          (keymap) =>
            keymap.adapter === scope.id && keymap.command === command.id,
        )
      )
        throw new Error("KEYBOARD_COMMAND_UNAVAILABLE");
    }
    scope.running = command;
    const operation = new AbortController();
    scope.operation = operation;
    try {
      this.changed();
      this.assert(scope);
      await command.run(input);
    } finally {
      operation.abort();
      if (scope.operation === operation) scope.operation = undefined;
      if (scope.running === command) scope.running = undefined;
      if (!this.disposed) this.changed();
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const scope of this.scopes.values()) this.close(scope);
  }

  private assert(scope: Scope): void {
    if (!scope.alive || this.disposed) throw new Error("ADAPTER_DISPOSED");
    this.backend.assertCurrent();
  }

  private message(error: unknown): string {
    return (error instanceof Error ? error.message : String(error)).slice(
      0,
      2048,
    );
  }

  private fail(scope: Scope, error: unknown): void {
    if (!scope.alive) return;
    this.diagnostics.set(scope.id, this.message(error));
    this.close(scope);
    if (!this.disposed) this.changed();
  }

  private close(scope: Scope): void {
    if (!scope.alive) return;
    scope.alive = false;
    scope.controller.abort();
    scope.operation?.abort();
    scope.commands.clear();
    scope.views.clear();
    for (const cleanup of [...scope.cleanups].reverse()) cleanup();
    scope.cleanups.clear();
  }

  private track(scope: Scope, cleanup: Unsubscribe): Unsubscribe {
    let active = true;
    const rejected = (error: unknown) => {
      if (scope.alive) this.fail(scope, error);
      else if (!this.diagnostics.has(scope.id))
        this.diagnostics.set(scope.id, this.message(error));
    };
    const once = () => {
      if (!active) return;
      active = false;
      scope.cleanups.delete(once);
      try {
        void Promise.resolve(cleanup()).catch(rejected);
      } catch (error) {
        rejected(error);
      }
    };
    if (!scope.alive) once();
    else if (scope.cleanups.size >= MAX_RESOURCES) {
      once();
      throw new Error("ADAPTER_RESOURCE_LIMIT");
    } else scope.cleanups.add(once);
    return once;
  }

  /** Serialized snapshot deliveries; invalidations coalesce, document retirement retains order. */
  private listener<T>(
    scope: Scope,
    callback: (value: T) => void | Promise<void>,
    coalesce = false,
  ) {
    if (typeof callback !== "function")
      throw new Error("INVALID_ADAPTER_LISTENER");
    let active = true;
    let running = false;
    const pending: T[] = [];
    const finish = () => {
      running = false;
      if (pending.length && active && scope.alive) {
        dispatch(pending.shift() as T);
      }
    };
    const dispatch = (value: T) => {
      if (!active || !scope.alive) return;
      try {
        const snapshot = structuredClone(value);
        if (running) {
          if (coalesce) pending.length = 0;
          if (pending.length >= 1_000) throw new Error("ADAPTER_EVENT_BACKLOG");
          pending.push(snapshot);
          return;
        }
        running = true;
        const result = callback(snapshot);
        // Also defer synchronous completion, so source reentry cannot grow the stack.
        void Promise.resolve(result).then(finish, (error: unknown) => {
          this.fail(scope, error);
          finish();
        });
      } catch (error) {
        this.fail(scope, error);
        finish();
      }
    };
    return {
      dispatch,
      stop: () => {
        active = false;
        pending.length = 0;
      },
    };
  }

  private assertToken(token: unknown): void {
    const definition = (
      token as {
        definition?: { scope?: unknown; kind?: unknown; version?: unknown };
      } | null
    )?.definition;
    if (
      definition?.scope !== "conversation" ||
      typeof definition.kind !== "string" ||
      !definition.kind.trim() ||
      !Number.isSafeInteger(definition.version) ||
      (definition.version as number) < 1
    )
      throw new Error("INVALID_DOCUMENT_TOKEN");
  }

  private operationSignal(scope: Scope): AbortSignal {
    this.assert(scope);
    if (!scope.running || !scope.operation || scope.operation.signal.aborted)
      throw new Error("ADAPTER_COMMAND_REQUIRED");
    return scope.operation.signal;
  }

  private context(scope: Scope): AdapterContext {
    const subscribe = <T>(
      callback: (value: T) => void | Promise<void>,
      attach: (dispatch: (value: T) => void) => Unsubscribe,
      immediate = false,
    ): Unsubscribe => {
      this.assert(scope);
      const listener = this.listener(scope, callback, immediate);
      let detach: Unsubscribe;
      try {
        detach = attach(listener.dispatch);
      } catch (error) {
        listener.stop();
        throw error;
      }
      const unsubscribe = this.track(scope, () => {
        listener.stop();
        detach();
      });
      if (immediate) listener.dispatch(undefined as T);
      return unsubscribe;
    };
    return {
      session: structuredClone(this.backend.session),
      sources: {
        conversation: () => {
          this.assert(scope);
          return structuredClone(this.backend.conversation());
        },
        taskGraph: () => {
          this.assert(scope);
          return structuredClone(this.backend.taskGraph());
        },
        subscribe: (callback) =>
          subscribe(
            callback,
            (dispatch) => this.backend.subscribe(() => dispatch(undefined)),
            true,
          ),
        snapshot: async (token) => {
          this.assert(scope);
          this.assertToken(token);
          const value = await this.backend.snapshot(
            token,
            scope.controller.signal,
          );
          this.assert(scope);
          return value === undefined ? undefined : structuredClone(value);
        },
        watchDocument: async (token, callback) => {
          this.assert(scope);
          this.assertToken(token);
          const listener = this.listener(scope, callback);
          let active = true;
          let detach: Unsubscribe | undefined;
          const unsubscribe = this.track(scope, () => {
            active = false;
            listener.stop();
            detach?.();
          });
          try {
            const cleanup = await this.backend.watchDocument(
              token,
              listener.dispatch,
              scope.controller.signal,
            );
            if (!active) {
              if (cleanup) this.track(scope, cleanup);
              return undefined;
            }
            detach = cleanup;
            if (!detach) {
              unsubscribe();
              return undefined;
            }
            return unsubscribe;
          } catch (error) {
            unsubscribe();
            throw error;
          }
        },
      },
      views: {
        set: (value) => {
          if (!scope.alive) return;
          this.assert(scope);
          const view = jsonCopy(validateView(value));
          const json = JSON.stringify(view);
          const previous = scope.views.get(view.id);
          if (previous?.json === json) return;
          if (!previous && scope.views.size >= MAX_VIEWS)
            throw new Error("ADAPTER_VIEW_LIMIT");
          scope.views.set(view.id, {
            view,
            json,
            revision: ++this.revision,
            actions: viewActions(view),
          });
          this.changed();
        },
        remove: (id) => {
          if (!scope.alive) return;
          this.assert(scope);
          if (scope.views.delete(id)) this.changed();
        },
      },
      commands: {
        register: (command) => {
          this.assert(scope);
          boundedText(command.id, 256);
          boundedText(command.title, 1024);
          if (
            typeof command.run !== "function" ||
            (command.allowWhileStreaming !== undefined &&
              typeof command.allowWhileStreaming !== "boolean")
          )
            throw new Error("INVALID_ADAPTER_COMMAND");
          if (scope.commands.has(command.id))
            throw new Error("DUPLICATE_COMMAND_ID");
          if (scope.commands.size >= MAX_COMMANDS)
            throw new Error("ADAPTER_COMMAND_LIMIT");
          scope.commands.set(command.id, { ...command });
          this.changed();
        },
      },
      controller: {
        configure: async (change) => {
          const signal = this.operationSignal(scope);
          await this.backend.configure(change, signal);
        },
        commit: async (change) => {
          const signal = this.operationSignal(scope);
          return this.backend.commit((tx) => {
            this.assert(scope);
            if (signal.aborted) throw new Error("ADAPTER_COMMAND_REQUIRED");
            return change(tx);
          }, signal);
        },
      },
      scope: {
        signal: scope.controller.signal,
        onDispose: (cleanup) => {
          if (typeof cleanup !== "function")
            throw new Error("INVALID_ADAPTER_CLEANUP");
          this.track(scope, cleanup);
        },
        interval: (callback, milliseconds) => {
          this.assert(scope);
          if (
            !Number.isFinite(milliseconds) ||
            milliseconds < 10 ||
            milliseconds > 2_147_483_647
          )
            throw new Error("INVALID_ADAPTER_INTERVAL");
          return subscribe(callback, (dispatch) => {
            const timer = setInterval(() => dispatch(undefined), milliseconds);
            return () => clearInterval(timer);
          });
        },
      },
    };
  }
}
