// Repository-relative imports for typecheck. Copied configs use @earendil-works/pi-durable and @pig/config.
import {
  defineExtension,
  defineTool,
  section,
} from "../../apps/desktop/node_modules/@earendil-works/pi-durable";
import { defineConfig } from "../../packages/config/src";
import {
  ArtifactDoc,
  DelegationDoc,
  ModeDoc,
  nativeDelegationAdapter,
  nativeDocumentAdapter,
  nativeModeAdapter,
  nativeTodoAdapter,
  TodoDoc,
} from "./durable-adapters";

const ReadTodos = defineTool({
  name: "read_todos",
  description: "Read the native TODO document (no filesystem or shell access)",
  parameters: { type: "object", properties: {}, additionalProperties: false },
  replay: "safe",
  async execute(_args, api, context) {
    const value = await api.snapshot(TodoDoc, api.conversationId, context);
    return {
      output: [
        {
          type: "text",
          text:
            value === undefined
              ? "TODO document unavailable"
              : JSON.stringify(value),
        },
      ],
    };
  },
});
const CompleteTodos = defineTool({
  name: "complete_todos",
  description: "Mark every TODO complete",
  replay: "unsafe",
  parameters: { type: "object", properties: {}, additionalProperties: false },
  async execute(_args, api, context) {
    await api.commit(async (tx) => {
      const value = await tx.doc(TodoDoc, api.conversationId);
      for (const item of value.items) item.done = true;
      value.revision++;
    }, context);
    return { output: [{ type: "text", text: "TODO changes committed" }] };
  },
});
const NativeDomains = defineExtension({
  name: "example.domains",
  tools: [ReadTodos, CompleteTodos],
  sections: [
    section(
      "domain_policy",
      () =>
        "TODO, workflow, owned delegation and artifacts are separate native documents.",
    ),
  ],
});

export default defineConfig({
  apiVersion: 2,
  runtime: {
    extensions: [NativeDomains],
    profiles: {
      main: {
        extensions: [NativeDomains],
        tools: [ReadTodos, CompleteTodos],
        maxTurns: 8,
      },
      // Actual callable allowlist: writes are absent from tools, not merely modelTools/prompts.
      research: {
        extensions: [NativeDomains],
        tools: [ReadTodos],
        modelTools: [ReadTodos],
        instructions: "Observe and report; no write tools or arbitrary shell.",
        maxTurns: 4,
      },
    },
    defaultProfile: "main",
    async conversationCreated(tx, conversation) {
      await tx.doc(TodoDoc, conversation.id);
      await tx.doc(ModeDoc, conversation.id);
      await tx.doc(DelegationDoc, conversation.id);
      await tx.doc(ArtifactDoc, conversation.id);
    },
  },
  commands: [
    {
      id: "example.research",
      title: "Use read-only research profile",
      scope: "conversation",
      async run(ctx) {
        if (!ctx.conversation) throw new Error("CONVERSATION_REQUIRED");
        await ctx.conversation.controller.configure({
          extensions: [NativeDomains],
          tools: [ReadTodos],
          modelTools: [ReadTodos],
          instructions:
            "Observe and report; no write tools or arbitrary shell.",
          maxTurns: 4,
        });
      },
    },
  ],
  sessionAdapters: [
    nativeTodoAdapter(),
    nativeModeAdapter(),
    nativeDelegationAdapter(),
    nativeDocumentAdapter(),
  ],
  // Host-command bindings are a separate contract; renderer wiring requires UI approval.
  keymaps: [
    {
      keys: "Ctrl+Shift+R",
      adapter: "native-mode",
      command: "review",
      when: "panel",
    },
  ],
});
