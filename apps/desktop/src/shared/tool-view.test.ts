import { describe, expect, test } from "bun:test";
import {
  diffStats,
  fileChanges,
  finishedWork,
  groupBlocks,
  resultText,
  shellOutcome,
} from "./tool-view";
import type { TranscriptRecord } from "./transcript";

test("fileChanges sums successful edit, write and apply_patch per file", () => {
  const call = (id: string, name: string, args: object) => ({
    type: "toolCall",
    id,
    name,
    arguments: args,
  });
  const result = (id: string, isError = false, details?: object) => ({
    message: { role: "toolResult", toolCallId: id, isError, details },
  });
  const turns = [
    { message: { role: "user", content: "go" } },
    {
      message: {
        role: "assistant",
        content: [
          call("e", "edit", { path: "a.ts" }),
          call("w", "write", { path: "b.ts", content: "1\n2" }),
          call("p", "apply_patch", {
            patch:
              "*** Begin Patch\n*** Update File: a.ts\n@@\n-x\n+y\n*** End Patch",
          }),
          call("f", "edit", { path: "c.ts" }),
        ],
      },
    },
    result("e", false, { diff: "-1 a\n+1 b\n+2 c" }),
    result("w"),
    result("p"),
    result("f", true, { diff: "+1 x" }),
  ] as unknown as Parameters<typeof fileChanges>[0];
  expect(fileChanges(turns)).toEqual([
    { path: "a.ts", added: 3, removed: 2 },
    { path: "b.ts", added: 2, removed: 0 },
  ]);
});

let order = 0;
const rec = (message: unknown): TranscriptRecord =>
  ({
    id: `r${order}`,
    parentId: null,
    branchId: "b",
    order: order++,
    kind: "message",
    message,
  }) as TranscriptRecord;
const user = () => rec({ role: "user", content: "q", timestamp: 0 });
const assistant = (...content: unknown[]) =>
  rec({ role: "assistant", content, timestamp: 0 });
const text = (value: string) => ({ type: "text", text: value });
const call = { type: "toolCall", id: "c", name: "bash", arguments: {} };

describe("tool-view", () => {
  test("resultText joins text blocks and ignores images", () => {
    expect(
      resultText({
        content: [
          { type: "text", text: "a" },
          { type: "image", data: "x", mimeType: "image/png" },
          { type: "text", text: "b" },
        ],
      }),
    ).toBe("a\nb");
    expect(resultText(undefined)).toBe("");
  });

  test("shellOutcome strips the exit status line", () => {
    expect(shellOutcome("out\n\nCommand exited with code 2")).toEqual({
      output: "out",
      exitCode: 2,
    });
    expect(shellOutcome("fine")).toEqual({ output: "fine" });
  });

  test("diffStats counts added and removed lines", () => {
    expect(diffStats(" 1 a\n-2 b\n+2 c\n+3 d\n   ...")).toEqual({
      added: 2,
      removed: 1,
    });
  });

  test("groupBlocks merges consecutive exploration calls only", () => {
    const runs = groupBlocks([
      { type: "text" },
      { type: "toolCall", name: "read" },
      { type: "toolCall", name: "grep" },
      { type: "toolCall", name: "bash" },
      { type: "toolCall", name: "ls" },
    ]);
    expect(runs.map((run) => [run.start, run.blocks.length])).toEqual([
      [0, 1],
      [1, 2],
      [3, 1],
      [4, 1],
    ]);
  });

  test("large exploration batches are grouped with linear work", () => {
    let checks = 0;
    const blocks = Array.from({ length: 2000 }, () => ({
      type: "toolCall",
      get name() {
        checks++;
        return "read";
      },
    }));
    const runs = groupBlocks(blocks);
    expect(runs).toHaveLength(1);
    expect(runs[0].blocks).toEqual(blocks);
    expect(checks).toBeLessThan(blocks.length * 6);
  });

  test("finishedWork folds finished responses with work, keeps the final answer", () => {
    const records = [
      user(),
      assistant(text("looking"), call),
      rec({ role: "toolResult", toolCallId: "c", content: [] }),
      assistant(text("done")),
      user(),
      assistant(text("plain answer")),
      user(),
      assistant(call),
    ];
    const all = () => true;
    const work = finishedWork(records, false, all);
    expect(work.get(1)).toEqual({ key: "r1", first: 1, final: 3, tools: 1 });
    expect(work.get(3)).toBe(work.get(1));
    expect(work.has(5)).toBe(false); // plain answer: nothing to fold
    // No final text (interrupted): still folded by default.
    expect(work.get(7)).toEqual({ key: "r7", first: 7, final: 7, tools: 1 });
    // A running response folds as soon as its newest message is the answer.
    expect(finishedWork(records.slice(0, 4), true, all).get(1)).toEqual({
      key: "r1",
      first: 1,
      final: 3,
      tools: 1,
    });
    // ...but not while it is still calling tools.
    expect(finishedWork(records.slice(0, 3), true, all).size).toBe(0);
  });

  test("an extension message after a finished response folds each response on its own", () => {
    const all = () => true;
    const step = () =>
      rec({ role: "assistant", content: [call], stopReason: "toolUse" });
    const answer = () =>
      rec({ role: "assistant", content: [text("a")], stopReason: "stop" });
    const steer = () =>
      rec({ role: "custom", customType: "x", content: "s", display: true });
    const records = [
      user(),
      step(),
      steer(), // mid-run steering stays inside the response
      answer(),
      steer(), // arrives after the answer: a new response
      step(),
      answer(),
    ];
    const work = finishedWork(records, false, all);
    expect(work.get(1)).toMatchObject({ first: 1, final: 3 });
    expect(work.get(2)).toBe(work.get(1));
    expect(work.has(4)).toBe(false);
    expect(work.get(5)).toMatchObject({ first: 5, final: 6 });
  });
});
