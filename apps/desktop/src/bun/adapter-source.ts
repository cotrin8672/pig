import type { AgentSession, EventBus } from "@earendil-works/pi-coding-agent";
import type {
  AdapterContext,
  ExtensionCommand,
  SourceEntry,
  SourceEvent,
  ToolObservation,
} from "../../../../packages/config/src";

export interface AdapterBackend {
  session: AdapterContext["session"];
  entries(scope: "branch" | "all"): readonly SourceEntry[];
  tools(): readonly ToolObservation[];
  subscribe(listener: () => void): () => void;
  onEvent(listener: (event: SourceEvent) => void): () => void;
  onBus(channel: string, listener: (data: unknown) => void): () => void;
  commands(): readonly ExtensionCommand[];
  invoke: AdapterContext["pi"]["invoke"];
  emit: AdapterContext["pi"]["emit"];
  isStreaming(): boolean;
  assertCurrent(): void;
}

export function createAdapterSource(
  session: AgentSession,
  bus: EventBus,
  assertCurrent: () => void,
  assertReady = assertCurrent,
) {
  const changes = new Set<() => void>();
  const events = new Set<(event: SourceEvent) => void>();
  const live = new Map<string, ToolObservation>();
  let savedLeaf: string | null | undefined;
  const saved = new Map<string, ToolObservation>();
  const refresh = () => {
    for (const listener of changes) listener();
  };
  const unsubscribe = session.subscribe((event) => {
    if (event.type === "tool_execution_start") {
      live.set(event.toolCallId, {
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        args: event.args,
        parentToolCallId: event.parentToolCallId,
        phase: "running",
        origin: "live",
      });
    } else if (
      event.type === "tool_execution_update" ||
      event.type === "tool_execution_end"
    ) {
      const previous = live.get(event.toolCallId);
      live.set(event.toolCallId, {
        ...previous,
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        parentToolCallId: event.parentToolCallId ?? previous?.parentToolCallId,
        origin: "live",
        phase: event.type === "tool_execution_end" ? "finished" : "running",
        result:
          event.type === "tool_execution_end"
            ? event.result
            : event.partialResult,
        isError:
          event.type === "tool_execution_end" ? event.isError : undefined,
      });
    }
    for (const listener of events) listener(event as SourceEvent);
    refresh();
  });
  const backend: AdapterBackend = {
    session: {
      id: session.sessionManager.getSessionId(),
      cwd: session.sessionManager.getCwd(),
    },
    entries: (scope) =>
      scope === "branch"
        ? session.sessionManager.getBranch()
        : session.sessionManager.getEntries(),
    tools() {
      const leaf = session.sessionManager.getLeafId();
      if (leaf !== savedLeaf) {
        saved.clear();
        for (const entry of session.sessionManager.getBranch()) {
          if (entry.type !== "message") continue;
          const message = entry.message;
          if (message.role === "assistant") {
            for (const block of message.content)
              if (block.type === "toolCall")
                saved.set(block.id, {
                  toolCallId: block.id,
                  toolName: block.name,
                  args: block.arguments,
                  phase: "finished",
                  origin: "history",
                });
          } else if (message.role === "toolResult") {
            saved.set(message.toolCallId, {
              ...saved.get(message.toolCallId),
              toolCallId: message.toolCallId,
              toolName: message.toolName,
              result: { content: message.content, details: message.details },
              isError: message.isError,
              phase: "finished",
              origin: "history",
            });
          }
        }
        savedLeaf = leaf;
      }
      const combined = new Map(saved);
      // Finished calls outside the current branch must not resurrect after rewind.
      for (const [id, observation] of live)
        if (observation.phase === "running" || saved.has(id))
          combined.set(id, observation);
      return [...combined.values()];
    },
    subscribe(listener) {
      changes.add(listener);
      return () => {
        changes.delete(listener);
      };
    },
    onEvent(listener) {
      events.add(listener);
      return () => {
        events.delete(listener);
      };
    },
    onBus: (channel, listener) => bus.on(channel, listener),
    commands: () =>
      session.extensionRunner.getRegisteredCommands().map((command) => ({
        name: command.name,
        invocationName: command.invocationName,
        source: command.sourceInfo.path,
        description: command.description,
      })),
    async invoke(input) {
      assertCurrent();
      assertReady();
      if (session.isStreaming && !input.allowWhileStreaming)
        throw new Error("AGENT_BUSY");
      const commands = session.extensionRunner
        .getRegisteredCommands()
        .filter(
          (command) =>
            command.name === input.name &&
            command.sourceInfo.path === input.source,
        );
      if (commands.length !== 1)
        throw new Error("EXTENSION_COMMAND_UNAVAILABLE");
      try {
        await commands[0].handler(
          input.args ?? "",
          session.extensionRunner.createCommandContext(),
        );
      } finally {
        refresh();
      }
    },
    emit: (channel, data) => {
      assertCurrent();
      assertReady();
      bus.emit(channel, data);
    },
    isStreaming: () => session.isStreaming,
    assertCurrent,
  };
  return {
    backend,
    refresh,
    dispose() {
      unsubscribe();
      changes.clear();
      events.clear();
      live.clear();
    },
  };
}
