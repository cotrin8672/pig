import { expect, mock, spyOn, test } from "bun:test";
import { fileURLToPath } from "node:url";
import { ClientHub, type ClientSender } from "../bun/client-hub";
import type { ExtensionStatus, ExtensionUIEvent } from "../shared/extension-ui";
import type { RPCSchema, Snapshot } from "../shared/rpc-schema";
import type {
  RuntimeStateSnapshot,
  RuntimeViewState,
} from "../shared/runtime-contract";
import { emptyTranscript } from "../shared/transcript";

if (process.env.PIRIS_CONNECTION_CHILD !== "1") {
  test("runtime synchronization applies a fixed boundary in an isolated renderer", async () => {
    const child = Bun.spawn(
      [process.execPath, "test", fileURLToPath(import.meta.url)],
      {
        env: { ...process.env, PIRIS_CONNECTION_CHILD: "1" },
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    const [code, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    expect(code, stdout + stderr).toBe(0);
  });
} else {
  let heartbeat = () => {};
  spyOn(globalThis, "setInterval").mockImplementation(((
    handler: () => void,
  ) => {
    heartbeat = handler;
    return 1;
  }) as typeof setInterval);
  const reads: ReturnType<
    typeof Promise.withResolvers<RuntimeStateSnapshot>
  >[] = [];
  let messages: {
    [K in keyof RPCSchema["webview"]["messages"]]: (
      event: RPCSchema["webview"]["messages"][K],
    ) => void;
  };
  const listSessions = mock(async () => []);
  const getSessionSnapshot = mock(async () => {
    throw new Error("unexpected delta recovery");
  });
  let forkResponse = Promise.withResolvers<Snapshot>();
  const forkRequest = mock(() => forkResponse.promise);
  mock.module("electrobun/view", () => ({
    Electroview: class {
      constructor(readonly options: unknown) {}
      static defineRPC(config: { handlers: { messages: typeof messages } }) {
        messages = config.handlers.messages;
        return {
          send: { connectUI() {}, disconnectUI() {} },
          request: {
            runtimeState: () => {
              const read = Promise.withResolvers<RuntimeStateSnapshot>();
              reads.push(read);
              return read.promise;
            },
            heartbeatUI: async () => ({ connected: true }),
            listSessions,
            getSessionSnapshot,
            forkSession: forkRequest,
          },
        };
      }
    },
  }));
  const { connectRuntime, reconnectRuntime, forkChat } = await import("./rpc");
  const { useStore } = await import("./store");
  const { drafts, emptyContent } = await import("./draft-store");
  const { addressKey } = await import("./chat-snapshot");
  useStore.setState((s) => ({ settings: { ...s.settings, language: "en" } }));
  let hub = new ClientHub("host");
  const deliver: ClientSender = (name, payload) => {
    (messages[name] as (event: typeof payload) => void)(payload);
  };
  hub.add("window", deliver);
  const address = { hostId: "host", sessionId: "chat", epoch: 1 };
  function snapshot(seq: number, owner = address): Snapshot {
    return {
      address: owner,
      snapshotSeq: seq,
      info: { id: owner.sessionId, cwd: "fixture", title: "Chat", modified: 1 },
      transcript: { ...emptyTranscript(), history: { revision: "branch" } },
      effort: "off",
      effortLevels: [],
    };
  }
  function state(value = snapshot(10)): RuntimeViewState {
    return {
      hostId: value.address.hostId,
      sessions: [{ phase: "ready", address: value.address, snapshot: value }],
      pendingUI: [],
      drafts: [],
      statuses: [],
    };
  }
  const status = (text: string): ExtensionStatus => ({
    statuses: [{ key: "status", text }],
    widgets: [],
  });

  test("one read succeeds despite continuously active chats, including a newer event before the response continuation", async () => {
    const first = connectRuntime();
    expect(connectRuntime()).toBe(first);
    for (let i = 1; i < 10; i++)
      hub.runtime({ type: "snapshot", snapshot: snapshot(i) });
    const baseline = hub.runtimeState(() => state());
    reads[0].resolve(baseline);
    // Like Electrobun's executeJavascript batch: response resolves first, then
    // a newer event executes before the awaiting continuation gets a turn.
    for (let i = 11; i <= 60; i++)
      hub.runtime({ type: "snapshot", snapshot: snapshot(i) });
    await first;
    expect(reads).toHaveLength(1);
    expect(useStore.getState().snapshots.chat.snapshotSeq).toBe(60);
    await connectRuntime();
    expect(reads).toHaveLength(1);
    expect(getSessionSnapshot).not.toHaveBeenCalled();
  });

  test("post-boundary delta snapshots use the new full base without recovery", async () => {
    const saved: Snapshot = {
      ...snapshot(61),
      transcript: {
        ...snapshot(61).transcript,
        records: [
          {
            id: "saved",
            entryId: "saved",
            kind: "message",
            parentId: null,
            branchId: "branch",
            order: 0,
            message: { role: "user", content: "history", timestamp: 1 },
          },
        ],
      },
    };
    const pending = reconnectRuntime();
    const baseline = hub.runtimeState(() => state(saved));
    hub.runtime({ type: "snapshot", snapshot: { ...saved, snapshotSeq: 62 } });
    hub.runtime({ type: "snapshot", snapshot: { ...saved, snapshotSeq: 63 } });
    reads.at(-1)?.resolve(baseline);
    await pending;
    expect(useStore.getState().snapshots.chat.snapshotSeq).toBe(63);
    expect(
      useStore.getState().snapshots.chat.transcript.records[0],
    ).toMatchObject({
      message: { content: "history" },
    });
    const next: Snapshot = {
      ...saved,
      snapshotSeq: 64,
      transcript: {
        ...saved.transcript,
        records: [
          ...saved.transcript.records,
          {
            id: "next",
            entryId: "next",
            kind: "message",
            parentId: "saved",
            branchId: "branch",
            order: 1,
            message: { role: "user", content: "next turn", timestamp: 2 },
          },
        ],
      },
    };
    const again = reconnectRuntime();
    hub.runtime({ type: "snapshot", snapshot: next });
    hub.runtime({ type: "snapshot", snapshot: { ...next, snapshotSeq: 65 } });
    hub.extension({
      type: "notify",
      address,
      level: "warning",
      message: "at next turn",
    });
    reads
      .at(-1)
      ?.resolve(hub.runtimeState(() => state({ ...next, snapshotSeq: 66 })));
    await again;
    expect(
      useStore.getState().extensionNotices[addressKey(address)][0].after,
    ).toBe("next");
    expect(getSessionSnapshot).not.toHaveBeenCalled();
  });

  test("request endings, statuses and drafts newer than the read are not rolled back", async () => {
    const pending = reconnectRuntime();
    const request = {
      ...address,
      uiId: "question",
      kind: "input" as const,
      title: "Question",
    };
    const baseline = hub.runtimeState(() => ({
      ...state(snapshot(61)),
      pendingUI: [request],
      statuses: [{ address, status: status("old") }],
      drafts: [
        { address, draft: { ...emptyContent(), text: "old", revision: 1 } },
      ],
    }));
    hub.extension({ type: "requestEnd", address: request, reason: "done" });
    hub.extension({ type: "status", address, status: status("new") });
    hub.extension({
      type: "draft",
      address,
      draft: { ...emptyContent(), text: "new", revision: 2 },
    });
    reads.at(-1)?.resolve(baseline);
    await pending;
    expect(useStore.getState().pendingUI).toEqual([]);
    expect(useStore.getState().extensionStatuses[addressKey(address)]).toEqual(
      status("new"),
    );
    expect(drafts.read(address).content.text).toBe("new");
  });

  test("covered notifications and branch ownership transfers survive the authoritative read", async () => {
    const next = { ...address, sessionId: "fork", epoch: 2 };
    useStore.setState((s) => ({
      active: address.sessionId,
      panes: { ...s.panes, pane: { sessionId: address.sessionId } },
    }));
    drafts.edit(address, (content) => ({
      ...content,
      text: "unsaved branch text",
    }));
    const before = reads.length;
    const pending = reconnectRuntime();
    hub.runtime({
      type: "opening",
      previous: address,
      address: next,
      cwd: "fixture",
    });
    hub.runtime({
      type: "replaced",
      previous: address,
      snapshot: snapshot(1, next),
    });
    hub.extension({
      type: "notify",
      address: next,
      level: "warning",
      message: "keep this",
    });
    const baseline = hub.runtimeState(() => state(snapshot(2, next)));
    reads.at(-1)?.resolve(baseline);
    await pending;
    expect(useStore.getState().active).toBe("fork");
    expect(drafts.read(next).content.text).toBe("unsaved branch text");
    expect(useStore.getState().extensionNotices[addressKey(next)]).toHaveLength(
      1,
    );
    expect(useStore.getState().snapshots.chat).toBeUndefined();
    expect(reads).toHaveLength(before + 1);
  });

  test("a terminal opened before the boundary keeps its addressed owner through the read", async () => {
    const next = { ...address, sessionId: "fork", epoch: 2 };
    const request = {
      ...next,
      uiId: "terminal",
      kind: "terminal" as const,
      title: "Terminal",
    };
    const pending = reconnectRuntime();
    hub.extension({ type: "request", request });
    hub.terminal({ ...request, type: "open" });
    const baseline = hub.runtimeState(() => ({
      ...state(snapshot(3, next)),
      pendingUI: [request],
    }));
    reads.at(-1)?.resolve(baseline);
    await pending;
    expect(useStore.getState().pendingUI).toContainEqual(request);
    expect(Object.values(useStore.getState().terminals)).toHaveLength(1);
    hub.extension({ type: "requestEnd", address: request, reason: "done" });
    expect(useStore.getState().terminals).toEqual({});
  });

  test("a close after the state boundary cannot resurrect the closed chat", async () => {
    const next = { ...address, sessionId: "fork", epoch: 2 };
    const pending = reconnectRuntime();
    const baseline = hub.runtimeState(() => state(snapshot(3, next)));
    hub.runtime({
      type: "closed",
      address: next,
      reason: "close",
      discardDraft: true,
    });
    reads.at(-1)?.resolve(baseline);
    await pending;
    expect(useStore.getState().snapshots.fork).toBeUndefined();
    expect(drafts.read(next).content.text).toBe("");
  });

  test("real request failures retry on heartbeat without caching success", async () => {
    const pending = reconnectRuntime();
    reads.at(-1)?.reject(new Error("transport failed"));
    await expect(pending).rejects.toThrow("transport failed");
    const before = reads.length;
    heartbeat();
    await Bun.sleep(0);
    expect(reads).toHaveLength(before + 1);
    reads.at(-1)?.resolve(
      hub.runtimeState(() => ({
        hostId: "host",
        sessions: [],
        pendingUI: [],
        statuses: [],
        drafts: [],
      })),
    );
    await connectRuntime();
  });

  test("a restarted host uses its own sequence and ignores delayed publications from the old host", async () => {
    const oldHub = hub;
    const pending = reconnectRuntime();
    const oldBaseline = oldHub.runtimeState(() => ({
      hostId: "host",
      sessions: [],
      pendingUI: [],
      statuses: [],
      drafts: [],
    }));
    const before = reads.length;
    hub = new ClientHub("restarted");
    hub.add("window", deliver);
    const next = { hostId: "restarted", sessionId: "restarted-chat", epoch: 1 };
    hub.runtime({ type: "ready", snapshot: snapshot(1, next) });
    hub.extension({
      type: "notify",
      address: next,
      level: "info",
      message: "new host",
    });
    const baseline = hub.runtimeState(() => state(snapshot(2, next)));
    reads.at(-1)?.resolve(oldBaseline);
    await Bun.sleep(0);
    expect(reads).toHaveLength(before + 1);
    reads.at(-1)?.resolve(baseline);
    await pending;
    oldHub.runtime({ type: "snapshot", snapshot: snapshot(100) });
    expect(useStore.getState().hostId).toBe("restarted");
    expect(useStore.getState().snapshots.chat).toBeUndefined();
    expect(useStore.getState().extensionNotices[addressKey(next)]).toHaveLength(
      1,
    );
  });

  test("late covered requests cannot reappear but late notifications are still delivered", () => {
    const next = { hostId: "restarted", sessionId: "restarted-chat", epoch: 1 };
    const receive = (event: ExtensionUIEvent) =>
      messages.extensionUIEvent({
        hostId: "restarted",
        publicationSeq: 1,
        event,
      });
    receive({
      type: "request",
      request: { ...next, uiId: "old", kind: "input", title: "stale" },
    });
    receive({
      type: "notify",
      address: next,
      level: "warning",
      message: "late notice",
    });
    expect(useStore.getState().pendingUI).toEqual([]);
    expect(useStore.getState().extensionNotices[addressKey(next)]).toHaveLength(
      2,
    );
  });

  test("a fork RPC reply cannot install its new owner ahead of an in-flight older state", async () => {
    const previous = {
      hostId: "restarted",
      sessionId: "restarted-chat",
      epoch: 1,
    };
    const next = { ...previous, sessionId: "rpc-fork", epoch: 2 };
    drafts.edit(previous, (content) => ({ ...content, text: "local draft" }));
    const pending = reconnectRuntime();
    const baseline = hub.runtimeState(() => state(snapshot(3, previous)));
    forkResponse = Promise.withResolvers<Snapshot>();
    const branching = forkChat(previous.sessionId, "entry");
    await Bun.sleep(0);
    expect(forkRequest).toHaveBeenCalledTimes(1);
    hub.runtime({ type: "opening", address: next, cwd: "fixture" });
    hub.runtime({ type: "ready", snapshot: snapshot(1, next) });
    forkResponse.resolve(snapshot(2, next));
    await Bun.sleep(0);
    expect(useStore.getState().snapshots[next.sessionId]).toBeUndefined();
    reads.at(-1)?.resolve(baseline);
    await pending;
    const result = await branching;
    expect(result?.address).toEqual(next);
    expect(useStore.getState().snapshots[next.sessionId].address).toEqual(next);
    expect(useStore.getState().snapshots[previous.sessionId].address).toEqual(
      previous,
    );
    expect(drafts.read(previous).content.text).toBe("local draft");
    expect(drafts.read(next).content.text).toBe("");
  });
}
