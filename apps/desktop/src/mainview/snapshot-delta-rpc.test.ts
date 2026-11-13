import { expect, mock, test } from "bun:test";
import { fileURLToPath } from "node:url";
import { createRuntimeDeltaEncoder } from "../bun/snapshot-delta";
import { packSnapshot } from "../bun/transcript-wire";
import type { Snapshot } from "../shared/rpc-schema";
import type { RuntimeWireEvent } from "../shared/snapshot-delta";
import { emptyTranscript } from "../shared/transcript";

if (process.env.PIG_SNAPSHOT_DELTA_CHILD !== "1") {
  test("delta transport and full recovery with real RPC handlers in isolation", async () => {
    const child = Bun.spawn(
      [process.execPath, "test", fileURLToPath(import.meta.url)],
      {
        env: { ...process.env, PIG_SNAPSHOT_DELTA_CHILD: "1" },
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    const [code, out, error] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    expect(code, out + error).toBe(0);
  });
} else {
  let receive!: (event: RuntimeWireEvent) => void;
  const reads: ReturnType<typeof Promise.withResolvers<Snapshot>>[] = [];
  let sends = 0;
  mock.module("electrobun/view", () => ({
    Electroview: class {
      constructor(readonly options: unknown) {}
      static defineRPC(config: {
        handlers: { messages: { runtimeEvent: typeof receive } };
      }) {
        receive = config.handlers.messages.runtimeEvent;
        return {
          send: {},
          request: {
            listSessions: async () => [],
            prompt: () => {
              sends++;
            },
            openSession: () => {
              sends++;
            },
            getSessionSnapshot: () => {
              const read = Promise.withResolvers<Snapshot>();
              reads.push(read);
              return read.promise;
            },
          },
        };
      }
    },
  }));
  await import("./rpc");
  const { useStore } = await import("./store");
  test("a lost delta retains current history until full recovery and never resends/reopens", async () => {
    const encode = createRuntimeDeltaEncoder();
    const base: Snapshot = {
      address: { hostId: "delta-rpc", sessionId: "chat", epoch: 1 },
      snapshotSeq: 1,
      info: { id: "chat", cwd: "fixture", title: "Chat", modified: 1 },
      effort: "off",
      effortLevels: [],
      transcript: {
        ...emptyTranscript(),
        history: { revision: "branch" },
        running: true,
        records: [
          {
            id: "one",
            entryId: "one",
            parentId: null,
            branchId: "one",
            order: 0,
            kind: "message",
            message: {
              role: "user",
              content: "large".repeat(100000),
              timestamp: 0,
            },
          },
        ],
      },
    };
    receive(encode({ type: "ready", snapshot: base }));
    receive(
      encode({ type: "snapshot", snapshot: { ...base, snapshotSeq: 2 } }),
    );
    expect(useStore.getState().snapshots.chat.snapshotSeq).toBe(2);
    const next: Snapshot = {
      ...base,
      snapshotSeq: 3,
      transcript: {
        ...base.transcript,
        records: [
          ...base.transcript.records,
          {
            ...base.transcript.records[0],
            id: "two",
            entryId: "two",
            order: 1,
          },
        ],
      },
    };
    encode({ type: "snapshot", snapshot: next }); // Dropped by the simulated transport.
    receive(
      encode({ type: "snapshot", snapshot: { ...next, snapshotSeq: 4 } }),
    );
    await Bun.sleep(0);
    expect(reads).toHaveLength(1);
    expect(useStore.getState().snapshots.chat.snapshotSeq).toBe(2);
    reads[0].resolve(packSnapshot({ ...next, snapshotSeq: 5 }));
    await Bun.sleep(0);
    expect(useStore.getState().snapshots.chat.transcript.records).toHaveLength(
      2,
    );
    expect(useStore.getState().snapshots.chat.snapshotSeq).toBe(5);
    expect(sends).toBe(0);
    receive(
      encode({ type: "snapshot", snapshot: { ...next, snapshotSeq: 4 } }),
    );
    expect(useStore.getState().snapshots.chat.snapshotSeq).toBe(5);
    receive({ type: "closed", address: base.address, reason: "close" });
    receive(
      encode({ type: "snapshot", snapshot: { ...next, snapshotSeq: 6 } }),
    );
    await Bun.sleep(0);
    expect(reads).toHaveLength(1);
    expect(useStore.getState().snapshots.chat).toBeUndefined();
    const replacement = { ...base, address: { ...base.address, epoch: 2 } };
    receive(encode({ type: "ready", snapshot: replacement }));
    receive(
      encode({ type: "snapshot", snapshot: { ...next, snapshotSeq: 7 } }),
    );
    expect(useStore.getState().snapshots.chat.address.epoch).toBe(2);
    expect(useStore.getState().snapshots.chat.snapshotSeq).toBe(1);
    expect(reads).toHaveLength(1);
    const unknown = {
      ...base,
      address: { ...base.address, sessionId: "lost-ready" },
      info: { ...base.info, id: "lost-ready" },
    };
    encode({ type: "ready", snapshot: unknown }); // Lost before client registration.
    receive(
      encode({ type: "snapshot", snapshot: { ...unknown, snapshotSeq: 2 } }),
    );
    await Bun.sleep(0);
    expect(reads).toHaveLength(2);
    reads[1].resolve(packSnapshot({ ...unknown, snapshotSeq: 3 }));
    await Bun.sleep(0);
    expect(useStore.getState().snapshots["lost-ready"].snapshotSeq).toBe(3);
    expect(useStore.getState().snapshots.chat.address.epoch).toBe(2);
    expect(sends).toBe(0);
  });
}
