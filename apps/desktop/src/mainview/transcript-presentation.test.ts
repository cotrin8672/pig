import { expect, test } from "bun:test";
import { createTextSampler } from "./streaming-text";
import { frameTask, pruneThreadViews, threadView } from "./thread-scroll";

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
