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
  const { DraftRecovery } = await import("./DraftRecovery");
  const customData = await import("./custom-data");
  const dataText = spyOn(customData, "dataText");
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
  spyOn(sends, "wait").mockImplementation(async () => {
    throw new Error("Send status is unknown");
  });
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
  ] as const)("%s leaves actions enabled but keeps destructive RPCs behind receipt reconciliation", async (state) => {
    sendState = {
      key: { ...snapshot.address, requestId: "pending" },
      version: 1,
      state,
    };
    expect(render()).not.toContain('disabled=""');
    await expect(forkChat("recovery", "answer")).rejects.toThrow("unknown");
    await expect(regenerate("recovery", user, "prompt")).rejects.toThrow(
      "unknown",
    );
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
  test.each([
    "en",
    "ja",
  ] as const)("closed recovery details do no payload work during repeated %s renders", (language) => {
    const settings = { ...useStore.getState().settings, language };
    useStore.getInitialState().settings = settings;
    useStore.setState({ settings });
    const state: SendState = {
      key: { ...snapshot.address, requestId: "unknown-original" },
      version: 1,
      state: "unknown",
      content: {
        text: "private payload",
        pastes: [],
        images: [
          {
            id: "image",
            image: {
              type: "image",
              mimeType: "image/png",
              data: "ATTACHMENT_SENTINEL",
            },
          },
        ],
      },
    };
    const retained = spyOn(sends, "retained").mockReturnValue([state]);
    dataText.mockClear();
    for (let i = 0; i < 10; i++) {
      const html = renderToStaticMarkup(<DraftRecovery />);
      expect(html).toContain(
        language === "ja" ? "送信の確認" : "Send recovery",
      );
      expect(html).not.toContain("private payload");
      expect(html).not.toContain("ATTACHMENT_SENTINEL");
      expect(html).not.toContain("<img");
    }
    expect(dataText).not.toHaveBeenCalled();
    retained.mockRestore();
  });
}
