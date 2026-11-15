import { expect, mock, spyOn, test } from "bun:test";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import type { Snapshot } from "../shared/rpc-schema";
import { emptyTranscript } from "../shared/transcript";
import type { SendState } from "./send-controller";
import { useStore } from "./store";

if (process.env.PIG_SEND_RECOVERY_CHILD !== "1") {
  test("send recovery RPC transitions in an isolated process", async () => {
    const child = Bun.spawn(
      [process.execPath, "test", fileURLToPath(import.meta.url)],
      {
        env: { ...process.env, PIG_SEND_RECOVERY_CHILD: "1" },
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
  const events: string[] = [];
  let stopping = Promise.withResolvers<void>();
  const abortRequest = mock(async () => {
    events.push("stop");
    await stopping.promise;
  });
  const forkRequest = mock(async () => {
    events.push("fork");
    return {
      ...snapshot,
      address: {
        ...snapshot.address,
        sessionId: `fork-${snapshot.info.id}`,
        epoch: snapshot.address.epoch + 1,
      },
      info: { ...snapshot.info, id: `fork-${snapshot.info.id}` },
    };
  });
  const rewindRequest = mock(async () => {
    events.push("rewind");
    return {
      ...snapshot,
      address: { ...snapshot.address, epoch: snapshot.address.epoch + 1 },
    };
  });
  mock.module("electrobun/view", () => ({
    Electroview: class {
      constructor(readonly options: unknown) {}
      static defineRPC() {
        return {
          send: {},
          request: {
            abort: abortRequest,
            forkSession: forkRequest,
            rewindSession: rewindRequest,
            listSessions: async () => [],
          },
        };
      }
    },
  }));
  mock.module("./navigation", () => ({
    navigate() {},
    navigationRevision: 0,
  }));
  const { forkChat, regenerate, sends } = await import("./rpc");
  const { selections } = await import("./selections");
  const { ResponseFooter } = await import("./ResponseFooter");
  const snapshot: Snapshot = {
    address: { hostId: "h", sessionId: "recovery", epoch: 1 },
    snapshotSeq: 1,
    info: { id: "recovery", cwd: "project", title: "Chat", modified: 1 },
    effort: "medium",
    effortLevels: ["medium"],
    transcript: { ...emptyTranscript(), running: true },
  };
  const user = { role: "user" as const, content: "hello", timestamp: 1 };
  let sendState: SendState | undefined;
  spyOn(sends, "read").mockImplementation(() => sendState);
  const wait = spyOn(sends, "wait").mockImplementation(async () => {
    throw new Error("Send status is unknown");
  });
  const retire = sends.retire.bind(sends);
  const retired = spyOn(sends, "retire").mockImplementation((address) => {
    events.push("retire");
    retire(address);
  });
  const sent = spyOn(sends, "send").mockImplementation(async () => {
    events.push("send");
  });
  spyOn(selections, "flush").mockImplementation(async () => {
    events.push("selection");
  });
  const initial = useStore.getInitialState();
  initial.snapshots = { recovery: snapshot };
  useStore.setState({ hostId: "h", snapshots: initial.snapshots });

  function render() {
    return renderToStaticMarkup(
      <ResponseFooter
        sessionId={snapshot.info.id}
        entryId="answer"
        userEntryId="prompt"
        user={user}
        canRegenerate
        stats={{
          stopReason: "stop",
          durationMs: 1000,
          endedAt: 2,
          timestamp: 1,
          tools: 0,
          totalTokens: 0,
          model: "fixture",
          text: "answer",
        }}
      />,
    );
  }

  let counter = 0;
  function setup(state: SendState["state"] = "unknown") {
    const id = `recovery-${++counter}`;
    snapshot.address = { hostId: "h", sessionId: id, epoch: 1 };
    snapshot.info = { ...snapshot.info, id };
    delete snapshot.ready;
    sendState = {
      key: { ...snapshot.address, requestId: "unconfirmed" },
      version: 1,
      state,
      content: { text: "keep unknown input", pastes: [], images: [] },
    };
    events.length = 0;
    stopping = Promise.withResolvers<void>();
    for (const mocked of [
      abortRequest,
      forkRequest,
      rewindRequest,
      wait,
      retired,
      sent,
    ])
      mocked.mockClear();
    initial.snapshots = { [id]: snapshot };
    useStore.setState({
      hostId: "h",
      addresses: { [id]: snapshot.address },
      snapshots: { [id]: snapshot },
      active: id,
      page: "chat",
      rewinds: {},
    });
  }
  for (const action of ["fork", "rewind"] as const) {
    const run = () =>
      action === "fork"
        ? forkChat(snapshot.info.id, "answer")
        : regenerate(snapshot.info.id, user, "prompt");
    test.each([
      "sending",
      "checking",
      "unknown",
    ] as const)(`${action} recovers a %s send after confirmed Stop, without waiting for its receipt`, async (state) => {
      setup(state);
      expect(render()).not.toContain('disabled=""');
      const changed = run();
      expect(events).toEqual(["stop"]);
      expect(forkRequest).not.toHaveBeenCalled();
      expect(rewindRequest).not.toHaveBeenCalled();
      expect(retired).not.toHaveBeenCalled();
      stopping.resolve();
      await changed;
      expect(events).toEqual([
        "stop",
        "selection",
        action,
        "retire",
        ...(action === "rewind" ? ["send"] : []),
      ]);
      expect(wait).not.toHaveBeenCalled();
      expect(sent).toHaveBeenCalledTimes(action === "rewind" ? 1 : 0);
      if (action === "rewind")
        expect(sent.mock.calls[0][1]?.text).toBe("hello");
      expect(useStore.getState().rewinds).toEqual({});
    });
    test(`${action} cannot change history when Stop is unconfirmed`, async () => {
      setup();
      const changed = run();
      stopping.reject(new Error("Stop unconfirmed"));
      await expect(changed).rejects.toThrow("Stop unconfirmed");
      expect(events).toEqual(["stop"]);
      expect(retired).not.toHaveBeenCalled();
      expect(sent).not.toHaveBeenCalled();
      expect(sendState?.content?.text).toBe("keep unknown input");
      expect(useStore.getState().rewinds).toEqual({});
    });
    test(`${action} failure does not discard or replay the unknown input`, async () => {
      setup();
      const request = action === "fork" ? forkRequest : rewindRequest;
      request.mockImplementationOnce(async () => {
        throw new Error("History change failed");
      });
      stopping.resolve();
      await expect(run()).rejects.toThrow("History change failed");
      expect(retired).not.toHaveBeenCalled();
      expect(sent).not.toHaveBeenCalled();
      expect(sendState?.content?.text).toBe("keep unknown input");
      expect(useStore.getState().rewinds).toEqual({});
    });
  }

  test.each([
    "accepted",
    "rejected",
  ] as const)("%s does not require confirmation or wait for response completion", (state) => {
    setup(state);
    expect(render()).not.toContain('disabled=""');
  });

  test("history-only previews never enable runtime actions", () => {
    sendState = undefined;
    snapshot.ready = false;
    expect(render().match(/disabled=""/g)).toHaveLength(2);
  });
}
