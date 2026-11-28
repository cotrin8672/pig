import type { ToolCall } from "@earendil-works/pi-ai";
import type { ChatRenderData } from "@pig/chat-renderers";

export type Tool = Omit<ChatRenderData["tool"], "call"> & {
  call: Omit<ToolCall, "type">;
};
export type ToolFixture = {
  tool: Tool;
  error: string;
};

export function atPhase(
  { tool, error }: ToolFixture,
  phase: "running" | "error",
): Tool {
  return phase === "running"
    ? { ...tool, live: true, state: undefined }
    : {
        ...tool,
        state: {
          status: "error",
          result: { content: [{ type: "text", text: error }] },
        },
      };
}
