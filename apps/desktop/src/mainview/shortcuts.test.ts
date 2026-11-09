import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import type { Snapshot } from "../shared/rpc-schema";
import { emptyTranscript } from "../shared/transcript";

// Keep the desktop bridge mock out of other UI suites' module caches.
if (process.env.PIG_SHORTCUT_TEST_CHILD !== "1") {
  test("shortcut handlers in an isolated process", async () => {
    const child = Bun.spawn(
      ["mise", "exec", "--", "rtk", "proxy", "bun", "test", import.meta.path],
      {
        env: { ...process.env, PIG_SHORTCUT_TEST_CHILD: "1" },
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    if (code !== 0) console.error(stdout + stderr);
    expect(code).toBe(0);
  }, 30_000);
} else {
  const reload = mock(async () => ({ state: "applied" as const }));
  const invoke = mock(async () => {});
  const appearance = mock(() => {});
  mock.module("./rpc", () => ({
    rpc: {
      request: { reloadAdapterConfig: reload, invokeSessionAction: invoke },
    },
    updateAppearance: appearance,
  }));
  const { initShortcuts } = await import("./shortcuts");
  const { useStore } = await import("./store");
  const original = useStore.getState();
  const events = new EventTarget();
  const back = mock(() => {});
  let modal: object | null = null;
  class Target {
    constructor(private selectors: string[] = []) {}
    closest(selector: string) {
      return selector
        .split(",")
        .some((part) => this.selectors.includes(part.trim()))
        ? this
        : null;
    }
  }
  Object.defineProperties(globalThis, {
    window: { value: events, configurable: true },
    Element: { value: Target, configurable: true },
    document: {
      value: { querySelector: () => modal, hasFocus: () => true },
      configurable: true,
    },
    history: { value: { back }, configurable: true },
  });
  let dispose: () => void;
  beforeEach(() => {
    reload.mockClear();
    invoke.mockClear();
    appearance.mockClear();
    back.mockClear();
    modal = null;
    useStore.setState(original, true);
    dispose = initShortcuts();
  });
  afterEach(() => {
    dispose();
    useStore.setState(original, true);
  });
  function fire(extra: Partial<KeyboardEvent> = {}, target = new Target()) {
    const event = new Event("keydown", { cancelable: true });
    Object.assign(event, {
      key: "r",
      ctrlKey: true,
      altKey: true,
      shiftKey: false,
      metaKey: false,
      isComposing: false,
      keyCode: 0,
      repeat: false,
      ...extra,
    });
    Object.defineProperty(event, "target", { value: target });
    events.dispatchEvent(event);
    return event;
  }
  function activate(keys = "Ctrl+Alt+R") {
    const snapshot: Snapshot = {
      address: { hostId: "host", sessionId: "chat", epoch: 3 },
      snapshotSeq: 1,
      info: { id: "chat", cwd: "/fixture", title: "Chat", modified: 1 },
      transcript: emptyTranscript(),
      effort: "off",
      effortLevels: ["off"],
      sessionUI: {
        generation: "generation",
        views: [],
        diagnostics: [],
        commands: [
          { adapterId: "custom", id: "run", title: "Run", busy: false },
        ],
        keymaps: [{ adapter: "custom", command: "run", keys, when: "chat" }],
      },
    };
    useStore.setState({ active: "chat", snapshots: { chat: snapshot } });
    return snapshot;
  }
  test.each([
    "chat",
    "providers",
    "extensions",
    "settings",
  ] as const)("Ctrl+Alt+R reloads from %s without an open chat, including an input target", (page) => {
    useStore.setState({ page, active: undefined, snapshots: {} });
    expect(fire({}, new Target(["input"])).defaultPrevented).toBe(true);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(invoke).not.toHaveBeenCalled();
  });
  test("IME, keyCode 229, repeat and consumed events never reload", () => {
    for (const extra of [
      { isComposing: true },
      { keyCode: 229 },
      { repeat: true },
    ])
      expect(fire(extra).defaultPrevented).toBe(false);
    const consumed = new Event("keydown", { cancelable: true });
    consumed.preventDefault();
    Object.assign(consumed, { key: "r", ctrlKey: true, altKey: true });
    events.dispatchEvent(consumed);
    expect(reload).not.toHaveBeenCalled();
  });
  test("native and role dialogs and pending native requests protect config reload", () => {
    expect(fire({}, new Target(["dialog"])).defaultPrevented).toBe(false);
    expect(fire({}, new Target(["[role=dialog]"])).defaultPrevented).toBe(
      false,
    );
    modal = {};
    expect(fire().defaultPrevented).toBe(false);
    modal = null;
    useStore.setState({
      pendingUI: [
        {
          hostId: "host",
          sessionId: "chat",
          epoch: 1,
          uiId: "confirm",
          kind: "confirm",
          title: "Confirm",
          message: "?",
        },
      ],
    });
    expect(fire().defaultPrevented).toBe(false);
    expect(reload).not.toHaveBeenCalled();
  });
  test("an explicit GUI override wins a conflict with adapter keys and global reload", () => {
    activate();
    useStore.setState({
      settings: {
        ...original.settings,
        keybindings: { "navigation.back": "Ctrl+Alt+R" },
      },
    });
    expect(fire().defaultPrevented).toBe(true);
    expect(back).toHaveBeenCalledTimes(1);
    expect(invoke).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
  });
  test("registered adapter keys beat the reload default and retain exact ownership", () => {
    const snapshot = activate();
    expect(fire().defaultPrevented).toBe(true);
    expect(invoke).toHaveBeenCalledWith({
      ...snapshot.address,
      generation: "generation",
      adapterId: "custom",
      commandId: "run",
    });
    expect(reload).not.toHaveBeenCalled();
  });
  test("adapter keys still beat an existing GUI default", () => {
    activate("Ctrl+Shift+B");
    fire({ key: "b", altKey: false, shiftKey: true });
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(appearance).not.toHaveBeenCalled();
  });
  test("explicit GUI keys beat conflicting defaults and null still disables", () => {
    useStore.setState({
      settings: {
        ...original.settings,
        keybindings: { "navigation.back": "Ctrl+Shift+B" },
      },
    });
    fire({ key: "b", altKey: false, shiftKey: true });
    expect(back).toHaveBeenCalledTimes(1);
    expect(appearance).not.toHaveBeenCalled();
    useStore.setState({
      settings: {
        ...original.settings,
        keybindings: { "appearance.toggleBackdrop": null },
      },
    });
    expect(
      fire({ key: "b", altKey: false, shiftKey: true }).defaultPrevented,
    ).toBe(false);
  });
  test("existing defaults and exact modifiers still work", () => {
    fire({ key: "b", altKey: false, shiftKey: true });
    expect(appearance).toHaveBeenCalledTimes(1);
    expect(fire({ altKey: false }).defaultPrevented).toBe(false);
    expect(reload).not.toHaveBeenCalled();
  });
  test("reload failures use the existing error channel; cleanup removes the handler", async () => {
    reload.mockRejectedValueOnce(new Error("Reload failed"));
    fire();
    await Promise.resolve();
    expect(useStore.getState().notices.at(-1)?.message).toContain(
      "Reload failed",
    );
    dispose();
    fire();
    expect(reload).toHaveBeenCalledTimes(1);
  });
}
