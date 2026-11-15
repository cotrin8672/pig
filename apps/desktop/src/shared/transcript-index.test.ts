import { expect, test } from "bun:test";
import type { TranscriptRecord } from "./transcript";
import { indexTranscriptTail, transcriptIndex } from "./transcript-index";

function record(id: string): TranscriptRecord {
  return {
    id,
    parentId: null,
    branchId: "branch",
    order: 0,
    kind: "message",
    message: { role: "user", content: id, timestamp: 0 },
  };
}

test("record indexes are shared per immutable array and new tails take precedence", () => {
  const old = record("one");
  const prefix = [old, record("two")];
  const tail = [{ ...old, branchId: "updated" }, record("three")];
  const combined = [...prefix, ...tail];
  const older = transcriptIndex(prefix);
  expect(transcriptIndex(prefix)).toBe(older);
  indexTranscriptTail(combined, prefix, tail);
  const index = transcriptIndex(combined);
  expect(index.get("one")).toBe(tail[0]);
  expect(index.get("two")).toBe(prefix[1]);
  expect(index.get("three")).toBe(tail[1]);
  expect(index.get("missing")).toBeUndefined();
});

test("a retained prefix index does not keep the previous live tail or source array alive", async () => {
  const prefix = [record("saved")];
  const { next, oldArray, oldLive } = (() => {
    const live = record("old-live");
    const records = [...prefix, live];
    indexTranscriptTail(records, prefix, [live]);
    const next = [...prefix, record("new-live")];
    indexTranscriptTail(next, prefix, next.slice(1));
    return { next, oldArray: new WeakRef(records), oldLive: new WeakRef(live) };
  })();
  let collected = false;
  for (let attempt = 0; attempt < 10; attempt++) {
    await Bun.sleep(0);
    Bun.gc(true);
    if (!oldArray.deref() && !oldLive.deref()) {
      collected = true;
      break;
    }
  }
  expect(collected).toBe(true);
  expect(transcriptIndex(next).get("saved")).toBe(prefix[0]);
  expect(transcriptIndex(next).get("old-live")).toBeUndefined();
});
