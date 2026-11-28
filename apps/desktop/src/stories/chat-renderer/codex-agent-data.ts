import type { TranscriptRecord } from "../../shared/transcript";
import type { Tool, ToolFixture } from "./tool-fixture";

/*
 * Fixtures for @ogulcancelik/pi-codex-subagents 0.3.5. Arguments and results
 * follow its tool definitions (index.ts): JSON text bodies, compact details.
 */

const text = (value: string, details?: unknown) => ({
  status: "done" as const,
  result: { content: [{ type: "text", text: value }], details },
});
const tool = (
  id: string,
  name: string,
  args: Tool["call"]["arguments"],
  state: ReturnType<typeof text>,
  error: string,
): ToolFixture => ({
  tool: { call: { id, name, arguments: args }, live: false, state },
  error,
});

const reviewTask =
  "送信パイプラインで二重送信や下書き消失が起きる経路をレビューして。ファイルは変更しないこと。";
const reviewAnswer =
  "## 指摘 2件\n\n1. `send-controller.ts` の再送で受付済みの requestId を消す前に下書きを消している。\n2. Steering の回収時に添付が二重に戻る。";

export const spawnAgent = tool(
  "spawn",
  "spawn_agent",
  { task_name: "review", message: reviewTask, agent_type: "reviewer" },
  text("Spawned review.", {
    task_name: "review",
    provider: "anthropic",
    modelId: "claude-opus-5-5",
    thinking: "high",
  }),
  'spawn_agent failed: agent "review" already exists in this session.',
);

export const waitAgent = tool(
  "wait",
  "wait_agent",
  { targets: ["review"] },
  text(
    JSON.stringify(
      {
        message: "Wait completed: review completed.",
        event: {
          agentName: "review",
          status: "completed",
          finalResponse: reviewAnswer,
        },
      },
      null,
      2,
    ),
    { message: "Wait completed: review completed." },
  ),
  "wait_agent failed: no session-owned agent matches review.",
);

export const waitAllAgents = tool(
  "wait-all",
  "wait_all_agents",
  {},
  text(
    JSON.stringify(
      {
        message: "All 3 agents finished.",
        responses: [
          {
            agent_name: "review",
            status: "completed",
            finalResponse: reviewAnswer,
          },
          {
            agent_name: "scout/tests",
            status: "completed",
            finalResponse:
              "送信系のテストは steering-recovery.test.ts に集約。",
          },
          {
            agent_name: "scout/docs",
            status: "failed",
            error: "Model request failed: rate limited",
          },
        ],
      },
      null,
      2,
    ),
    { message: "All 3 agents finished." },
  ),
  "wait_all_agents failed: no agents were spawned in this session.",
);

export const listAgents = (() => {
  const details = {
    total: 3,
    returned: 3,
    offset: 0,
    limit: 10,
    next_offset: null,
    agents: [
      { agent_name: "review", agent_status: "running" },
      { agent_name: "scout/tests", agent_status: "completed" },
      { agent_name: "scout/docs", agent_status: "failed" },
    ],
  };
  return tool(
    "list",
    "list_agents",
    {},
    text(JSON.stringify(details, null, 2), details),
    "list_agents failed: agent storage is unavailable.",
  );
})();

export const readAgentResponse = tool(
  "read",
  "read_agent_response",
  { target: "review" },
  text(
    JSON.stringify(
      {
        agent_name: "review",
        status: "completed",
        finalResponse: reviewAnswer,
        last_task_message: reviewTask,
      },
      null,
      2,
    ),
    { agent_name: "review", status: "completed" },
  ),
  "read_agent_response failed: review has no final response yet.",
);

export const sendMessage = tool(
  "send",
  "send_message",
  { target: "review", message: "Steering の回収経路も見て。" },
  text("Message steered into the running agent.", {
    target: "review",
    delivery: "steer",
  }),
  "send_message failed: review is not a session-owned agent.",
);

export const interruptAgent = tool(
  "interrupt",
  "interrupt_agent",
  { target: "review" },
  text("Interrupt request handled.", { previous_status: "running" }),
  "interrupt_agent failed: review is not a session-owned agent.",
);

/** An extension message to the agent, as saved in the session. */
export function customMessage(
  id: string,
  customType: string,
  content: unknown,
  details?: unknown,
): TranscriptRecord {
  return {
    id,
    entryId: id,
    parentId: null,
    branchId: "preview",
    order: 0,
    kind: "message",
    message: {
      role: "custom",
      customType,
      content,
      display: true,
      details,
      timestamp: Date.UTC(2026, 10, 21, 0, 0),
    },
  };
}

/** pi-codex-subagents' completion notice, wrapped exactly as it sends it. */
export const subagentCompletion = (
  id: string,
  agent: string,
  status: "completed" | "failed",
  body: string,
) =>
  customMessage(
    id,
    "pi-codex-subagent-completion",
    `<subagent_notification>\n${JSON.stringify(
      {
        agent_name: agent,
        status,
        ...(status === "failed" ? { error: body } : { final_response: body }),
      },
      null,
      2,
    )}\n</subagent_notification>`,
    { agent_name: agent, status },
  );

export const reviewCompletion = subagentCompletion(
  "completion-review",
  "review",
  "completed",
  reviewAnswer,
);
