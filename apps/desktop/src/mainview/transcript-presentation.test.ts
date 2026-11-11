import { expect, test } from "bun:test";
import { createTextSampler } from "./streaming-text";
import { lastLines, TEXT_PAGE_CHARS, textRange } from "./text-range";
import {
  frameTask,
  pruneThreadViews,
  recordWindow,
  threadView,
} from "./thread-scroll";

test("50/1,000/10,000 loaded records stay intact with at most 100 presented and arbitrary search jumps", () => {
  for (const count of [50, 1_000, 10_000]) {
    const records = Array.from({ length: count }, (_, i) => ({
      id: `record-${i}`,
    }));
    expect(recordWindow(records)).toEqual({
      start: Math.max(0, count - 100),
      end: count,
    });
    const restored: string[] = [];
    for (let start = 0; start < count; start += 100) {
      const range = recordWindow(records, records[start].id);
      expect(range.end - range.start).toBeLessThanOrEqual(100);
      restored.push(...records.slice(range.start, range.end).map((r) => r.id));
    }
    expect(restored).toEqual(records.map((r) => r.id));
    expect(recordWindow(records, records[25].id).start).toBe(25);
    // Appending never shifts a reader's first record; missing rewind anchors fall back to the tail.
    expect(
      recordWindow([...records, { id: "new" }], records[25].id).start,
    ).toBe(25);
    expect(recordWindow(records, "removed")).toEqual(recordWindow(records));
  }
});

test("huge diff, output and one-line Unicode ranges restore every character without overlap", () => {
  for (const text of [
    Array.from({ length: 10_000 }, (_, i) => `+${i} line\n`).join(""),
    `${"x".repeat(TEXT_PAGE_CHARS - 1)}😀${"z".repeat(100_000)}`,
  ]) {
    let start = 0;
    const pages: string[] = [];
    while (start < text.length) {
      const range = textRange(text, start);
      expect(range.end).toBeGreaterThan(start);
      expect(range.text.length).toBeLessThanOrEqual(TEXT_PAGE_CHARS);
      expect(range.text.split("\n").length).toBeLessThanOrEqual(201);
      expect(range.text).not.toMatch(/[\uD800-\uDBFF]$/);
      pages.push(range.text);
      start = range.end;
    }
    expect(pages.join("")).toBe(text);
  }
  expect(lastLines("old\nlast\ntail")).toBe("last\ntail");
  expect(lastLines("only")).toBe("only");
});

test("100 token updates and repeated layout requests share work; final text cancels any old sample", () => {
  expect(() => frameTask(() => {})).not.toThrow(); // SSR has no animation-frame globals.
  const tasks = new Map<number, () => void>();
  let id = 0;
  const schedule = (task: () => void) => {
    tasks.set(++id, task);
    return id;
  };
  const cancel = (key: number) => {
    tasks.delete(key);
  };
  const samples: string[] = [];
  const sampler = createTextSampler(
    (text) => samples.push(text),
    schedule as never,
    cancel as never,
  );
  for (let i = 0; i < 100; i++) sampler.update(`token ${i}`, true);
  expect(tasks.size).toBe(1);
  const next = [...tasks.values()][0];
  tasks.clear();
  next();
  expect(samples).toEqual(["token 99"]);
  sampler.update("unfinished fence ```", true);
  sampler.update("final table / reference / math", false);
  expect(tasks.size).toBe(0);
  expect(samples.at(-1)).toBe("final table / reference / math");
  let layouts = 0;
  const frame = frameTask(() => layouts++, schedule, cancel);
  for (let i = 0; i < 100; i++) frame.schedule();
  expect(tasks.size).toBe(1);
  const update = [...tasks.values()][0];
  tasks.clear();
  update();
  expect(layouts).toBe(1);
  frame.schedule();
  frame.dispose();
  sampler.dispose();
  expect(tasks.size).toBe(0);
});

test("view state survives navigation and owner epoch changes and is released after close", () => {
  const view = threadView("host", "chat");
  view.follow = false;
  view.work.tool = true;
  view.details.diff = true;
  pruneThreadViews({
    chat: { address: { hostId: "host", sessionId: "chat" } },
  });
  expect(threadView("host", "chat")).toBe(view);
  pruneThreadViews({});
  expect(threadView("host", "chat")).not.toBe(view);
  expect(threadView("different-host", "chat").work).toEqual({});
  pruneThreadViews({});
});
