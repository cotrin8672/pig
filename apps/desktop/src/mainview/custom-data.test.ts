import { expect, test } from "bun:test";
import { isVisibleRecord } from "./custom-data";

test("saved compaction is visible while other internal session entries stay hidden", () => {
  const record = {
    id: "compaction",
    parentId: null,
    branchId: "branch",
    order: 0,
    kind: "session-entry" as const,
    entryType: "compaction",
    data: { summary: "Summary", tokensBefore: 42000 },
  };
  expect(isVisibleRecord(record)).toBe(true);
  for (const entryType of ["model_change", "thinking_level_change", "usage"])
    expect(isVisibleRecord({ ...record, entryType })).toBe(false);
});

test("import provenance stays out of the chat while extension data keeps its fallback", () => {
  const record = {
    id: "metadata",
    parentId: null,
    branchId: "branch",
    order: 0,
    kind: "custom-entry" as const,
    customType: "desktop.import",
    data: { source: "chatgpt" },
  };
  expect(isVisibleRecord(record)).toBe(false);
  expect(isVisibleRecord({ ...record, customType: "extension.data" })).toBe(
    true,
  );
});
