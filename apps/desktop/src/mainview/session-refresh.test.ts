import { beforeEach, expect, mock, test } from "bun:test";
import { fileURLToPath } from "node:url";
import type { SessionInfo } from "../shared/rpc-schema";
import type { RuntimeEvent } from "../shared/runtime-contract";
import { emptyTranscript } from "../shared/transcript";

if (process.env.PIG_SESSION_REFRESH_CHILD !== "1") {
  test("project session refresh with the real RPC controller in isolation", async () => {
    const child = Bun.spawn(
      [process.execPath, "test", fileURLToPath(import.meta.url)],
      {
        env: { ...process.env, PIG_SESSION_REFRESH_CHILD: "1" },
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
  const calls: {
    cwd: string;
    result: ReturnType<typeof Promise.withResolvers<SessionInfo[]>>;
  }[] = [];
  let runtimeEvent: (event: RuntimeEvent) => void;
  mock.module("electrobun/view", () => ({
    Electroview: class {
      constructor(readonly options: unknown) {}
      static defineRPC(config: {
        handlers: { messages: { runtimeEvent: typeof runtimeEvent } };
      }) {
        runtimeEvent = config.handlers.messages.runtimeEvent;
        return {
          send: {},
          request: {
            listSessions: ({ cwd }: { cwd: string }) => {
              const result = Promise.withResolvers<SessionInfo[]>();
              calls.push({ cwd, result });
              return result.promise;
            },
          },
        };
      }
    },
  }));
  const { refreshSessions, initSessionReadTracking } = await import("./rpc");
  const { useStore } = await import("./store");
  const initial = useStore.getState();
  const info = (id: string, cwd = "one", title = id): SessionInfo => ({
    id,
    cwd,
    title,
    modified: 1,
  });
  const flush = () => Bun.sleep(0);
  beforeEach(() => {
    calls.length = 0;
    useStore.setState(
      {
        ...initial,
        bootstrap: {
          ...initial.bootstrap,
          projects: ["one", "two"],
          generalCwd: "general",
        },
        sessions: { one: [info("old")], two: [info("other", "two")] },
      },
      true,
    );
  });

  test("100 requests during a read share one flight and one final read, independently per cwd", async () => {
    const first = refreshSessions("one");
    await flush();
    const burst = Array.from({ length: 100 }, () => refreshSessions("one"));
    const other = refreshSessions("two");
    await flush();
    expect(calls.map((call) => call.cwd)).toEqual(["one", "two"]);
    calls[0].result.resolve([info("stale")]);
    calls[1].result.resolve([info("other", "two")]);
    await flush();
    expect(calls.map((call) => call.cwd)).toEqual(["one", "two", "one"]);
    expect(useStore.getState().sessions.one[0].id).toBe("old");
    calls[2].result.resolve([info("latest")]);
    await Promise.all([first, other, ...burst]);
    expect(useStore.getState().sessions.one[0].id).toBe("latest");
  });

  test("a read cannot roll back a local rename or resurrect a deleted session", async () => {
    const pending = refreshSessions("one");
    await flush();
    useStore.setState((s) => ({
      sessions: { ...s.sessions, one: [info("old", "one", "renamed")] },
    }));
    const rename = refreshSessions("one");
    calls[0].result.resolve([info("old")]);
    await flush();
    expect(useStore.getState().sessions.one[0].title).toBe("renamed");
    useStore.setState((s) => ({ sessions: { ...s.sessions, one: [] } }));
    const deleted = refreshSessions("one");
    calls[1].result.resolve([info("old", "one", "renamed")]);
    await flush();
    expect(useStore.getState().sessions.one).toEqual([]);
    calls[2].result.resolve([]);
    await Promise.all([pending, rename, deleted]);
    expect(useStore.getState().sessions.one).toEqual([]);
  });

  test("20 projects with 500 sessions need only two owning-project reads for 100 events", async () => {
    const projects = Array.from({ length: 20 }, (_, i) => `project-${i}`);
    useStore.setState((s) => ({
      bootstrap: { ...s.bootstrap, generalCwd: "", projects },
      sessions: Object.fromEntries(
        projects.map((cwd) => [
          cwd,
          Array.from({ length: 500 }, (_, i) => info(`${cwd}-${i}`, cwd)),
        ]),
      ),
    }));
    const pending = refreshSessions(projects[0]);
    await flush();
    const burst = Array.from({ length: 100 }, () =>
      refreshSessions(projects[0]),
    );
    calls[0].result.resolve([]);
    await flush();
    expect(calls.map((call) => call.cwd)).toEqual([projects[0], projects[0]]);
    calls[1].result.resolve([info("latest", projects[0])]);
    await Promise.all([pending, ...burst]);
    expect(useStore.getState().sessions[projects[0]][0].id).toBe("latest");
    expect(useStore.getState().sessions[projects[1]]).toHaveLength(500);
  });

  test("failed reads keep the previous list and allow a retry", async () => {
    const pending = refreshSessions("one");
    await flush();
    calls[0].result.reject(new Error("read failed"));
    await expect(pending).rejects.toThrow("read failed");
    expect(useStore.getState().sessions.one[0].id).toBe("old");
    const retry = refreshSessions("one");
    await flush();
    calls[1].result.resolve([info("retried")]);
    await retry;
    expect(useStore.getState().sessions.one[0].id).toBe("retried");
  });

  test("removed projects are pruned and in-flight results cannot restore them", async () => {
    const pending = refreshSessions("one");
    await flush();
    useStore.setState((s) => ({
      bootstrap: { ...s.bootstrap, projects: ["two"] },
    }));
    await refreshSessions("one");
    calls[0].result.resolve([info("removed")]);
    await pending;
    expect(useStore.getState().sessions.one).toBeUndefined();
    expect(calls).toHaveLength(1);
  });

  test("explicit full refresh still discovers external changes across all configured projects", async () => {
    const pending = refreshSessions();
    await flush();
    expect(calls.map((call) => call.cwd)).toEqual(["general", "one", "two"]);
    calls.forEach((call) => {
      call.result.resolve([info(`external-${call.cwd}`, call.cwd)]);
    });
    await pending;
    expect(
      Object.values(useStore.getState().sessions)
        .map((sessions) => sessions[0].id)
        .sort(),
    ).toEqual(["external-general", "external-one", "external-two"]);
  });

  test("runtime completion and close refresh only the owning project", async () => {
    const snapshot = {
      address: { hostId: "refresh", sessionId: "runtime", epoch: 1 },
      snapshotSeq: 1,
      info: info("runtime"),
      effort: "off" as const,
      effortLevels: [],
      transcript: emptyTranscript(),
    };
    runtimeEvent({ type: "ready", snapshot });
    await flush();
    expect(calls.map((call) => call.cwd)).toEqual(["one"]);
    for (let i = 0; i < 100; i++)
      runtimeEvent({
        type: "snapshot",
        snapshot: { ...snapshot, snapshotSeq: i + 2 },
      });
    calls[0].result.resolve([snapshot.info]);
    await flush();
    expect(calls.map((call) => call.cwd)).toEqual(["one", "one"]);
    calls[1].result.resolve([snapshot.info]);
    await flush();
    runtimeEvent({
      type: "closed",
      address: snapshot.address,
      reason: "close",
    });
    await flush();
    expect(calls.map((call) => call.cwd)).toEqual(["one", "one", "one"]);
    calls[2].result.resolve([snapshot.info]);
    await flush();
  });

  test("returning from an external CLI refreshes every project; hidden views do not scan", async () => {
    const browser = {
      window: globalThis.window,
      document: globalThis.document,
      requestAnimationFrame: globalThis.requestAnimationFrame,
      cancelAnimationFrame: globalThis.cancelAnimationFrame,
    };
    const window = new EventTarget();
    const document = Object.assign(new EventTarget(), {
      visibilityState: "visible",
      hasFocus: () => true,
    });
    Object.assign(globalThis, {
      window,
      document,
      requestAnimationFrame: () => 1,
      cancelAnimationFrame: () => {},
    });
    const dispose = initSessionReadTracking();
    try {
      window.dispatchEvent(new Event("focus"));
      await flush();
      expect(calls.map((call) => call.cwd)).toEqual(["general", "one", "two"]);
      calls.forEach((call) => {
        call.result.resolve([info(`external-${call.cwd}`, call.cwd)]);
      });
      await flush();
      expect(useStore.getState().sessions.two[0].id).toBe("external-two");
      document.visibilityState = "hidden";
      document.dispatchEvent(new Event("visibilitychange"));
      await flush();
      expect(calls).toHaveLength(3);
    } finally {
      dispose();
      Object.assign(globalThis, browser);
    }
  });
}
