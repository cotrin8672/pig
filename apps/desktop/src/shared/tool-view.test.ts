import { describe, expect, test } from "bun:test";
import {
  diffStats,
  finishedWork,
  groupBlocks,
  resultText,
  shellOutcome,
} from "./tool-view";
import type { TranscriptRecord } from "./transcript";

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
    expect(work.has(7)).toBe(false); // no final text: keep the work visible
    // The response still running is never folded.
    expect(finishedWork(records.slice(0, 4), true, all).size).toBe(0);
  });
});
