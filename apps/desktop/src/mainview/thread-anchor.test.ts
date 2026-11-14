import { expect, test } from "bun:test";
import {
  captureThreadAnchor,
  restoreThreadAnchor,
  type ThreadAnchor,
} from "./thread-anchor";

function fixture() {
  let rowTop = 80;
  let writes = 0;
  let scrollTop = 120;
  let contains = true;
  let height = 2000;
  const record = {
    getBoundingClientRect: () => ({ top: rowTop, bottom: rowTop + 100 }),
  } as HTMLElement;
  const thread = {
    get scrollTop() {
      return scrollTop;
    },
    set scrollTop(value: number) {
      writes++;
      scrollTop = value;
    },
    get scrollHeight() {
      return height;
    },
    getBoundingClientRect: () => ({
      top: 10,
      bottom: 610,
      left: 0,
      width: 600,
      height: 600,
    }),
    contains: () => contains,
    ownerDocument: { elementFromPoint: () => ({ closest: () => record }) },
    querySelectorAll: () => [record],
  } as unknown as HTMLElement;
  return {
    thread,
    record,
    grow: (delta: number) => {
      height += delta;
    },
    move: (value: number) => {
      rowTop = value;
    },
    detach: () => {
      contains = false;
    },
    writes: () => writes,
  };
}

test("prepend anchoring compensates only growth above the reader, not streaming below", () => {
  const f = fixture();
  const anchor = captureThreadAnchor(f.thread);
  expect(anchor.record).toBe(f.record);
  expect(anchor.offset).toBe(70);
  f.grow(800); // 300 above; 500 below.
  f.move(380);
  restoreThreadAnchor(f.thread, anchor);
  expect(f.thread.scrollTop).toBe(420);
  expect(f.writes()).toBe(1);
});

test("native anchoring that already kept the reader in place does not cause a second scroll correction", () => {
  const f = fixture();
  const anchor = captureThreadAnchor(f.thread);
  f.grow(800);
  restoreThreadAnchor(f.thread, anchor);
  expect(f.thread.scrollTop).toBe(120);
  expect(f.writes()).toBe(0);
});

test("an unavailable anchor falls back to the previous scroll geometry", () => {
  const f = fixture();
  const anchor: ThreadAnchor = {
    record: f.record,
    offset: 70,
    top: 120,
    height: 2000,
  };
  f.detach();
  f.grow(300);
  restoreThreadAnchor(f.thread, anchor);
  expect(f.thread.scrollTop).toBe(420);
});
