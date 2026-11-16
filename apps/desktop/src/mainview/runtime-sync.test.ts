import { expect, test } from "bun:test";
import { type PublicationPhase, RuntimeSync } from "./runtime-sync";

test("a fixed read boundary accepts continuous publications in host order", () => {
  const sync = new RuntimeSync();
  const applied: string[] = [];
  const cursor = (publicationSeq: number) => ({
    hostId: "host",
    publicationSeq,
  });
  sync.begin();
  for (const seq of [4, 1, 5, 2, 3])
    sync.receive(cursor(seq), (phase) => applied.push(`${seq}:${phase}`));
  sync.finish(cursor(3), () => applied.push("state"));
  expect(applied).toEqual([
    "1:before-state",
    "2:before-state",
    "3:before-state",
    "state",
    "4:live",
    "5:live",
  ]);
  sync.receive(cursor(2), (phase) => applied.push(`late:${phase}`));
  expect(applied.at(-1)).toBe("late:covered");
});

test("a new host resets the boundary and rejects delayed old-host publications", () => {
  const sync = new RuntimeSync();
  sync.begin();
  sync.finish({ hostId: "old", publicationSeq: 100 }, () => {});
  expect(sync.receive({ hostId: "new", publicationSeq: 1 }, () => {})).toBe(
    false,
  );
  sync.begin();
  const applied: PublicationPhase[] = [];
  sync.receive({ hostId: "old", publicationSeq: 101 }, (p) => applied.push(p));
  sync.receive({ hostId: "new", publicationSeq: 1 }, (p) => applied.push(p));
  expect(sync.finish({ hostId: "new", publicationSeq: 0 }, () => {})).toEqual(
    [],
  );
  sync.receive({ hostId: "old", publicationSeq: 102 }, (p) => applied.push(p));
  expect(applied).toEqual(["live"]);
});

test("a superseding read retains buffered events; failure releases the buffer", () => {
  const sync = new RuntimeSync();
  sync.begin();
  sync.finish({ hostId: "host", publicationSeq: 0 }, () => {});
  sync.begin();
  let applied = 0;
  sync.receive({ hostId: "host", publicationSeq: 1 }, () => applied++);
  sync.begin();
  sync.cancel();
  sync.receive({ hostId: "host", publicationSeq: 2 }, () => applied++);
  expect(applied).toBe(2);
  sync.begin();
  sync.finish({ hostId: "host", publicationSeq: 2 }, () => {});
  expect(applied).toBe(2);
});

test("a follow-up read confirms an unknown foreign host was stale, without a retry loop", () => {
  const sync = new RuntimeSync();
  sync.begin();
  sync.finish({ hostId: "host", publicationSeq: 10 }, () => {});
  sync.begin();
  let applied = false;
  sync.receive({ hostId: "foreign", publicationSeq: 1 }, () => {
    applied = true;
  });
  const foreign = sync.finish({ hostId: "host", publicationSeq: 10 }, () => {});
  expect(foreign).toHaveLength(1);
  sync.begin();
  for (const event of foreign) sync.receive(event, event.apply);
  expect(sync.finish({ hostId: "host", publicationSeq: 11 }, () => {})).toEqual(
    [],
  );
  expect(applied).toBe(false);
});

test("a failed first read releases startup events instead of losing them", () => {
  const sync = new RuntimeSync();
  let applied = 0;
  sync.begin();
  sync.receive({ hostId: "host", publicationSeq: 1 }, () => applied++);
  sync.cancel();
  expect(applied).toBe(1);
});

test("the long-lived boundary retains only cursor metadata, not the state payload", () => {
  const sync = new RuntimeSync();
  const state = {
    hostId: "host",
    publicationSeq: 1,
    sessions: ["snapshot body"],
  };
  sync.begin();
  sync.finish(state, () => {});
  expect(Reflect.get(sync, "cursor")).toEqual({
    hostId: "host",
    publicationSeq: 1,
  });
});
