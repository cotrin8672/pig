import { expect, test } from "bun:test";
import { parseChatHistory } from "./chat-history-parser";

export const chatgptFixture = {
  id: "original-chat",
  title: "Branching ChatGPT",
  create_time: 1700000000,
  current_node: "active",
  mapping: {
    root: { parent: null, message: null },
    question: {
      parent: "root",
      message: {
        author: { role: "user" },
        content: { parts: ["Question"] },
        create_time: 1700000001,
      },
    },
    active: {
      parent: "question",
      message: {
        author: { role: "assistant" },
        content: { parts: ["Active answer"] },
        metadata: { model_slug: "gpt-source" },
        create_time: 1700000002,
      },
    },
    discarded: {
      parent: "question",
      message: {
        author: { role: "assistant" },
        content: { parts: ["Other answer"] },
        create_time: 1700000003,
      },
    },
  },
};

export const claudeFixture = {
  uuid: "claude-original",
  name: "Claude conversation",
  created_at: "2024-01-02T03:04:05Z",
  chat_messages: [
    {
      uuid: "human",
      sender: "human",
      text: "Question",
      attachments: [{ file_name: "private.txt" }],
    },
    {
      uuid: "answer",
      sender: "assistant",
      text: "Do not duplicate this flattened text",
      content: [
        { type: "text", text: "Answer" },
        { type: "thinking", thinking: "Private reasoning" },
        { type: "tool_use", name: "bash", input: { command: "never execute" } },
      ],
    },
  ],
};

test("ChatGPT preserves all branches, selected node, source model and original timestamps", () => {
  const parsed = parseChatHistory(JSON.stringify([chatgptFixture]));
  expect(parsed.rejected).toBe(0);
  const item = parsed.conversations[0];
  expect(item.activeId).toBe("active");
  expect(item.nodes.map((node) => [node.id, node.parentId])).toEqual([
    ["question", null],
    ["active", "question"],
    ["discarded", "question"],
  ]);
  expect(item.nodes[1].model).toBe("gpt-source");
  expect(item.nodes[0].timestamp).toBe(1700000001000);
});

test("Claude handles text and content without duplicating flattened text or executable blocks", () => {
  const item = parseChatHistory(JSON.stringify([claudeFixture]))
    .conversations[0];
  expect(item.nodes.map((node) => node.text)).toEqual(["Question", "Answer"]);
  expect(item.nodes[1].parentId).toBe("human");
  expect(item.nodes[0].timestamp).toBe(Date.parse(claudeFixture.created_at));
  expect(item.warnings).toEqual(["attachments", "reasoning", "tools"]);
});

test("Claude uses explicit branch pointers, including pointers through skipped messages", () => {
  const item = parseChatHistory(
    JSON.stringify({
      uuid: "branched",
      current_leaf_message_uuid: "a",
      chat_messages: [
        { uuid: "q", sender: "human", parent_message_uuid: null, text: "Q" },
        {
          uuid: "skip",
          sender: "assistant",
          parent_message_uuid: "q",
          content: [{ type: "thinking" }],
        },
        {
          uuid: "b",
          sender: "assistant",
          parent_message_uuid: "q",
          text: "Other",
        },
        {
          uuid: "a",
          sender: "assistant",
          parent_message_uuid: "skip",
          text: "Chosen",
        },
      ],
    }),
  ).conversations[0];
  expect(item.activeId).toBe("a");
  expect(item.nodes.find((node) => node.id === "a")?.parentId).toBe("q");
  expect(item.nodes.find((node) => node.id === "b")?.parentId).toBe("q");
});

test("Claude's zero UUID is a root marker, not a missing branch", () => {
  const item = parseChatHistory(
    JSON.stringify({
      uuid: "claude",
      chat_messages: [
        {
          uuid: "q",
          parent_message_uuid: "00000000-0000-0000-0000-000000000000",
          sender: "human",
          text: "Question",
        },
      ],
    }),
  ).conversations[0];
  expect(item.nodes[0].parentId).toBeNull();
  expect(item.warnings).not.toContain("branches");
});

test("system, tool, analysis and multimodal objects do not become model-visible instructions", () => {
  const item = parseChatHistory(
    JSON.stringify({
      id: "mixed",
      current_node: "a",
      mapping: {
        q: {
          parent: null,
          message: {
            author: { role: "user" },
            content: { parts: ["Q", { image_asset_pointer: "file://secret" }] },
          },
        },
        s: {
          parent: "q",
          message: {
            author: { role: "system" },
            content: { parts: ["Untrusted system"] },
          },
        },
        t: {
          parent: "s",
          message: {
            author: { role: "tool" },
            content: { parts: ["Untrusted tool"] },
          },
        },
        thinking: {
          parent: "t",
          message: {
            author: { role: "assistant" },
            channel: "analysis",
            content: { parts: ["Hidden reasoning"] },
          },
        },
        a: {
          parent: "thinking",
          message: {
            author: { role: "assistant" },
            content: { parts: ["Visible"] },
          },
        },
      },
    }),
  ).conversations[0];
  expect(item.nodes.map((node) => node.text)).toEqual(["Q", "Visible"]);
  expect(item.nodes[1].parentId).toBe("q");
  expect(item.warnings).toContain("attachments");
  expect(item.warnings).toContain("instructions");
  expect(item.warnings).toContain("tools");
  expect(item.warnings).toContain("reasoning");
});

test("rejects cycles and duplicate IDs per conversation, keeping other conversations", () => {
  const parsed = parseChatHistory(
    JSON.stringify([
      {
        chat_messages: [
          { uuid: "same", sender: "human", text: "a" },
          { uuid: "same", sender: "assistant", text: "b" },
        ],
      },
      { mapping: { a: { parent: "b" }, b: { parent: "a" } } },
      { completely: "unknown" },
      chatgptFixture,
    ]),
  );
  expect(parsed.rejected).toBe(3);
  expect(parsed.conversations).toHaveLength(1);
  expect(parsed.conversations[0].id).toBe("3");
});

test("missing parents and active IDs are reported; invalid JSON never echoes private content", () => {
  const item = parseChatHistory(
    JSON.stringify({
      current_node: "missing",
      mapping: {
        q: {
          parent: "missing",
          message: { author: { role: "user" }, content: { parts: ["Q"] } },
        },
      },
    }),
  ).conversations[0];
  expect(item.warnings).toContain("branches");
  expect(item.activeId).toBe("q");
  expect(() => parseChatHistory('{"private secret"')).toThrow("Invalid JSON.");
  expect(() => parseChatHistory('{"private secret"')).not.toThrow(
    "private secret",
  );
  expect(() => parseChatHistory("[]")).toThrow("1–5000");
  expect(() => parseChatHistory("{}")).toThrow("No readable");
});

test("wide and deep trees do not depend on recursive traversal or spread argument limits", () => {
  const messages = Array.from({ length: 20000 }, (_, index) => ({
    uuid: `m${index}`,
    sender: "human",
    text: String(index),
  }));
  const result = parseChatHistory(JSON.stringify({ chat_messages: messages }));
  expect(result.conversations[0].nodes).toHaveLength(messages.length);
});
