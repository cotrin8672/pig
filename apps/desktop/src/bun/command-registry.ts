import { randomUUID } from "node:crypto";
import type {
  CommandContext,
  CommandConversation,
  HostCommand,
  Json,
} from "../../../../packages/config/src";
import { validateJson } from "../../../../packages/config/src/validate";
import { actionIds } from "../shared/keymap";

export const RESERVED_COMMAND_IDS: ReadonlySet<string> = new Set([
  "config.reload",
  ...actionIds,
]);
const COMMAND_ID = /^[a-z][a-z0-9_-]*(?:\.[a-zA-Z][a-zA-Z0-9_-]*)+$/;

export function validateHostCommands(
  value: unknown,
  builtin = false,
): HostCommand[] {
  if (!Array.isArray(value) || value.length > 256)
    throw new Error("commands must be an array of at most 256 entries");
  const ids = new Set<string>();
  return Array.from(value, (item: unknown) => {
    if (!item || typeof item !== "object" || Array.isArray(item))
      throw new Error("command must be an object");
    const command = item as HostCommand;
    const allowed = [
      "id",
      "title",
      "scope",
      "allowWhileStreaming",
      "validateInput",
      "enabled",
      "confirmation",
      "run",
    ];
    if (
      Reflect.ownKeys(item).some(
        (key) => typeof key !== "string" || !allowed.includes(key),
      )
    )
      throw new Error("command has unsupported properties");
    if (
      typeof command.id !== "string" ||
      command.id.length > 256 ||
      !COMMAND_ID.test(command.id)
    )
      throw new Error(
        "Command id must be namespaced (example: example.refresh)",
      );
    if (builtin !== RESERVED_COMMAND_IDS.has(command.id))
      throw new Error(`Reserved command id: ${command.id}`);
    if (ids.has(command.id))
      throw new Error(`Duplicate command id: ${command.id}`);
    ids.add(command.id);
    if (
      typeof command.title !== "string" ||
      !command.title.trim() ||
      command.title.length > 1024
    )
      throw new Error(
        "command.title must be nonempty and at most 1024 characters",
      );
    if (command.scope !== "global" && command.scope !== "conversation")
      throw new Error("command.scope must be global or conversation");
    if (
      typeof command.run !== "function" ||
      (command.validateInput !== undefined &&
        typeof command.validateInput !== "function") ||
      (command.enabled !== undefined &&
        typeof command.enabled !== "function") ||
      (command.allowWhileStreaming !== undefined &&
        typeof command.allowWhileStreaming !== "boolean")
    )
      throw new Error("Invalid command function or streaming policy");
    if (
      command.confirmation !== undefined &&
      (typeof command.confirmation !== "string" ||
        !command.confirmation.trim() ||
        command.confirmation.length > 4096)
    )
      throw new Error("Invalid command confirmation");
    return { ...command };
  });
}

export interface CommandRequest {
  generation: string;
  commandId: string;
  conversationId?: string;
  input?: Json;
}
export interface CommandDescriptor {
  id: string;
  title: string;
  scope: HostCommand["scope"];
  busy: boolean;
  disabled?: string;
}
export interface CommandRegistryPort {
  assertCurrent(): void;
  /** Return ports bound to this signal, not a Harness or a generic tool executor. */
  conversation(
    id: string,
    signal: AbortSignal,
  ): CommandConversation | undefined | Promise<CommandConversation | undefined>;
  isStreaming(id: string): boolean;
  /** Missing UI/confirmation transport fails closed. This is not permission approval. */
  confirm?(message: string, context: CommandContext): Promise<boolean>;
  /** Invoked after the command lease is released; a reload may apply at this boundary. */
  released?(): void;
}

/** Host/config-generation commands. Adapter-local IDs never enter this registry. */
export class CommandRegistry {
  readonly generation = randomUUID();
  private readonly commands = new Map<string, HostCommand>();
  private readonly leases = new Map<string | undefined, AbortController>();
  private disposed = false;

  constructor(
    commands: readonly HostCommand[],
    private readonly port: CommandRegistryPort,
    builtins: readonly HostCommand[] = [],
  ) {
    for (const command of [
      ...validateHostCommands(commands),
      ...validateHostCommands(builtins, true),
    ])
      this.commands.set(command.id, command);
  }

  get busy(): boolean {
    return this.leases.size > 0;
  }

  private assert(signal?: AbortSignal): void {
    if (this.disposed || signal?.aborted) throw new Error("COMMAND_DISPOSED");
    this.port.assertCurrent();
  }

  private readonly executing = new WeakSet<CommandContext>();

  private async context(
    id: string | undefined,
    signal: AbortSignal,
  ): Promise<CommandContext> {
    this.assert(signal);
    const conversation =
      id === undefined ? undefined : await this.port.conversation(id, signal);
    this.assert(signal);
    if (id !== undefined && !conversation)
      throw new Error("CONVERSATION_UNAVAILABLE");
    const context: CommandContext = { scope: { signal } };
    const assertRun = () => {
      this.assert(signal);
      if (!this.executing.has(context))
        throw new Error("COMMAND_EXECUTION_REQUIRED");
    };
    if (conversation)
      context.conversation = {
        session: structuredClone(conversation.session),
        sources: conversation.sources,
        controller: {
          configure: async (change) => {
            assertRun();
            await conversation.controller.configure(change);
          },
          commit: async (change) => {
            assertRun();
            return conversation.controller.commit((tx) => {
              assertRun();
              return change(tx);
            });
          },
        },
      };
    return context;
  }

  private disabled(
    command: HostCommand,
    context: CommandContext,
  ): string | undefined {
    if (command.scope === "conversation" && !context.conversation)
      return "CONVERSATION_REQUIRED";
    if (
      context.conversation &&
      this.port.isStreaming(context.conversation.session.id) &&
      !command.allowWhileStreaming
    )
      return "AGENT_BUSY";
    const reason: unknown = command.enabled?.(context);
    if (reason instanceof Promise) void reason.catch(() => {});
    if (
      reason !== undefined &&
      (typeof reason !== "string" || !reason.trim() || reason.length > 2048)
    )
      throw new Error("INVALID_COMMAND_CONDITION");
    return reason as string | undefined;
  }

  async describe(conversationId?: string): Promise<CommandDescriptor[]> {
    const controller = new AbortController();
    try {
      const context = await this.context(conversationId, controller.signal);
      return [...this.commands.values()].map((command) => ({
        id: command.id,
        title: command.title,
        scope: command.scope,
        busy: this.leases.has(
          command.scope === "global" ? undefined : conversationId,
        ),
        disabled: this.disabled(command, context),
      }));
    } finally {
      controller.abort();
    }
  }

  async invoke(request: CommandRequest): Promise<void> {
    this.assert();
    if (request.generation !== this.generation)
      throw new Error("STALE_GENERATION");
    const command = this.commands.get(request.commandId);
    if (!command) throw new Error("COMMAND_UNAVAILABLE");
    if (command.scope === "conversation" && !request.conversationId)
      throw new Error("CONVERSATION_REQUIRED");
    if (request.input !== undefined) validateJson(request.input);
    const input =
      request.input === undefined ? undefined : structuredClone(request.input);
    if (!command.validateInput && input !== undefined)
      throw new Error("COMMAND_INPUT_NOT_ALLOWED");
    const result: unknown = command.validateInput?.(input);
    if (result !== undefined) {
      if (result instanceof Promise) void result.catch(() => {});
      throw new Error("INVALID_COMMAND_VALIDATOR");
    }
    if (input !== undefined) validateJson(input);
    const key = command.scope === "global" ? undefined : request.conversationId;
    if (this.leases.has(key)) throw new Error("COMMAND_BUSY");
    const controller = new AbortController();
    this.leases.set(key, controller);
    try {
      const context = await this.context(
        request.conversationId,
        controller.signal,
      );
      const reason = this.disabled(command, context);
      if (reason) throw new Error(reason);
      if (command.confirmation) {
        if (!this.port.confirm)
          throw new Error("COMMAND_CONFIRMATION_UNAVAILABLE");
        if (!(await this.port.confirm(command.confirmation, context)))
          throw new Error("COMMAND_CANCELLED");
        this.assert(controller.signal);
        const changedReason = this.disabled(command, context);
        if (changedReason) throw new Error(changedReason);
      }
      this.assert(controller.signal);
      this.executing.add(context);
      try {
        await command.run(context, input);
      } finally {
        this.executing.delete(context);
      }
    } finally {
      controller.abort();
      this.leases.delete(key);
      this.port.released?.();
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const controller of this.leases.values()) controller.abort();
  }
}
