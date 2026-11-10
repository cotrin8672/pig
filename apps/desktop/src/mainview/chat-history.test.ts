import { expect, test } from "bun:test";
import type { Snapshot } from "../shared/rpc-schema";
import { emptyTranscript, type Transcript } from "../shared/transcript";
import { applyChatEvent, newerSnapshot, prependHistory } from "./chat-snapshot";

function history(start: number, end: number, revision = "branch"): Transcript {
  return {
    ...emptyTranscript(),
    history: { revision, before: start ? `entry:${start}` : undefined },
    records: Array.from({ length: end - start }, (_, i) => ({
      id: `entry:${start + i}`,
      entryId: `entry:${start + i}`,
      parentId: start + i ? `entry:${start + i - 1}` : null,
      branchId: revision,
      order: start + i,
      kind: "message" as const,
      message: { role: "user" as const, content: `${start + i}`, timestamp: i },
    })),
  };
}
function snapshot(transcript: Transcript): Snapshot {
  return {
    address: { hostId: "history", sessionId: "chat", epoch: 1 },
    snapshotSeq: 1,
    info: { id: "chat", cwd: "project", title: "History", modified: 1 },
    effort: "off",
    effortLevels: [],
    transcript,
  };
}

test("only requested older pages are prepended, without changing live state or duplicating retries", () => {
  const current = snapshot(history(100, 150));
  current.transcript.running = true;
  const expanded = prependHistory(current, history(50, 100), "entry:100");
  expect(expanded.transcript.records).toHaveLength(100);
  expect(expanded.transcript.history?.before).toBe("entry:50");
  expect(expanded.transcript.running).toBe(true);
  expect(expanded.snapshotSeq).toBe(current.snapshotSeq);
  expect(prependHistory(expanded, history(50, 100), "entry:100")).toBe(
    expanded,
  );
  expect(
    prependHistory(current, history(50, 100, "old-branch"), "entry:100"),
  ).toBe(current);
});

test("ready, streaming and reconnect tail snapshots preserve loaded pages and tool results", () => {
  const loaded = prependHistory(
    snapshot(history(100, 150)),
    history(50, 100),
    "entry:100",
  );
  loaded.transcript.tools.older = { status: "done", result: "older result" };
  for (const incoming of [history(100, 150), history(101, 151)]) {
    const ready = newerSnapshot(
      { ...loaded, ready: false },
      { ...snapshot(incoming), snapshotSeq: 2 },
    );
    expect(ready.ready).toBeUndefined();
    expect(ready.transcript.records[0].id).toBe("entry:50");
    expect(ready.transcript.history?.before).toBe("entry:50");
    expect(ready.transcript.tools.older.result).toBe("older result");
    const streaming = applyChatEvent(loaded, {
      type: "snapshot",
      address: loaded.address,
      snapshotSeq: 3,
      transcript: incoming,
    });
    expect(streaming.transcript.records[0].id).toBe("entry:50");
    expect(new Set(streaming.transcript.records.map((r) => r.id)).size).toBe(
      streaming.transcript.records.length,
    );
  }
});

test("rewind or replacement drops old pages; reconnect gaps are not silently joined", () => {
  const current = snapshot(history(50, 150));
  for (const incoming of [history(0, 10, "new-branch"), history(250, 300)]) {
    const next = newerSnapshot(current, {
      ...snapshot(incoming),
      snapshotSeq: 2,
    });
    expect(next.transcript).toBe(incoming);
  }
  const nextOwner = {
    ...snapshot(history(0, 10)),
    address: { ...current.address, epoch: 2 },
  };
  expect(newerSnapshot(current, nextOwner).transcript).toBe(
    nextOwner.transcript,
  );
});
