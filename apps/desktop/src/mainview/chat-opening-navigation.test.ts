import { afterAll, expect, mock, test } from "bun:test";
import { fileURLToPath } from "node:url";
import type { Snapshot } from "../shared/rpc-schema";
import type { OpenSessionParams, OpenState } from "../shared/runtime-contract";
import { emptyTranscript } from "../shared/transcript";

if (process.env.PIG_OPEN_NAVIGATION_CHILD !== "1") {
  test("non-blocking chat navigation with the real RPC controller", async () => {
    const child = Bun.spawn(
      [process.execPath, "test", fileURLToPath(import.meta.url)],
      {
        env: { ...process.env, PIG_OPEN_NAVIGATION_CHILD: "1" },
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
    params: OpenSessionParams;
    deferred: ReturnType<typeof Promise.withResolvers<Snapshot>>;
  }[] = [];
  const states = new Map<string, OpenState>();
  const cancelled: string[] = [];
  let failRecovery = false;
  mock.module("electrobun/view", () => ({
    Electroview: class {
      constructor(readonly options: unknown) {}
      static defineRPC() {
        return {
          send: { connectUI() {}, disconnectUI() {} },
          request: {
            runtimeState: async () => ({
              hostId: "navigation",
              sessions: [],
              pendingUI: [],
              drafts: [],
              statuses: [],
            }),
            heartbeatUI: async () => ({ connected: true }),
            getRecovery: () => {
              if (failRecovery)
                throw new Error("Recovery transport failed synchronously");
              return Promise.resolve({
                hostId: "navigation",
                sendIntents: [],
                retainedDrafts: [],
              });
            },
            listSessions: async () => [],
            openSession: (params: OpenSessionParams) => {
              const deferred = Promise.withResolvers<Snapshot>();
              calls.push({ params, deferred });
              return deferred.promise;
            },
            getOpenState: async ({ openId }: { openId: string }) =>
              states.get(openId) ?? { state: "unknown" },
            cancelOpen: async ({ openId }: { openId: string }) => {
              cancelled.push(openId);
            },
          },
        };
      }
    },
  }));
  Object.assign(globalThis, {
    history: {
      state: null as unknown,
      pushState(value: unknown) {
        this.state = value;
      },
      replaceState(value: unknown) {
        this.state = value;
      },
    },
    window: new EventTarget(),
    Element: class {},
  });
  const { openChat, cancelOpening, connectRuntime, initRuntimeConnection } =
    await import("./rpc");
  const { useStore } = await import("./store");
  const { navigate } = await import("./navigation");
  const { receiveRuntime, receiveSnapshot } = await import("./runtime-events");
  const { drafts } = await import("./draft-store");
  afterAll(initRuntimeConnection());
  await connectRuntime();
  let epoch = 0;
  function snapshot(id: string, cwd = "project"): Snapshot {
    return {
      address: { hostId: "navigation", sessionId: id, epoch: ++epoch },
      snapshotSeq: 2,
      info: { id, cwd, title: id, modified: 1 },
      effort: "off",
      effortLevels: [],
      transcript: emptyTranscript(),
    };
  }
  async function start(id: string | undefined, cwd = "project") {
    const index = calls.length;
    const promise = openChat(cwd, id);
    await Bun.sleep(1);
    expect(calls).toHaveLength(index + 1);
    const call = calls[index];
    const ready = snapshot(id ?? crypto.randomUUID(), cwd);
    receiveRuntime({
      type: "opening",
      openId: call.params.openId,
      address: ready.address,
      cwd,
    });
    receiveSnapshot({ ...ready, ready: false, snapshotSeq: 1 });
    return { ...call, promise, ready };
  }

  test("A → B → A reuses startup; a background completion cannot clear or replace the foreground", async () => {
    const aId = crypto.randomUUID(),
      bId = crypto.randomUUID();
    const a = await start(aId);
    const b = await start(bId);
    expect(useStore.getState().active).toBe(bId);
    const count = calls.length;
    const returning = openChat("project", aId);
    expect(useStore.getState().active).toBe(aId);
    expect(useStore.getState().openId).toBe(a.params.openId);
    expect(useStore.getState().openingAddress).toEqual(a.ready.address);
    expect(calls).toHaveLength(count);
    b.deferred.resolve(b.ready);
    await b.promise;
    expect(useStore.getState().openId).toBe(a.params.openId);
    expect(useStore.getState().opening).toBe(true);
    a.deferred.resolve(a.ready);
    expect(await returning).toMatchObject({ info: { id: aId } });
    await a.promise;
    expect(useStore.getState().active).toBe(aId);
    expect(useStore.getState().opening).toBe(false);
    expect(Object.keys(useStore.getState().pendingOpens)).toHaveLength(0);
  });

  test("ready chat and settings navigation never wait for another chat's startup", async () => {
    const ready = snapshot(crypto.randomUUID());
    receiveSnapshot(ready);
    const slow = await start(crypto.randomUUID());
    await openChat("project", ready.info.id);
    expect(useStore.getState().active).toBe(ready.info.id);
    expect(useStore.getState().opening).toBe(false);
    navigate("settings");
    slow.deferred.resolve(slow.ready);
    await slow.promise;
    expect(useStore.getState().page).toBe("settings");
    expect(useStore.getState().active).toBe(ready.info.id);
  });

  test("startup approval does not disable navigation shortcuts", async () => {
    const { initShortcuts } = await import("./shortcuts");
    const slow = await start(crypto.randomUUID());
    const settings = useStore.getState().settings;
    useStore.setState({
      settings: { ...settings, keybindings: { "settings.open": "ctrl+," } },
      pendingUI: [
        {
          ...slow.ready.address,
          uiId: "approval",
          kind: "confirm",
          title: "Startup",
          message: "Allow?",
        },
      ],
    });
    const cleanup = initShortcuts();
    try {
      const event = Object.assign(new Event("keydown", { cancelable: true }), {
        key: ",",
        keyCode: 188,
        ctrlKey: true,
        altKey: false,
        shiftKey: false,
        metaKey: false,
        isComposing: false,
        repeat: false,
      });
      window.dispatchEvent(event);
      expect(useStore.getState().page).toBe("settings");
      expect(useStore.getState().pendingUI).toHaveLength(1);
    } finally {
      cleanup();
      useStore.setState({ settings, pendingUI: [] });
      slow.deferred.resolve(slow.ready);
      await slow.promise;
    }
  });

  test("new-chat clicks deduplicate per project and transfer each background draft to its own session", async () => {
    useStore.setState({
      newChatDrafts: { one: "Draft one", two: "Draft two" },
    });
    const one = await start(undefined, "one");
    const count = calls.length;
    const repeated = openChat("one");
    expect(calls).toHaveLength(count);
    const two = await start(undefined, "two");
    const afterTwo = calls.length;
    const sidebarReturn = openChat("one", one.ready.info.id);
    expect(useStore.getState().openId).toBe(one.params.openId);
    expect(calls).toHaveLength(afterTwo);
    const returnTwo = openChat("two");
    drafts.receive(one.ready.address, {
      revision: 1,
      text: "Extension draft",
      pastes: [],
      images: [],
    });
    one.deferred.resolve(one.ready);
    await Promise.all([one.promise, repeated, sidebarReturn]);
    expect(useStore.getState().openId).toBe(two.params.openId);
    expect(useStore.getState().newChatDrafts.two).toBe("Draft two");
    expect(drafts.read(one.ready.address).content.text).toContain("Draft one");
    expect(drafts.read(one.ready.address).content.text).toContain(
      "Extension draft",
    );
    two.deferred.resolve(two.ready);
    await Promise.all([two.promise, returnTwo]);
    expect(drafts.read(two.ready.address).content.text).toBe("Draft two");
    expect(useStore.getState().active).toBe(two.ready.info.id);
    expect(useStore.getState().newChatDrafts).toEqual({});
  });

  test("cancelling B restores the still-starting A, and late B results never overwrite A", async () => {
    const a = await start(crypto.randomUUID());
    const b = await start(crypto.randomUUID());
    await cancelOpening();
    expect(cancelled.at(-1)).toBe(b.params.openId);
    expect(useStore.getState().openId).toBe(a.params.openId);
    b.deferred.resolve(b.ready);
    expect(await b.promise).toBeUndefined();
    expect(useStore.getState().openId).toBe(a.params.openId);
    a.deferred.resolve(a.ready);
    await a.promise;
    expect(useStore.getState().active).toBe(a.ready.info.id);
    expect(useStore.getState().opening).toBe(false);
  });

  test("background failure and background cancellation cannot steal another chat's controls", async () => {
    const a = await start(crypto.randomUUID());
    const b = await start(crypto.randomUUID());
    states.set(a.params.openId, {
      state: "failed",
      message: "Fixture startup failed",
    });
    a.deferred.reject(new Error("RPC failed"));
    await a.promise;
    expect(useStore.getState().openId).toBe(b.params.openId);
    const c = await start(crypto.randomUUID());
    await cancelOpening(b.params.openId);
    expect(useStore.getState().openId).toBe(c.params.openId);
    b.deferred.resolve(b.ready);
    await b.promise;
    expect(useStore.getState().openId).toBe(c.params.openId);
    c.deferred.resolve(c.ready);
    await c.promise;
    expect(useStore.getState().active).toBe(c.ready.info.id);
  });
  test("optional recovery transport failure cannot fail a successful open or erase its new draft", async () => {
    failRecovery = true;
    try {
      useStore.setState({
        newChatDrafts: { recoveryFailure: "Keep this draft" },
      });
      const chat = await start(undefined, "recoveryFailure");
      chat.deferred.resolve(chat.ready);
      expect(await chat.promise).toMatchObject({
        info: { id: chat.ready.info.id },
      });
      await Bun.sleep(0);
      expect(useStore.getState().active).toBe(chat.ready.info.id);
      expect(drafts.read(chat.ready.address).content.text).toBe(
        "Keep this draft",
      );
    } finally {
      failRecovery = false;
    }
  });
}
