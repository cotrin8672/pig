import { expect, mock, spyOn, test } from "bun:test";
import { fileURLToPath } from "node:url";
import type { RuntimeViewState } from "../shared/runtime-contract";

if (process.env.PIRIS_CONNECTION_CHILD !== "1") {
  test("runtime synchronization retries in an isolated renderer", async () => {
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
  let collisions = 4,
    requests = 0;
  const state: RuntimeViewState = {
    hostId: "host",
    sessions: [],
    pendingUI: [],
    drafts: [],
    statuses: [],
  };
  const { receiveExtension } = await import("./runtime-events");
  const request = mock(async () => {
    requests++;
    if (collisions-- > 0)
      receiveExtension({
        type: "draft",
        address: { hostId: "host", sessionId: "racing", epoch: 1 },
        draft: {
          text: "newer event",
          images: [],
          pastes: [],
          revision: requests,
        },
      });
    return state;
  });
  mock.module("electrobun/view", () => ({
    Electroview: class {
      constructor(readonly options: unknown) {}
      static defineRPC() {
        return {
          send: { connectUI() {}, disconnectUI() {} },
          request: {
            runtimeState: request,
            heartbeatUI: async () => ({ connected: true }),
          },
        };
      }
    },
  }));
  const { connectRuntime, reconnectRuntime } = await import("./rpc");
  const { useStore } = await import("./store");
  useStore.setState((s) => ({ settings: { ...s.settings, language: "en" } }));

  test("three stale snapshots fail visibly; a healthy heartbeat retries until the snapshot applies", async () => {
    const first = connectRuntime();
    expect(connectRuntime()).toBe(first);
    await expect(first).rejects.toThrow("not synchronized");
    expect(requests).toBe(3);
    heartbeat();
    await Bun.sleep(0);
    await connectRuntime();
    expect(requests).toBe(5);
    expect(useStore.getState().addresses).toEqual({});
    expect(useStore.getState().pendingUI).toEqual([]);
    expect(useStore.getState().hostId).toBe("host");
    await connectRuntime();
    expect(requests).toBe(5);
  });

  test("continuous collisions never cache success and later quiet events permit a resync", async () => {
    collisions = 20;
    await expect(reconnectRuntime()).rejects.toThrow("not synchronized");
    const before = requests;
    heartbeat();
    await Bun.sleep(0);
    expect(requests - before).toBe(3);
    collisions = 0;
    heartbeat();
    await Bun.sleep(0);
    await connectRuntime();
    expect(requests - before).toBe(4);
  });
}
