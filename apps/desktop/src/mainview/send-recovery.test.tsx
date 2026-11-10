import { expect, mock, spyOn, test } from "bun:test";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import type { Snapshot } from "../shared/rpc-schema";
import { emptyTranscript } from "../shared/transcript";
import type { SendState } from "./send-controller";
import { useStore } from "./store";

if (process.env.PIG_SEND_RECOVERY_CHILD !== "1") {
  test("send recovery UI and RPC guards in an isolated process", async () => {
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
  const forkRequest = mock(async () => {
    throw new Error("Unconfirmed sends must not reach forkSession");
  });
  const rewindRequest = mock(async () => {
    throw new Error("Unconfirmed sends must not reach rewindSession");
  });
  mock.module("electrobun/view", () => ({
    Electroview: class {
      constructor(readonly options: unknown) {}
      static defineRPC() {
        return {
          send: {},
          request: { forkSession: forkRequest, rewindSession: rewindRequest },
        };
      }
    },
  }));
  const { forkChat, regenerate, sends } = await import("./rpc");
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
  const initial = useStore.getInitialState();
  initial.snapshots = { recovery: snapshot };
  useStore.setState({ hostId: "h", snapshots: initial.snapshots });

  function render() {
    return renderToStaticMarkup(
      <ResponseFooter
        sessionId="recovery"
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

  test.each([
    "sending",
    "checking",
    "unknown",
  ] as const)("%s disables branching and regeneration, including direct RPC callers", async (state) => {
    sendState = {
      key: { ...snapshot.address, requestId: "pending" },
      version: 1,
      state,
    };
    expect(render().match(/disabled=""/g)).toHaveLength(2);
    await forkChat("recovery", "answer");
    await regenerate("recovery", user, "prompt");
    expect(forkRequest).not.toHaveBeenCalled();
    expect(rewindRequest).not.toHaveBeenCalled();
    expect(useStore.getState().opening).toBe(false);
  });

  test.each([
    "accepted",
    "rejected",
  ] as const)("%s does not require confirmation or wait for response completion", (state) => {
    sendState = {
      key: { ...snapshot.address, requestId: "settled" },
      version: 1,
      state,
    };
    expect(render()).not.toContain('disabled=""');
  });

  test("history-only previews never enable runtime actions", () => {
    sendState = undefined;
    snapshot.ready = false;
    expect(render().match(/disabled=""/g)).toHaveLength(2);
  });
}
