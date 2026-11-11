import { expect, test } from "bun:test";
import { hydrate } from "../shared/transcript";
import { findMessages } from "./TranscriptSearch";

test("loaded search includes Japanese and collapsed tool output but excludes image bytes", () => {
  const state = hydrate([
    {
      role: "user",
      timestamp: 1,
      content: [
        { type: "text", text: "手順を表示" },
        { type: "image", data: "hiddenbytes", mimeType: "image/png" },
      ],
    },
  ]);
  const base = state.records[0];
  const records = [
    ...state.records,
    {
      ...base,
      id: "call",
      kind: "message" as const,
      message: {
        role: "assistant",
        content: [{ type: "toolCall", id: "t1", name: "read", arguments: {} }],
      },
    },
    {
      ...base,
      id: "result",
      kind: "message" as const,
      message: {
        role: "toolResult",
        toolCallId: "t1",
        content: [{ type: "text", text: "手順の結果" }],
      },
    },
  ] as typeof state.records;
  expect(findMessages(records, "手順").map((r) => r.id)).toEqual([
    base.id,
    "call",
  ]);
  expect(findMessages(records, "hiddenbytes")).toEqual([]);
  expect(findMessages(records, "結果")[0]?.toolCallId).toBe("t1");
  expect(findMessages(records, "   ")).toEqual([]);
});
