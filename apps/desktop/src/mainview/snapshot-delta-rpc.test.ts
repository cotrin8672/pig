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
  test("RPC deltas preserve completed tools across history appends and apply changed output", () => {
    const encode = createRuntimeDeltaEncoder();
    const content = [{ type: "text" as const, text: "saved output" }];
    const base: Snapshot = {
      address: { hostId: "delta-rpc", sessionId: "identity", epoch: 1 },
      snapshotSeq: 1,
      info: { id: "identity", cwd: "fixture", title: "Chat", modified: 1 },
      effort: "off",
      effortLevels: [],
      transcript: {
        ...emptyTranscript(),
        history: { revision: "branch" },
        records: [
          {
            id: "result",
            entryId: "result",
            parentId: null,
            branchId: "result",
            order: 0,
            kind: "message",
            message: {
              role: "toolResult",
              toolCallId: "tool",
              toolName: "read",
              content,
              isError: false,
              timestamp: 0,
            },
          },
        ],
        tools: { tool: { status: "done", result: { content } } },
      },
    };
    const deliver = (snapshot: Snapshot, type: "ready" | "snapshot") =>
      receive(JSON.parse(JSON.stringify(encode({ type, snapshot }))));
    deliver(base, "ready");
    const current = useStore.getState().snapshots.identity;
    const appended: Snapshot = {
      ...base,
      snapshotSeq: 2,
      transcript: {
        ...base.transcript,
        records: [
          { ...base.transcript.records[0], branchId: "next" },
          {
            id: "next",
            entryId: "next",
            parentId: "result",
            branchId: "next",
            order: 1,
            kind: "message",
            message: { role: "user", content: "Next", timestamp: 1 },
          },
        ],
      },
    };
    deliver(appended, "snapshot");
    const next = useStore.getState().snapshots.identity;
    expect(next.transcript.tools.tool).toBe(current.transcript.tools.tool);
    expect(next.transcript.records[0]).toMatchObject({ branchId: "next" });
    const old = current.transcript.records[0],
      record = next.transcript.records[0];
    if (old.kind !== "message" || record.kind !== "message")
      throw new Error("Missing message");
    expect(record.message).toBe(old.message);
    deliver(
      {
        ...appended,
        snapshotSeq: 3,
        transcript: {
          ...appended.transcript,
          tools: {
            tool: {
              status: "error",
              result: {
                content: [{ type: "text", text: "different extension output" }],
              },
            },
          },
        },
      },
      "snapshot",
    );
    const changed = useStore.getState().snapshots.identity.transcript;
    expect(changed.tools.tool).not.toBe(next.transcript.tools.tool);
    expect(changed.tools.tool).toMatchObject({
      status: "error",
      result: { content: [{ text: "different extension output" }] },
    });
    expect(changed.records[0]).toBe(next.transcript.records[0]);
    receive({ type: "closed", address: base.address, reason: "close" });
    expect(reads).toHaveLength(0);
    expect(sends).toBe(0);
  });

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
