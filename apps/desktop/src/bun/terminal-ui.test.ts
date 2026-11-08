import { afterEach, expect, test } from "bun:test";
import { getSelectListTheme, Theme } from "@earendil-works/pi-coding-agent";
import {
  type Component,
  CURSOR_MARKER,
  getCapabilities,
  Input,
  type OverlayHandle,
  SelectList,
  Text,
  type TUI,
  TuiAltScreen,
} from "@earendil-works/pi-tui";
import type { TerminalUICommand, TerminalUIEvent } from "../shared/terminal-ui";
import { TerminalUIHost } from "./terminal-ui";

// A real, in-memory theme; no user themes, settings, auth, or GUI are accessed.
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
const hosts: TerminalUIHost[] = [];
afterEach(() => {
  for (const host of hosts.splice(0)) host.dispose();
});
function observe<T>(promise: Promise<T>) {
  void promise.catch(() => {});
  return promise;
}
async function turn() {
  await Promise.resolve();
  await Promise.resolve();
}
function fixture(sessionId = "session") {
  const events: TerminalUIEvent[] = [];
  const host = new TerminalUIHost(sessionId, theme, (event) =>
    events.push(event),
  );
  hosts.push(host);
  return {
    host,
    events,
    id: (index = 0) => {
      const event = events.filter((event) => event.type === "open")[index];
      if (!event) throw new Error("Missing open event");
      return event.id;
    },
    ready: (id: string, cols = 80, rows = 24) =>
      host.accept({ type: "ready", id, cols, rows }),
    input: (id: string, data: string) =>
      host.accept({ type: "input", id, data }),
    resize: (id: string, cols: number, rows: number) =>
      host.accept({ type: "resize", id, cols, rows }),
    output: (id: string) =>
      events
        .flatMap((event) =>
          event.type === "data" && event.id === id ? [event.data] : [],
        )
        .join(""),
    closes: (id: string) =>
      events.filter((event) => event.type === "close" && event.id === id)
        .length,
  };
}
function blank(dispose?: () => void): Component & { dispose?: () => void } {
  return { render: () => ["component"], invalidate() {}, dispose };
}

test("open is immediate, factories and raw output wait for fitted ready; FIFO-compatible IDs", async () => {
  const f = fixture("first-session");
  const started: string[] = [];
  let firstTui!: TUI;
  let firstDone!: (result: string) => void;
  let secondDone!: (result: string) => void;
  const first = observe(
    f.host.custom<string>((tui, passedTheme, _kb, done) => {
      expect(tui).toBeInstanceOf(TuiAltScreen);
      expect(passedTheme).toBe(theme);
      expect([tui.terminal.columns, tui.terminal.rows]).toEqual([90, 30]);
      started.push("first");
      firstTui = tui;
      firstDone = done;
      return new Text("first-render", 0, 0);
    }),
  );
  const second = observe(
    f.host.custom<string>((_tui, _theme, _kb, done) => {
      started.push("second");
      secondDone = done;
      return blank();
    }),
  );
  const one = f.id();
  const two = f.id(1);
  expect(one).not.toBe(two);
  expect(one).toMatch(/^[0-9a-f-]{36}$/);
  expect(f.events).toEqual([
    { type: "open", id: one, sessionId: "first-session" },
    { type: "open", id: two, sessionId: "first-session" },
  ]);
  f.input(one, "ignored-before-ready");
  f.resize(one, 100, 40);
  await turn();
  expect(started).toEqual([]);
  expect(f.output(one)).toBe("");
  f.ready(one, 90, 30);
  f.ready(one, 10, 10); // Idempotent; not a resize or a second factory invocation.
  await turn();
  firstTui.renderNow();
  expect(started).toEqual(["first"]);
  expect(firstTui.terminal.columns).toBe(90);
  expect(f.output(one)).toContain("\x1b[?1049h");
  expect(f.output(one)).toContain("first-render");
  expect(f.output(two)).toBe("");
  firstDone("one");
  expect(await first).toBe("one");
  f.ready(two);
  await turn();
  expect(started).toEqual(["first", "second"]);
  secondDone("two");
  expect(await second).toBe("two");
  expect(f.closes(one)).toBe(1);
  expect(f.closes(two)).toBe(1);
});

test("plain input, fragmented keys and bracketed paste use StdinBuffer; resize precedes callback/redraw", async () => {
  const f = fixture();
  const input = new Input();
  const sequences: string[] = [];
  const resizeDimensions: number[][] = [];
  const renderedDimensions: number[][] = [];
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
        sequences.push(data);
        return undefined;
      });
      const requestRender = tui.requestRender.bind(tui);
      tui.requestRender = (force) => {
        resizeDimensions.push([tui.terminal.columns, tui.terminal.rows]);
        requestRender(force);
      };
      const render = input.render.bind(input);
      input.render = (width) => {
        renderedDimensions.push([width, tui.terminal.rows]);
        return render(width);
      };
      return input;
    }),
  );
  const id = f.id();
  f.ready(id);
  f.input(id, "ab"); // Queued until the returned component is mounted.
  await turn();
  expect(input.focused).toBe(true);
  f.input(id, "\x1b[");
  f.input(id, "D");
  f.input(id, "\x1b[200~xy");
  f.input(id, "z\x1b[201~");
  expect(input.getValue()).toBe("axyzb");
  expect(sequences).toEqual(["a", "b", "\x1b[D", "\x1b[200~xyz\x1b[201~"]);
  f.input(id, "\x1b");
  await Bun.sleep(40);
  expect(escaped).toBe(1);
  expect(f.closes(id)).toBe(0); // Escape belongs to the component, not the host.
  f.resize(id, 110, 35);
  expect(resizeDimensions.at(-1)).toEqual([110, 35]);
  await Bun.sleep(40); // Exercise SDK requestRender scheduling, not a snapshot conversion.
  expect(renderedDimensions.at(-1)).toEqual([110, 35]);
  expect(f.output(id)).not.toContain(CURSOR_MARKER);
  f.input(id, "\r");
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

test("actual overlay composition, selection and handle focus/visibility/bounds (static or callback options)", async () => {
  for (const dynamic of [false, true]) {
    const f = fixture();
    const base = new Input();
    base.setValue("BACKGROUND");
    base.handleInput("\x05"); // Cursor at end so raw text is not split by its inverse glyph.
    let ui!: TUI;
    let handle!: OverlayHandle;
    let optionsCalls = 0;
    const opts = {
      width: "50%" as const,
      row: 2,
      col: 3,
      visible: (width: number) => width >= 60,
    };
    const pending = observe(
      f.host.custom<string>(
        (tui, _theme, _kb, done) => {
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
                optionsCalls++;
                return opts;
              }
            : opts,
          onHandle: (value) => {
            handle = value;
          },
        },
      ),
    );
    const id = f.id();
    expect(optionsCalls).toBe(0);
    f.ready(id, 100, 30);
    await turn();
    ui.renderNow();
    expect(optionsCalls).toBe(dynamic ? 1 : 0);
    expect(f.output(id)).toContain("BACKGROUND");
    expect(f.output(id)).toContain("First-choice");
    expect(handle.getBounds()).toMatchObject({ row: 2, col: 3, width: 50 });
    expect(handle.isFocused()).toBe(true);
    expect(base.focused).toBe(false);
    handle.setHidden(true);
    expect(handle.isHidden()).toBe(true);
    expect(base.focused).toBe(true);
    handle.setHidden(false);
    handle.unfocus();
    expect(base.focused).toBe(true);
    handle.focus();
    expect(handle.isFocused()).toBe(true);
    f.resize(id, 40, 12);
    ui.renderNow();
    expect(handle.getBounds()).toBeUndefined();
    f.resize(id, 120, 32);
    ui.renderNow();
    expect(handle.getBounds()?.width).toBe(60);
    f.input(id, "\x1b[B\r");
    expect(await pending).toBe("second");
    expect(f.closes(id)).toBe(1);
    expect(handle.getBounds()).toBeUndefined();
  }
});

test("components can create actual overlays using the supplied tui", async () => {
  const f = fixture();
  let ui!: TUI;
  let popup!: OverlayHandle;
  let disposed = 0;
  const pending = observe(
    f.host.custom<string>((tui, _theme, _kb, done) => {
      ui = tui;
      return {
        render: () => ["ROOT"],
        invalidate() {},
        dispose: () => {
          disposed++;
        },
        handleInput: (data) => {
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
  const id = f.id();
  f.ready(id);
  await turn();
  f.input(id, "o");
  ui.renderNow();
  expect(f.output(id)).toContain("ROOT");
  expect(f.output(id)).toContain("Popup-choice");
  expect(popup.isFocused()).toBe(true);
  popup.hide();
  expect(ui.hasOverlay()).toBe(false);
  expect(f.closes(id)).toBe(0); // Actual hide semantics, not implicit done/cancel.
  f.input(id, "o\r");
  expect(await pending).toBe("selected");
  expect(disposed).toBe(1);
});

test("done keeps arbitrary backend values local and double settlement/close disposes once", async () => {
  const f = fixture();
  const result = { map: new Map([["x", 7n]]), fn: () => "local" };
  let done!: (value: typeof result) => void;
  let disposed = 0;
  const pending = observe(
    f.host.custom<typeof result>((_tui, _theme, _kb, finish) => {
      done = finish;
      return blank(() => {
        disposed++;
      });
    }),
  );
  const id = f.id();
  f.ready(id);
  await turn();
  done(result);
  done(result);
  f.host.accept({ type: "cancel", id });
  f.host.cancelAll();
  expect(await pending).toBe(result);
  expect(disposed).toBe(1);
  expect(f.closes(id)).toBe(1);
  expect(f.events.every((event) => !("map" in event) && !("fn" in event))).toBe(
    true,
  );
});

test("synchronous done inside factory still disposes the returned component exactly once", async () => {
  const f = fixture();
  let disposed = 0;
  let rendered = 0;
  const pending = observe(
    f.host.custom<number>(
      (_tui, _theme, _kb, done) => {
        done(42);
        done(43);
        return {
          render: () => {
            rendered++;
            return [];
          },
          invalidate() {},
          dispose: () => {
            disposed++;
          },
        };
      },
      { overlay: true },
    ),
  );
  const id = f.id();
  f.ready(id);
  expect(await pending).toBe(42);
  await turn();
  expect(disposed).toBe(1);
  expect(rendered).toBe(0);
  expect(f.closes(id)).toBe(1);
});

test("late asynchronous factory after cancellation is disposed once, never mounted or written", async () => {
  const f = fixture();
  let release!: (component: Component & { dispose(): void }) => void;
  let lateDone!: (result: number) => void;
  let ui!: TUI;
  let disposed = 0;
  let rendered = 0;
  const pending = observe(
    f.host.custom<number>(async (tui, _theme, _kb, done) => {
      ui = tui;
      lateDone = done;
      return await new Promise<Component & { dispose(): void }>((resolve) => {
        release = resolve;
      });
    }),
  );
  const id = f.id();
  f.ready(id);
  f.input(id, "queued");
  f.host.accept({ type: "cancel", id });
  await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  const count = f.events.length;
  release({
    render: () => {
      rendered++;
      return [];
    },
    invalidate() {},
    dispose: () => {
      disposed++;
    },
  });
  await turn();
  lateDone(1);
  ui.requestRender();
  ui.renderNow();
  expect(disposed).toBe(1);
  expect(rendered).toBe(0);
  expect(f.events.length).toBe(count);
  expect(f.closes(id)).toBe(1);
});

test("factory, async factory, scheduled render, input, overlay-options and onHandle errors reject and clean up", async () => {
  for (const stage of [
    "factory",
    "async",
    "render",
    "input",
    "escape",
    "options",
    "handle",
  ] as const) {
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
    const id = f.id();
    f.ready(id);
    await turn();
    if (stage === "input") f.input(id, "x");
    if (stage === "escape") f.input(id, "\x1b");
    await expect(pending).rejects.toBe(error);
    expect(f.closes(id)).toBe(1);
    expect(disposed).toBe(stage === "factory" || stage === "async" ? 0 : 1);
    expect(process.listenerCount("exit")).toBe(exits);
    const count = f.events.length;
    ui.requestRender(true);
    ui.renderNow();
    expect(f.events.length).toBe(count);
  }
});

test("nested requests can queue, pre-ready/stale/foreign commands cannot start or affect them", async () => {
  const f = fixture();
  const foreign = fixture("foreign");
  const calls: string[] = [];
  let nested!: Promise<string>;
  let finish!: (result: string) => void;
  const first = observe(
    f.host.custom<number>((_ui, _theme, _kb, done) => {
      calls.push("outer");
      nested = observe(
        f.host.custom<string>((_inner, _theme, _kb, done) => {
          calls.push("inner");
          finish = done;
          return blank();
        }),
      );
      done(1);
      return blank();
    }),
  );
  const one = f.id();
  foreign.ready(one);
  f.ready("unknown");
  expect(calls).toEqual([]);
  f.ready(one);
  expect(await first).toBe(1);
  const two = f.id(1);
  f.input(two, "ignored-before-ready");
  f.ready(one);
  f.input(one, "stale");
  f.host.accept({ type: "cancel", id: one });
  expect(calls).toEqual(["outer"]);
  f.ready(two);
  f.ready(two);
  await turn();
  expect(calls).toEqual(["outer", "inner"]);
  finish("nested-result");
  expect(await nested).toBe("nested-result");
});

test("invalid dimensions and input types/sizes are ignored at the boundary", async () => {
  const f = fixture();
  let ui!: TUI;
  const input = new Input();
  const pending = observe(
    f.host.custom<string>((tui, _theme, _kb, done) => {
      ui = tui;
      input.onSubmit = done;
      return input;
    }),
  );
  const id = f.id();
  const invalid = [
    [0, 24],
    [1, 24],
    [501, 24],
    [80, 1],
    [80, 201],
    [80.5, 24],
    [80, 24.5],
    [Number.NaN, 24],
    [80, Number.POSITIVE_INFINITY],
    ["80", 24],
  ];
  for (const [cols, rows] of invalid) {
    f.host.accept({ type: "ready", id, cols, rows } as TerminalUICommand);
  }
  expect(f.output(id)).toBe("");
  f.ready(id, 2, 2);
  await turn();
  expect([ui.terminal.columns, ui.terminal.rows]).toEqual([2, 2]);
  f.resize(id, 500, 200);
  for (const [cols, rows] of invalid)
    f.host.accept({ type: "resize", id, cols, rows } as TerminalUICommand);
  expect([ui.terminal.columns, ui.terminal.rows]).toEqual([500, 200]);
  for (const data of [42, null, {}, "x".repeat(64 * 1024 + 1)]) {
    f.host.accept({ type: "input", id, data } as TerminalUICommand);
  }
  expect(input.getValue()).toBe("");
  f.input(id, "ok\r");
  expect(await pending).toBe("ok");
});

test("unfinished bracketed paste and asynchronous-factory input queues are bounded", async () => {
  for (const asyncFactory of [false, true]) {
    const f = fixture();
    let release!: (component: Component) => void;
    const pending = observe(
      f.host.custom(() =>
        asyncFactory
          ? new Promise<Component>((resolve) => {
              release = resolve;
            })
          : new Input(),
      ),
    );
    const id = f.id();
    f.ready(id);
    await turn();
    if (!asyncFactory) f.input(id, "\x1b[200~");
    for (let i = 0; i < 17; i++) f.input(id, "x".repeat(64 * 1024));
    await expect(pending).rejects.toBeInstanceOf(RangeError);
    expect(f.closes(id)).toBe(1);
    if (asyncFactory) release(blank());
    await turn();
  }
});

test("cancelAll aborts waiting/open calls; host is reusable, dispose permanently rejects", async () => {
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
  f.ready(f.id(1));
  await turn();
  f.host.cancelAll("reload");
  await expect(waiting).rejects.toMatchObject({
    name: "AbortError",
    message: "reload",
  });
  await expect(active).rejects.toMatchObject({
    name: "AbortError",
    message: "reload",
  });
  expect(disposed).toBe(1);
  expect(f.closes(f.id())).toBe(1);
  expect(f.closes(f.id(1))).toBe(1);
  const reused = observe(
    f.host.custom<boolean>((_ui, _theme, _kb, done) => {
      done(true);
      return blank();
    }),
  );
  f.ready(f.id(2));
  expect(await reused).toBe(true);
  expect(new Set([f.id(), f.id(1), f.id(2)]).size).toBe(3);
  const last = observe(f.host.custom(() => blank()));
  f.host.dispose();
  f.host.dispose();
  await expect(last).rejects.toMatchObject({ name: "AbortError" });
  const eventCount = f.events.length;
  await expect(
    f.host.custom(() => {
      throw new Error("must not run");
    }),
  ).rejects.toMatchObject({ name: "AbortError" });
  expect(f.events.length).toBe(eventCount);
});

test("truthful capabilities, public keybinding adapter, terminal operations, and explicit tui.stop", async () => {
  const f = fixture();
  const stdinListeners = process.stdin.listenerCount("data");
  const resizeListeners = process.stdout.listenerCount("resize");
  let ui!: TUI;
  const pending = observe(
    f.host.custom((tui, _theme, kb) => {
      ui = tui;
      expect(kb.matches("\x1b", "app.interrupt")).toBe(true);
      expect(kb.matches("\x03", "app.clear")).toBe(true);
      expect(kb.matches("x", "app.model.select")).toBe(false);
      expect(kb.getKeys("app.model.select")).toEqual([]);
      expect(kb.getDefinition("app.model.select").defaultKeys).toEqual([]);
      expect(kb.getEffectiveConfig()["app.interrupt"]).toBe("escape");
      kb.reload();
      expect(getCapabilities()).toMatchObject({
        images: null,
        trueColor: true,
        hyperlinks: true,
      });
      expect(tui.terminal.kittyProtocolActive).toBe(false);
      return blank();
    }),
  );
  const id = f.id();
  f.ready(id);
  await turn();
  expect(await ui.queryTerminalColors({ timeoutMs: 10000 })).toEqual({});
  const terminal = ui.terminal;
  terminal.moveBy(-2);
  terminal.moveBy(3);
  terminal.hideCursor();
  terminal.showCursor();
  terminal.clearLine();
  terminal.clearFromCursor();
  terminal.clearScreen();
  terminal.setTitle("Safe\x07title");
  terminal.setProgress(true);
  terminal.setProgress(false);
  terminal.setProgramStatus({ state: "working" });
  await terminal.drainInput();
  expect(f.output(id)).toContain(
    "\x1b[2A\x1b[3B\x1b[?25l\x1b[?25h\x1b[2K\x1b[0J\x1b[2J\x1b[H",
  );
  expect(f.output(id)).toContain("\x1b]0;Safetitle\x07");
  expect(f.output(id)).toContain("\x1b]9;4;3\x07\x1b]9;4;0\x07");
  expect(process.stdin.listenerCount("data")).toBe(stdinListeners);
  expect(process.stdout.listenerCount("resize")).toBe(resizeListeners);
  ui.stop();
  await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  expect(f.closes(id)).toBe(1);
});

test("synchronous ready from open emission works for startup custom calls", async () => {
  const events: TerminalUIEvent[] = [];
  const host = new TerminalUIHost("startup", theme, (event) => {
    events.push(event);
    if (event.type === "open")
      host.accept({ type: "ready", id: event.id, cols: 72, rows: 20 });
  });
  hosts.push(host);
  const result = await host.custom<string>((tui, _theme, _kb, done) => {
    expect(tui.terminal.columns).toBe(72);
    done("startup-result");
    return blank();
  });
  expect(result).toBe("startup-result");
  expect(events[0]?.type).toBe("open");
  expect(events.at(-1)?.type).toBe("close");
});

test("transport/disposer failures cannot strand a request or replace cancellation's AbortError", async () => {
  for (const failure of ["open", "data", "close"] as const) {
    const error = new Error(failure);
    let id = "";
    let closes = 0;
    let ui!: TUI;
    const host = new TerminalUIHost("transport", theme, (event) => {
      if (event.type === "open") id = event.id;
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
    host.accept({ type: "ready", id, cols: 80, rows: 24 });
    await turn();
    if (failure === "close") ui.terminal.stop();
    if (failure === "close")
      await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    else await expect(pending).rejects.toBe(error);
    host.cancelAll();
    expect(closes).toBe(1);
  }
});

test("cancelAll also prevents reentrant custom requests from a disposer, then remains reusable", async () => {
  const f = fixture();
  let reentrant!: Promise<unknown>;
  const pending = observe(
    f.host.custom(() =>
      blank(() => {
        reentrant = observe(f.host.custom(() => blank()));
        f.host.cancelAll();
        throw new Error("bad disposer");
      }),
    ),
  );
  f.ready(f.id());
  await turn();
  f.host.cancelAll("reload");
  await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  await expect(reentrant).rejects.toMatchObject({ name: "AbortError" });
  expect(f.events.filter((event) => event.type === "open").length).toBe(1);
  const reused = observe(
    f.host.custom<number>((_ui, _theme, _kb, done) => {
      done(7);
      return blank();
    }),
  );
  f.ready(f.id(1));
  expect(await reused).toBe(7);
});
