import { afterAll, afterEach, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getSelectListTheme, Theme } from "@earendil-works/pi-coding-agent";
import {
  type Component,
  CURSOR_MARKER,
  getCapabilities,
  Input,
  type KeybindingsConfig,
  KeybindingsManager,
  type OverlayHandle,
  SelectList,
  Text,
  type TUI,
  TuiAltScreen,
} from "@earendil-works/pi-tui";
import {
  TERMINAL_LIMITS as LIMIT,
  type TerminalClientCommand,
  type TerminalHostEvent,
  type TerminalOpenEvent,
  type UIAddress,
} from "../shared/terminal-ui";
import {
  configureTerminalUI,
  TerminalKeybindings,
  TerminalUIHost,
  type TerminalUIHostOptions,
  VirtualTerminal,
} from "./terminal-ui";

// Run under the isolated runner; no auth/provider or real profile is consulted.
const profile = mkdtempSync(join(tmpdir(), "pig-terminal-"));
const keymapFile = join(profile, "keybindings.json");
writeFileSync(
  keymapFile,
  JSON.stringify({ "app.interrupt": "ctrl+g", "tui.select.down": "ctrl+n" }),
);
const loadKeymap = () =>
  JSON.parse(readFileSync(keymapFile, "utf8")) as KeybindingsConfig;
const keybindings = new TerminalKeybindings(loadKeymap(), loadKeymap);
const theme = new Theme(
  {
    accent: "#abcdef",
    muted: "#888888",
    text: "",
    thinkingXhigh: "#abcdef",
  } as ConstructorParameters<typeof Theme>[0],
  { selectedBg: "#333333" } as ConstructorParameters<typeof Theme>[1],
  "truecolor",
);
configureTerminalUI(theme, keybindings);
const hosts: TerminalUIHost[] = [];
afterEach(() => {
  for (const host of hosts.splice(0)) host.dispose();
});
afterAll(() => rmSync(profile, { recursive: true, force: true }));
function observe<T>(promise: Promise<T>) {
  void promise.catch(() => {});
  return promise;
}
async function turn() {
  await Promise.resolve();
  await Promise.resolve();
}
function blank(dispose?: () => void): Component & { dispose?: () => void } {
  return { render: () => ["component"], invalidate() {}, dispose };
}
function fixture(
  sessionId = "session",
  options: TerminalUIHostOptions = {},
  autoAck = true,
) {
  const events: TerminalHostEvent[] = [];
  const host = new TerminalUIHost(
    sessionId,
    7,
    (event) => {
      events.push(event);
      if (autoAck && event.type === "data")
        host.accept({ ...event, type: "ack" });
    },
    options,
  );
  hosts.push(host);
  const address = (index = 0): TerminalOpenEvent => {
    const event = events.filter(
      (e): e is TerminalOpenEvent => e.type === "open",
    )[index];
    if (!event) throw new Error("Missing open");
    return event;
  };
  const sequences = new Map<string, number>();
  return {
    host,
    events,
    address,
    ready: (a = address(), cols = 80, rows = 24) =>
      host.accept({ ...a, type: "ready", cols, rows }),
    input: (
      a: UIAddress,
      data: string,
      encoding: "text" | "binary" = "text",
    ) => {
      const inputSeq = (sequences.get(a.uiId) ?? 0) + 1;
      sequences.set(a.uiId, inputSeq);
      host.accept({ ...a, type: "input", inputSeq, encoding, data });
    },
    cancel: (a = address()) => host.accept({ ...a, type: "cancel" }),
    resize: (a: UIAddress, cols: number, rows: number) =>
      host.accept({ ...a, type: "resize", cols, rows }),
    output: (a = address()) =>
      events
        .flatMap((e) =>
          e.type === "data" && e.uiId === a.uiId ? [e.data] : [],
        )
        .join(""),
    closes: (a = address()) =>
      events.filter((e) => e.type === "close" && e.uiId === a.uiId).length,
  };
}

// The original 16 donor scenarios are retained, with addressed/seq/ack APIs and real public keymaps.
test("open is immediate; factory/raw output wait for fitted ready, which is idempotent", async () => {
  const f = fixture("first-session");
  const started: string[] = [];
  let ui!: TUI;
  let done!: (value: string) => void;
  const one = observe(
    f.host.custom<string>((tui, passedTheme, kb, finish) => {
      expect(tui).toBeInstanceOf(TuiAltScreen);
      expect(passedTheme).toBe(theme);
      expect(kb as object).toBe(keybindings);
      ui = tui;
      done = finish;
      started.push("one");
      return new Text("first-render", 0, 0);
    }),
  );
  const two = observe(
    f.host.custom(() => {
      started.push("two");
      return blank();
    }),
  );
  const a = f.address();
  expect(a).toMatchObject({
    type: "open",
    sessionId: "first-session",
    epoch: 7,
  });
  expect(a.uiId).toMatch(/^[0-9a-f-]{36}$/);
  expect(f.address(1).uiId).not.toBe(a.uiId);
  f.resize(a, 100, 30);
  await turn();
  expect(started).toEqual([]);
  expect(f.output()).toBe("");
  f.ready(a, 90, 30);
  f.ready(a, 10, 10);
  await turn();
  ui.renderNow();
  expect(started).toEqual(["one"]);
  expect(ui.terminal.columns).toBe(90);
  expect(f.output()).toContain("\x1b[?1049h");
  expect(f.output()).toContain("first-render");
  done("one");
  expect(await one).toBe("one");
  f.cancel(f.address(1));
  await expect(two).rejects.toMatchObject({ name: "AbortError" });
  expect(f.closes()).toBe(1);
});

test("real Input: fragmented keys/paste, Escape, resize before redraw, stale scheduling after close", async () => {
  const f = fixture();
  const input = new Input();
  const frames: string[] = [];
  let ui!: TUI;
  let escaped = 0;
  input.onEscape = () => {
    escaped++;
  };
  const pending = observe(
    f.host.custom<string>((tui, _theme, _kb, done) => {
      ui = tui;
      input.onSubmit = done;
      tui.addInputListener((data) => {
        frames.push(data);
        return undefined;
      });
      return input;
    }),
  );
  const a = f.address();
  f.ready();
  f.input(a, "ab");
  await turn();
  expect(input.focused).toBe(true);
  f.input(a, "\x1b[");
  f.input(a, "D");
  f.input(a, "\x1b[200~xy");
  f.input(a, "z\x1b[201~");
  expect(input.getValue()).toBe("axyzb");
  expect(frames).toEqual(["a", "b", "\x1b[D", "\x1b[200~xyz\x1b[201~"]);
  f.input(a, "\x1b");
  await Bun.sleep(40);
  expect(escaped).toBe(1);
  expect(f.closes()).toBe(0);
  f.resize(a, 110, 35);
  expect([ui.terminal.columns, ui.terminal.rows]).toEqual([110, 35]);
  await Bun.sleep(40);
  expect(f.output()).not.toContain(CURSOR_MARKER);
  f.input(a, "\r");
  expect(await pending).toBe("axyzb");
  expect(input.focused).toBe(false);
  const count = f.events.length;
  ui.requestRender(true);
  ui.renderNow();
  ui.start();
  ui.terminal.write("stale");
  await Bun.sleep(40);
  expect(f.events.length).toBe(count);
});

test("real overlay composition: options callback once; dynamic percent/visibility, handle focus and selection", async () => {
  for (const dynamic of [false, true]) {
    const f = fixture();
    const base = new Input();
    base.setValue("BACKGROUND");
    base.handleInput("\x05");
    let ui!: TUI;
    let handle!: OverlayHandle;
    let calls = 0;
    const opts = {
      width: "50%" as const,
      row: 2,
      col: 3,
      visible: (width: number) => width >= 60,
    };
    const pending = observe(
      f.host.custom<string>(
        (tui, _t, _k, done) => {
          ui = tui;
          tui.addChild(base);
          tui.setFocus(base);
          const list = new SelectList(
            [
              { value: "first", label: "First-choice" },
              { value: "second", label: "Second-choice" },
            ],
            4,
            getSelectListTheme(),
          );
          list.onSelect = (item) => done(item.value);
          return list;
        },
        {
          overlay: true,
          overlayOptions: dynamic
            ? () => {
                calls++;
                return opts;
              }
            : opts,
          onHandle: (h) => {
            handle = h;
          },
        },
      ),
    );
    const a = f.address();
    f.ready(a, 100, 30);
    await turn();
    ui.renderNow();
    expect(calls).toBe(dynamic ? 1 : 0);
    expect(f.output()).toContain("BACKGROUND");
    expect(f.output()).toContain("First-choice");
    expect(handle.getBounds()).toMatchObject({ row: 2, col: 3, width: 50 });
    expect(handle.isFocused()).toBe(true);
    handle.setHidden(true);
    expect(base.focused).toBe(true);
    handle.setHidden(false);
    handle.unfocus();
    expect(base.focused).toBe(true);
    handle.focus();
    f.resize(a, 40, 12);
    ui.renderNow();
    expect(handle.getBounds()).toBeUndefined();
    f.resize(a, 120, 32);
    ui.renderNow();
    expect(handle.getBounds()?.width).toBe(60);
    expect(calls).toBe(dynamic ? 1 : 0);
    f.input(a, "\x0e\r"); // Real user keymap: ctrl+n selects down.
    expect(await pending).toBe("second");
    expect(handle.getBounds()).toBeUndefined();
  }
});

test("components create actual overlays; hide is not implicit settlement", async () => {
  const f = fixture();
  let ui!: TUI;
  let popup!: OverlayHandle;
  let disposed = 0;
  const pending = observe(
    f.host.custom<string>((tui, _t, _k, done) => {
      ui = tui;
      return {
        ...blank(() => {
          disposed++;
        }),
        handleInput(data) {
          if (data !== "o") return;
          const list = new SelectList(
            [{ value: "selected", label: "Popup-choice" }],
            4,
            getSelectListTheme(),
          );
          list.onSelect = (item) => done(item.value);
          popup = tui.showOverlay(list, { width: 30, row: 3, col: 4 });
        },
      };
    }),
  );
  const a = f.address();
  f.ready();
  await turn();
  f.input(a, "o");
  ui.renderNow();
  expect(f.output()).toContain("Popup-choice");
  expect(popup.isFocused()).toBe(true);
  popup.hide();
  expect(ui.hasOverlay()).toBe(false);
  expect(f.closes()).toBe(0);
  f.input(a, "o\r");
  expect(await pending).toBe("selected");
  expect(disposed).toBe(1);
});

test("arbitrary done values stay Bun-local; double settlement disposes/closes once", async () => {
  const f = fixture();
  const result = { map: new Map([["x", 7n]]), fn: () => "local" };
  let done!: (value: typeof result) => void;
  let disposed = 0;
  const pending = observe(
    f.host.custom<typeof result>((_u, _t, _k, finish) => {
      done = finish;
      return blank(() => {
        disposed++;
      });
    }),
  );
  f.ready();
  await turn();
  done(result);
  done(result);
  f.cancel();
  f.host.cancelAll();
  expect(await pending).toBe(result);
  expect(disposed).toBe(1);
  expect(f.closes()).toBe(1);
  expect(f.events.every((e) => !("map" in e) && !("fn" in e))).toBe(true);
});

test("synchronous done still disposes returned component exactly once, never renders", async () => {
  const f = fixture();
  let disposed = 0;
  let rendered = 0;
  const pending = observe(
    f.host.custom<number>(
      (_u, _t, _k, done) => {
        done(42);
        done(43);
        return {
          render: () => {
            rendered++;
            return [];
          },
          invalidate() {},
          dispose() {
            disposed++;
          },
        };
      },
      { overlay: true },
    ),
  );
  f.ready();
  expect(await pending).toBe(42);
  await turn();
  expect(disposed).toBe(1);
  expect(rendered).toBe(0);
  expect(f.closes()).toBe(1);
});

test("late async factory after cancellation is disposed once and never mounted/written", async () => {
  const f = fixture();
  let release!: (value: Component) => void;
  let ui!: TUI;
  let lateDone!: (value: number) => void;
  let disposed = 0;
  const pending = observe(
    f.host.custom<number>(async (tui, _t, _k, done) => {
      ui = tui;
      lateDone = done;
      return await new Promise<Component>((resolve) => {
        release = resolve;
      });
    }),
  );
  f.ready();
  f.input(f.address(), "queued");
  f.cancel();
  await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  const count = f.events.length;
  release(
    blank(() => {
      disposed++;
    }),
  );
  await turn();
  lateDone(1);
  ui.requestRender();
  ui.renderNow();
  expect(disposed).toBe(1);
  expect(f.events.length).toBe(count);
  expect(f.closes()).toBe(1);
});

test("factory/async/render/input/escape/options/onHandle errors reject and clean up", async () => {
  for (const stage of [
    "factory",
    "async",
    "render",
    "input",
    "escape",
    "options",
    "handle",
  ]) {
    const f = fixture();
    const error = new Error(stage);
    let disposed = 0;
    let ui!: TUI;
    const exits = process.listenerCount("exit");
    const pending = observe(
      f.host.custom(
        (tui) => {
          ui = tui;
          if (stage === "factory") throw error;
          if (stage === "async") return Promise.reject(error);
          return {
            render: () => {
              if (stage === "render") throw error;
              return ["ok"];
            },
            invalidate() {},
            handleInput: () => {
              if (stage === "input" || stage === "escape") throw error;
            },
            dispose: () => {
              disposed++;
            },
          };
        },
        {
          overlay: stage === "options" || stage === "handle",
          overlayOptions: () => {
            if (stage === "options") throw error;
            return { width: 20 };
          },
          onHandle: () => {
            if (stage === "handle") throw error;
          },
        },
      ),
    );
    f.ready();
    await turn();
    if (stage === "input") f.input(f.address(), "x");
    if (stage === "escape") f.input(f.address(), "\x1b");
    await expect(pending).rejects.toBe(error);
    expect(f.closes()).toBe(1);
    expect(disposed).toBe(stage === "factory" || stage === "async" ? 0 : 1);
    expect(process.listenerCount("exit")).toBe(exits);
    const count = f.events.length;
    ui.requestRender(true);
    ui.renderNow();
    expect(f.events.length).toBe(count);
  }
});

test("nested requests expose all open events and can start a child while its parent awaits it", async () => {
  let parent: string | undefined;
  const f = fixture("session", { describe: () => ({ parentUiId: parent }) });
  let child!: Promise<string>;
  let finish!: (value: string) => void;
  const outer = observe(
    f.host.custom<string>(async () => {
      child = observe(
        f.host.custom<string>((_u, _t, _k, done) => {
          finish = done;
          return blank();
        }),
      );
      await child;
      return blank();
    }),
  );
  parent = f.address().uiId;
  f.host.accept({
    ...f.address(),
    epoch: 6,
    type: "ready",
    cols: 80,
    rows: 24,
  });
  f.host.accept({
    ...f.address(),
    sessionId: "foreign",
    type: "ready",
    cols: 80,
    rows: 24,
  });
  f.host.accept({
    ...f.address(),
    type: "input",
    inputSeq: 1,
    encoding: "text",
    data: "pre-ready",
  });
  expect(f.events.length).toBe(1);
  f.ready();
  expect(f.address(1).parentUiId).toBe(parent);
  f.ready(f.address(1));
  await turn();
  finish("child");
  expect(await child).toBe("child");
  await turn();
  f.cancel();
  await expect(outer).rejects.toMatchObject({ name: "AbortError" });
});

test("invalid dimensions/types ignored; valid boundaries resize; oversized bytes fail UI", async () => {
  const f = fixture();
  let ui!: TUI;
  const input = new Input();
  const pending = observe(
    f.host.custom((tui) => {
      ui = tui;
      return input;
    }),
  );
  const a = f.address();
  const invalid = [
    [0, 24],
    [1, 24],
    [501, 24],
    [80, 1],
    [80, 201],
    [80.5, 24],
    [80, Number.NaN],
  ];
  for (const [cols, rows] of invalid) f.ready(a, cols, rows);
  expect(f.output()).toBe("");
  f.ready(a, 2, 2);
  await turn();
  f.resize(a, 500, 200);
  for (const [cols, rows] of invalid) f.resize(a, cols, rows);
  expect([ui.terminal.columns, ui.terminal.rows]).toEqual([500, 200]);
  f.host.accept({
    ...a,
    type: "input",
    inputSeq: 1,
    encoding: "text",
    data: 42,
  } as unknown as TerminalClientCommand);
  expect(input.getValue()).toBe("");
  f.input(a, "界".repeat(22_000));
  await expect(pending).rejects.toBeInstanceOf(RangeError);
  expect(f.events.at(-1)).toMatchObject({ type: "close", reason: "failed" });
});

test("unfinished paste and async-factory input queues are bounded", async () => {
  for (const asyncFactory of [false, true]) {
    const f = fixture();
    let release!: (value: Component) => void;
    const pending = observe(
      f.host.custom(() =>
        asyncFactory
          ? new Promise<Component>((resolve) => {
              release = resolve;
            })
          : new Input(),
      ),
    );
    f.ready();
    await turn();
    if (!asyncFactory) f.input(f.address(), "\x1b[200~");
    for (let i = 0; i < 17; i++)
      f.input(f.address(), "x".repeat(LIMIT.inputBytes));
    await expect(pending).rejects.toBeInstanceOf(RangeError);
    expect(f.closes()).toBe(1);
    if (asyncFactory) release(blank());
    await turn();
  }
});

test("cancelAll cancels waiting/active; reusable; dispose permanently rejects", async () => {
  const f = fixture();
  let disposed = 0;
  const waiting = observe(f.host.custom(() => blank()));
  const active = observe(
    f.host.custom(() =>
      blank(() => {
        disposed++;
      }),
    ),
  );
  f.ready(f.address(1));
  await turn();
  f.host.cancelAll("reload");
  for (const p of [waiting, active])
    await expect(p).rejects.toMatchObject({
      name: "AbortError",
      message: "reload",
    });
  expect(disposed).toBe(1);
  const reused = observe(
    f.host.custom<boolean>((_u, _t, _k, done) => {
      done(true);
      return blank();
    }),
  );
  f.ready(f.address(2));
  expect(await reused).toBe(true);
  const last = observe(f.host.custom(() => blank()));
  f.host.dispose();
  f.host.dispose();
  await expect(last).rejects.toMatchObject({ name: "AbortError" });
  await expect(f.host.custom(() => blank())).rejects.toMatchObject({
    name: "AbortError",
  });
});

test("truthful capabilities/public user keymap/reload, terminal operations and tui.stop", async () => {
  const f = fixture();
  let ui!: TUI;
  const stdin = process.stdin.listenerCount("data");
  const resize = process.stdout.listenerCount("resize");
  const pending = observe(
    f.host.custom((tui, _t, kb) => {
      ui = tui;
      expect(kb).toBeInstanceOf(KeybindingsManager);
      expect(kb.matches("\x07", "app.interrupt")).toBe(true);
      expect(kb.matches("\x1b", "app.interrupt")).toBe(false);
      expect(kb.getKeys("app.model.select").length).toBeGreaterThan(0);
      kb.reload();
      expect(kb.getEffectiveConfig()["app.interrupt"]).toBe("ctrl+g");
      expect(getCapabilities()).toMatchObject({
        images: null,
        trueColor: true,
        hyperlinks: true,
      });
      expect(tui.terminal.kittyProtocolActive).toBe(false);
      return blank();
    }),
  );
  f.ready();
  await turn();
  expect(await ui.queryTerminalColors({ timeoutMs: 10000 })).toEqual({});
  const t = ui.terminal;
  t.moveBy(-2);
  t.moveBy(3);
  t.hideCursor();
  t.showCursor();
  t.clearLine();
  t.clearFromCursor();
  t.clearScreen();
  t.setTitle("Safe\x07title");
  t.setProgress(true);
  t.setProgress(false);
  t.setProgramStatus({ state: "working" });
  await t.drainInput();
  expect(f.output()).toContain(
    "\x1b[2A\x1b[3B\x1b[?25l\x1b[?25h\x1b[2K\x1b[0J\x1b[2J\x1b[H",
  );
  expect(f.output()).toContain("\x1b]0;Safetitle\x07");
  expect(process.stdin.listenerCount("data")).toBe(stdin);
  expect(process.stdout.listenerCount("resize")).toBe(resize);
  ui.stop();
  await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  expect(() => configureTerminalUI(theme, new TerminalKeybindings())).toThrow(
    "process-wide",
  );
});

test("synchronous ready during open emission supports startup custom", async () => {
  const events: TerminalHostEvent[] = [];
  const host = new TerminalUIHost("startup", 1, (e) => {
    events.push(e);
    if (e.type === "open")
      host.accept({ ...e, type: "ready", cols: 72, rows: 20 });
  });
  hosts.push(host);
  expect(
    await host.custom<string>((tui, _t, _k, done) => {
      expect(tui.terminal.columns).toBe(72);
      done("startup");
      return blank();
    }),
  ).toBe("startup");
  expect(events[0]?.type).toBe("open");
  expect(events.at(-1)).toMatchObject({ type: "close", reason: "done" });
});

test("transport/disposer errors do not strand calls or replace cancellation AbortError", async () => {
  for (const failure of ["open", "data", "close"] as const) {
    const error = new Error(failure);
    let address!: UIAddress;
    let closes = 0;
    let ui!: TUI;
    const host = new TerminalUIHost("transport", 1, (event) => {
      if (event.type === "open") address = event;
      if (event.type === "close") closes++;
      if (event.type === failure) throw error;
    });
    hosts.push(host);
    const pending = observe(
      host.custom((tui) => {
        ui = tui;
        return blank(() => {
          throw new Error("dispose");
        });
      }),
    );
    host.accept({ ...address, type: "ready", cols: 80, rows: 24 });
    await turn();
    if (failure === "close") {
      ui.terminal.stop();
      await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    } else await expect(pending).rejects.toBe(error);
    host.cancelAll();
    expect(closes).toBe(1);
  }
});

test("cancelAll blocks reentrant custom from disposer then permits reuse", async () => {
  const f = fixture();
  let reentrant!: Promise<unknown>;
  const pending = observe(
    f.host.custom(() =>
      blank(() => {
        reentrant = observe(f.host.custom(() => blank()));
        f.host.cancelAll();
        throw new Error("dispose");
      }),
    ),
  );
  f.ready();
  await turn();
  f.host.cancelAll("reload");
  await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  await expect(reentrant).rejects.toMatchObject({ name: "AbortError" });
  expect(f.host.pendingCount).toBe(0);
  const reused = observe(
    f.host.custom<number>((_u, _t, _k, done) => {
      done(7);
      return blank();
    }),
  );
  f.ready(f.address(1));
  expect(await reused).toBe(7);
});

test("address checks and input sequence idempotency; missing input explicitly fails", async () => {
  const f = fixture();
  const input = new Input();
  const pending = observe(f.host.custom(() => input));
  const a = f.address();
  f.ready();
  await turn();
  const packet: TerminalClientCommand = {
    ...a,
    type: "input",
    inputSeq: 1,
    encoding: "text",
    data: "ok",
  };
  f.host.accept({ ...packet, epoch: 6 });
  f.host.accept({ ...packet, sessionId: "other" });
  f.host.accept({ ...packet, uiId: "foreign" });
  expect(input.getValue()).toBe("");
  f.host.accept(packet);
  f.host.accept(packet);
  expect(input.getValue()).toBe("ok");
  f.host.accept({ ...packet, inputSeq: 3 });
  await expect(pending).rejects.toThrow("sequence gap");
});

test("output seq/ack are ordered, stale or future ack cannot release output budget", async () => {
  for (const ack of ["good", "future", "foreign", "stale"] as const) {
    const f = fixture("ack", {}, false);
    let ui!: TUI;
    const pending = observe(
      f.host.custom((tui) => {
        ui = tui;
        return blank();
      }),
    );
    f.ready();
    await turn();
    const a = f.address();
    const last = () => f.events.filter((e) => e.type === "data").length;
    for (let i = 0; i < 6; i++) {
      if (ack === "good") f.host.accept({ ...a, type: "ack", seq: last() });
      if (ack === "future") f.host.accept({ ...a, type: "ack", seq: 999_999 });
      if (ack === "foreign")
        f.host.accept({ ...a, epoch: 6, type: "ack", seq: last() });
      if (ack === "stale") f.host.accept({ ...a, type: "ack", seq: 1 });
      ui.terminal.write("x".repeat(LIMIT.outputChunkBytes));
    }
    const seqs = f.events.flatMap((e) => (e.type === "data" ? [e.seq] : []));
    expect(seqs).toEqual(seqs.map((_e, i) => i + 1));
    if (ack === "good") {
      expect(f.closes()).toBe(0);
      f.cancel();
      await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    } else {
      await expect(pending).rejects.toBeInstanceOf(RangeError);
      expect(f.events.at(-1)).toMatchObject({
        type: "close",
        reason: "failed",
      });
    }
  }
});

test("ready timeout separate from human wait; broker may park then rearm startup; disconnect cancels", async () => {
  const f = fixture("timers", { readyTimeoutMs: 20, ackTimeoutMs: 20 });
  const missing = observe(f.host.custom(() => blank()));
  await expect(missing).rejects.toThrow("readiness timed out");
  const parked = observe(f.host.custom(() => blank()));
  const a = f.address(1);
  f.host.deferView(a);
  await Bun.sleep(35);
  expect(f.closes(a)).toBe(0);
  f.host.awaitView(a);
  f.ready(a);
  await turn();
  await Bun.sleep(50);
  expect(f.closes(a)).toBe(0);
  f.host.disconnect();
  await expect(parked).rejects.toMatchObject({ name: "AbortError" });
  expect(f.host.pendingCount).toBe(0);
  const g = fixture("ack-timeout", { ackTimeoutMs: 20 }, false);
  const stalled = observe(g.host.custom(() => blank()));
  g.ready();
  await expect(stalled).rejects.toThrow("acknowledgement timed out");
});

test("byte/chunk/event-frequency bounds terminate UI rather than drop ANSI and continue", async () => {
  for (const stage of ["chunk", "writes", "resize", "commands"] as const) {
    const f = fixture();
    let ui!: TUI;
    const pending = observe(
      f.host.custom((tui) => {
        ui = tui;
        return blank();
      }),
    );
    f.ready();
    await turn();
    if (stage === "chunk")
      ui.terminal.write("界".repeat(Math.ceil(LIMIT.outputChunkBytes / 3)));
    if (stage === "writes")
      for (let i = 0; i < LIMIT.outputEventsPerSecond + 1; i++)
        ui.terminal.write("\x1b[");
    if (stage === "resize")
      for (let i = 0; i < LIMIT.resizesPerSecond + 1; i++)
        f.resize(f.address(), 80, 24);
    if (stage === "commands")
      for (let i = 0; i < LIMIT.commandsPerSecond + 1; i++) f.ready();
    await expect(pending).rejects.toBeInstanceOf(RangeError);
    expect(f.closes()).toBe(1);
    const count = f.events.length;
    ui.terminal.write("after");
    expect(f.events.length).toBe(count);
  }
});

test("binary byte strings preserved; async initialization query responses bypass only user-input queue", async () => {
  const f = fixture();
  let release!: (value: Component) => void;
  const received: string[] = [];
  const pending = observe(
    f.host.custom(async (tui) => {
      tui.addInputListener((data) => {
        received.push(data);
        return undefined;
      });
      return await new Promise<Component>((resolve) => {
        release = resolve;
      });
    }),
  );
  f.ready();
  f.input(f.address(), "user");
  f.input(f.address(), "\x1b[12;34R");
  expect(received).toEqual(["\x1b[12;34R"]);
  release(blank());
  await turn();
  expect(received.join("")).toBe("\x1b[12;34Ruser");
  const raw: string[] = [];
  const terminal = new VirtualTerminal(
    80,
    24,
    () => {},
    (error) => {
      throw error;
    },
  );
  terminal.start(
    (data) => raw.push(data),
    () => {},
  );
  terminal.resumeInput();
  terminal.input("\x1b[M\xff\x80\x81", 6);
  expect(raw).toEqual(["\x1b[M\xff\x80\x81"]);
  terminal.dispose();
  f.input(f.address(), "\xff", "binary");
  expect(received.at(-1)).toBe("\xff");
  f.cancel();
  await expect(pending).rejects.toMatchObject({ name: "AbortError" });
});

test("host onTerminalInput bridge transforms/consumes real input and unsubscribes across surfaces", async () => {
  const f = fixture();
  const foreign = fixture("other");
  const received: string[] = [];
  const unsubscribe = f.host.addInputListener((data) => {
    received.push(data);
    return data === "x"
      ? { consume: true }
      : data === "a"
        ? { data: "b" }
        : undefined;
  });
  const input = new Input();
  const other = new Input();
  const pending = observe(f.host.custom(() => input));
  const otherPending = observe(foreign.host.custom(() => other));
  f.ready();
  foreign.ready();
  await turn();
  f.input(f.address(), "xa");
  foreign.input(foreign.address(), "a");
  expect(input.getValue()).toBe("b");
  expect(other.getValue()).toBe("a");
  expect(received).toEqual(["x", "a"]);
  unsubscribe();
  unsubscribe();
  f.input(f.address(), "a");
  expect(input.getValue()).toBe("ba");
  expect(received).toEqual(["x", "a"]);
  f.cancel();
  foreign.cancel();
  await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  await expect(otherPending).rejects.toMatchObject({ name: "AbortError" });
});
