import { expect, test } from "bun:test";
import { fauxAssistantMessage } from "@earendil-works/pi-ai";
import {
  type Message,
  responseStats,
  type TranscriptRecord,
} from "../shared/transcript";
import { createResponseFooterIndex } from "./response-footers";

function turn(id: string, message: Message): TranscriptRecord {
  return {
    id,
    entryId: id,
    branchId: "root",
    parentId: null,
    order: 0,
    kind: "message",
    message,
  };
}
const user = (id: string) =>
  turn(id, { role: "user", content: id, timestamp: 500 });
const assistant = (id: string) =>
  turn(id, { ...fauxAssistantMessage(id), timestamp: 1000, durationMs: 500 });

function oracle(records: TranscriptRecord[], running: boolean) {
  const turns = records.filter((record) => record.kind === "message");
  const result = new Map();
  for (let i = 0; i < turns.length; i++) {
    const next = turns
      .slice(i + 1)
      .find(
        (turn) =>
          turn.message.role === "user" || turn.message.role === "assistant",
      )?.message.role;
    if (next ? next === "assistant" : running) continue;
    const stats = responseStats(turns, i);
    if (stats)
      result.set(turns[i].id, {
        stats,
        user:
          stats.userIndex === undefined ? undefined : turns[stats.userIndex],
      });
  }
  return result;
}

test("footer positions and statistics match the old scan for tools, hidden/custom data and incomplete pages", () => {
  const records: TranscriptRecord[] = [
    assistant("partial"),
    user("u1"),
    assistant("a1"),
    turn("tool", {
      role: "toolResult",
      toolCallId: "call",
      toolName: "read",
      content: [],
      isError: false,
      timestamp: 1200,
    }),
    {
      id: "metadata",
      branchId: "root",
      parentId: null,
      order: 4,
      kind: "session-entry",
      entryType: "model_change",
      data: {},
    },
    turn("hidden", {
      role: "custom",
      customType: "hidden",
      display: false,
      timestamp: 1200,
      content: "hidden",
    }),
    assistant("a2"),
    user("u2"),
    assistant("a3"),
  ];
  for (const running of [false, true]) {
    const indexed = createResponseFooterIndex()(records, running);
    expect(
      [...indexed].map(([id, { stats, user }]) => [id, { stats, user }]),
    ).toEqual([...oracle(records, running)]);
  }
});

test("completed stats and copy text survive 100 live updates, then invalidate on edits, prepend and rewind", () => {
  const index = createResponseFooterIndex();
  const records = [user("u1"), assistant("a1"), user("u2"), assistant("a2")];
  const first = index(records, false).get("a1")?.stats;
  let reads = 0;
  const message =
    records[1].kind === "message" ? records[1].message : undefined;
  if (!message || message.role !== "assistant")
    throw new Error("assistant fixture");
  const content = message.content;
  Object.defineProperty(message, "content", {
    get() {
      reads++;
      return content;
    },
  });
  for (let i = 0; i < 100; i++)
    expect(
      index([...records.slice(0, 3), assistant(`live-${i}`)], true).get("a1")
        ?.stats,
    ).toBe(first);
  expect(reads).toBe(0);
  const edited = [records[0], assistant("a1"), ...records.slice(2)];
  expect(index(edited, false).get("a1")?.stats).not.toBe(first);
  const prepended = [user("earlier"), assistant("earlier-answer"), ...edited];
  expect(
    [...index(prepended, false)].map(([id, { stats, user }]) => [
      id,
      { stats, user },
    ]),
  ).toEqual([...oracle(prepended, false)]);
  expect([
    ...index([user("fork"), assistant("fork-answer")], false).keys(),
  ]).toEqual(["fork-answer"]);
  expect(index([], false).size).toBe(0);
});

test("saved entries reuse stats after 100 IPC clones and invalidate on a branch revision", () => {
  const index = createResponseFooterIndex();
  const records = [user("u1"), assistant("a1"), user("u2"), assistant("a2")];
  const first = index(records, false, "branch-1").get("a1")?.stats;
  let reads = 0;
  for (let i = 0; i < 100; i++) {
    const incoming = structuredClone(records);
    const record = incoming[1];
    if (record.kind !== "message" || record.message.role !== "assistant")
      throw new Error("assistant fixture");
    const content = record.message.content;
    Object.defineProperty(record.message, "content", {
      get() {
        reads++;
        return content;
      },
    });
    expect(index(incoming, true, "branch-1").get("a1")?.stats).toBe(first);
  }
  expect(reads).toBe(0);
  expect(
    index(structuredClone(records), false, "branch-2").get("a1")?.stats,
  ).not.toBe(first);
  const partial = [assistant("partial")];
  const partialStats = index(partial, false, "branch-2").get("partial")?.stats;
  const full = [user("earlier-user"), ...partial];
  expect(index(full, false, "branch-2").get("partial")?.stats).not.toBe(
    partialStats,
  );
  expect(index(full, false, "branch-2").get("partial")?.stats).toEqual(
    oracle(full, false).get("partial").stats,
  );
});

test.each([
  100, 1000, 10000,
])("%i turns require a linear number of record visits", (count) => {
  let visits = 0;
  const records = Array.from({ length: count }, (_, i) =>
    i % 2 ? assistant(`a${i}`) : user(`u${i}`),
  );
  const observed = new Proxy(records, {
    get(target, key, receiver) {
      if (typeof key === "string" && /^\d+$/.test(key)) visits++;
      return Reflect.get(target, key, receiver);
    },
  });
  const index = createResponseFooterIndex();
  expect(index(observed, false).size).toBe(count / 2);
  expect(visits).toBe(count);
});
