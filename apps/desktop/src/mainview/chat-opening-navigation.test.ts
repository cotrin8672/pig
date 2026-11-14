import { afterAll, expect, mock, test } from "bun:test";
import { fileURLToPath } from "node:url";
import type { ModelInfo, Snapshot } from "../shared/rpc-schema";
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
  const {
    openChat,
    startOpeningChat,
    cancelOpening,
    connectRuntime,
    initRuntimeConnection,
  } = await import("./rpc");
  const { useStore } = await import("./store");
  const { navigate } = await import("./navigation");
  const { receiveRuntime, receiveSnapshot } = await import("./runtime-events");
  const { drafts } = await import("./draft-store");
  const { openingDraftKey } = await import("./opening-sends");
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
    let promise = openChat(cwd, id);
    if (!id) {
      const state = useStore.getState();
      const openId = state.openId;
      if (!openId) throw Error("Expected local new chat");
      const key = openingDraftKey(state.pendingOpens[openId]);
      if (state.newChatDrafts[cwd])
        useStore.setState({
          newChatDrafts: { [key]: state.newChatDrafts[cwd] },
        });
      const starting = startOpeningChat(openId);
      if (!starting) throw Error("Expected first-submit startup");
      promise = starting;
    }
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

  test("a new chat previews the first enabled model and its default effort before startup", async () => {
    const { bootstrap } = useStore.getState();
    const hidden = { provider: "test", id: "hidden", name: "Hidden" };
    const model: ModelInfo = {
      provider: "test",
      id: "default",
      name: "Default",
      effectiveDefaultEffort: "high",
      effortLevels: ["low", "high"],
    };
    useStore.setState({
      bootstrap: {
        ...bootstrap,
        models: [hidden, model],
        disabledModels: ["test/hidden"],
      },
    });
    const count = calls.length;
    await openChat("project");
    const selection = useStore.getState().openingTarget?.selection;
    await Bun.sleep(1);
    expect(calls).toHaveLength(count);
    await cancelOpening();
    useStore.setState({ bootstrap });
    expect(selection).toMatchObject({
      model,
      effort: "high",
      effortLevels: ["low", "high"],
    });
  });

  test("new chats preview the configured default rather than the first model", async () => {
    const { bootstrap } = useStore.getState();
    const first = { provider: "test", id: "first", name: "First" };
    const preferred: ModelInfo = {
      provider: "openai-codex",
      id: "preferred",
      name: "Preferred",
      effectiveDefaultEffort: "high",
      effortLevels: ["low", "high"],
    };
    useStore.setState({
      bootstrap: {
        ...bootstrap,
        models: [first, preferred],
        disabledModels: [],
        defaultModel: { provider: preferred.provider, id: preferred.id },
      },
    });
    try {
      const count = calls.length;
      await openChat("project");
      const selection = useStore.getState().openingTarget?.selection;
      expect(calls).toHaveLength(count);
      await cancelOpening();
      expect(selection).toMatchObject({
        model: preferred,
        effort: "high",
        effortLevels: ["low", "high"],
      });
    } finally {
      useStore.setState({ bootstrap });
    }
  });

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

  test("new-chat clicks reuse the current editor and transfer each background draft to its own session", async () => {
    const one = await start(undefined, "one");
    const oneKey = openingDraftKey(
      useStore.getState().pendingOpens[one.params.openId],
    );
    useStore.setState({ newChatDrafts: { [oneKey]: "Draft one" } });
    const count = calls.length;
    const repeated = openChat("one");
    expect(calls).toHaveLength(count);
    const two = await start(undefined, "two");
    const twoKey = openingDraftKey(
      useStore.getState().pendingOpens[two.params.openId],
    );
    useStore.setState((s) => ({
      newChatDrafts: { ...s.newChatDrafts, [twoKey]: "Draft two" },
    }));
    const afterTwo = calls.length;
    const sidebarReturn = openChat("one", one.ready.info.id);
    expect(useStore.getState().openId).toBe(one.params.openId);
    expect(calls).toHaveLength(afterTwo);
    const { showPendingOpen } = await import("./rpc");
    showPendingOpen(two.params.openId);
    drafts.receive(one.ready.address, {
      revision: 1,
      text: "Extension draft",
      pastes: [],
      images: [],
    });
    one.deferred.resolve(one.ready);
    await Promise.all([one.promise, repeated, sidebarReturn]);
    expect(useStore.getState().openId).toBe(two.params.openId);
    expect(useStore.getState().newChatDrafts[twoKey]).toBe("Draft two");
    expect(drafts.read(one.ready.address).content.text).toContain("Draft one");
    expect(drafts.read(one.ready.address).content.text).toContain(
      "Extension draft",
    );
    two.deferred.resolve(two.ready);
    await two.promise;
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
  test("pane creation, background opening, focus and closing preserve independent sessions", async () => {
    const { createPane, closePane, focusPane } = await import("./pane-state");
    const first = snapshot(crypto.randomUUID());
    receiveSnapshot(first);
    useStore.setState({
      initialized: true,
      page: "chat",
      active: first.info.id,
      activePane: 1,
      paneTree: { type: "pane", id: 1 },
      panes: { 1: { sessionId: first.info.id } },
    });
    const count = calls.length;
    createPane("rows");
    expect(calls).toHaveLength(count);
    const localId = useStore.getState().panes[2].openId;
    if (!localId) throw Error("Expected local pane editor");
    expect(useStore.getState().pendingOpens[localId].deferred).toBe(true);
    const starting = startOpeningChat(localId);
    await Bun.sleep(1);
    const call = calls.at(-1);
    if (!call) throw Error("Expected pane session open");
    const second = snapshot(crypto.randomUUID());
    receiveRuntime({
      type: "opening",
      openId: call.params.openId,
      address: second.address,
      cwd: second.info.cwd,
    });
    expect(useStore.getState().activePane).toBe(2);
    focusPane(1);
    const { showPendingOpen } = await import("./rpc");
    showPendingOpen(call.params.openId);
    expect(useStore.getState().activePane).toBe(2);
    expect(useStore.getState().panes[1].sessionId).toBe(first.info.id);
    focusPane(1);
    call.deferred.resolve(second);
    for (
      let i = 0;
      i < 100 && useStore.getState().pendingOpens[call.params.openId];
      i++
    )
      await Bun.sleep(1);
    expect(useStore.getState().active).toBe(first.info.id);
    expect(useStore.getState().panes[2].sessionId).toBe(second.info.id);
    await starting;
    focusPane(2);
    expect(useStore.getState().active).toBe(second.info.id);
    // Selecting a session already visible focuses its pane instead of duplicating it.
    await openChat(first.info.cwd, first.info.id);
    expect(useStore.getState().activePane).toBe(1);
    drafts.edit(second.address, (content) => ({
      ...content,
      text: "Keep this draft",
    }));
    closePane(2);
    expect(Object.keys(useStore.getState().panes)).toEqual(["1"]);
    expect(useStore.getState().snapshots[second.info.id]).toBeDefined();
    expect(drafts.read(second.address).content.text).toBe("Keep this draft");
    closePane(1);
    expect(useStore.getState().panes[1]).toBeDefined();
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
  test("splitting the initial welcome creates two local editors and closing one never opens the SDK", async () => {
    const { createPane, closePane } = await import("./pane-state");
    useStore.setState((state) => ({
      initialized: true,
      page: "chat",
      active: undefined,
      activePane: 1,
      paneTree: { type: "pane", id: 1 },
      panes: { 1: {} },
      pendingOpens: {},
      opening: false,
      openId: undefined,
      bootstrap: { ...state.bootstrap, generalCwd: "initial" },
    }));
    const count = calls.length;
    createPane("columns");
    const state = useStore.getState();
    expect(Object.keys(state.panes)).toHaveLength(2);
    for (const pane of Object.values(state.panes)) {
      expect(pane.sessionId).toBeUndefined();
      expect(state.pendingOpens[pane.openId ?? ""]).toMatchObject({
        cwd: "initial",
        deferred: true,
      });
    }
    const closedId = state.panes[state.activePane].openId ?? "";
    closePane();
    expect(useStore.getState().pendingOpens[closedId]).toBeUndefined();
    expect(calls).toHaveLength(count);
  });
}
