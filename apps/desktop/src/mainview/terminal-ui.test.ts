import { expect, test } from "bun:test";
import {
  TERMINAL_LIMITS as LIMIT,
  type TerminalClientCommand,
  type TerminalHostEvent,
} from "../shared/terminal-ui";
import {
  createTerminalConnection,
  isTerminalKeyboardEvent,
  safeTerminalURL,
} from "./terminal-ui";

const address = { sessionId: "session", epoch: 3, uiId: "ui" };
function fixture() {
  const commands: TerminalClientCommand[] = [];
  const data: string[] = [];
  const processed: (() => void)[] = [];
  const errors: unknown[] = [];
  const closes: string[] = [];
  const client = createTerminalConnection(address, {
    send: (command) => {
      commands.push(command);
    },
    write: (text, callback) => {
      data.push(text);
      processed.push(callback);
    },
    onError: (error) => {
      errors.push(error);
    },
    onClose: (reason) => {
      closes.push(reason);
    },
  });
  const receive = (seq: number, text = "\x1b[") =>
    client.receive({ ...address, type: "data", seq, data: text });
  return { client, commands, data, processed, errors, closes, receive };
}
test("subscribe/write before ready contract; fitted ready once; text/binary input seq and resize", () => {
  const f = fixture();
  f.client.input("ignored");
  f.client.resize(80, 24);
  f.client.ready(1, 24);
  expect(f.commands).toEqual([]);
  f.client.ready(80, 24);
  f.client.ready(90, 30);
  f.client.input("界");
  f.client.input("\xff\x80", "binary");
  f.client.resize(100, 30);
  expect(f.commands).toEqual([
    { ...address, type: "ready", cols: 80, rows: 24 },
    { ...address, type: "input", inputSeq: 1, encoding: "text", data: "界" },
    {
      ...address,
      type: "input",
      inputSeq: 2,
      encoding: "binary",
      data: "\xff\x80",
    },
    { ...address, type: "resize", cols: 100, rows: 30 },
  ]);
});
test("xterm parser callback, not receipt, acknowledges contiguous processed output; duplicates never rewrite", () => {
  const f = fixture();
  f.client.ready(80, 24);
  f.receive(1);
  f.receive(1);
  f.receive(2, "31mred");
  expect(f.data).toEqual(["\x1b[", "31mred"]);
  expect(f.commands.filter((c) => c.type === "ack")).toEqual([]);
  f.processed[1]();
  expect(f.commands.at(-1)?.type).toBe("ready");
  f.processed[0]();
  expect(f.commands.at(-1)).toEqual({ ...address, type: "ack", seq: 2 });
  const count = f.commands.length;
  f.processed[0]();
  f.processed[1]();
  expect(f.commands.length).toBe(count);
  f.client.receive({ ...address, type: "close", reason: "done" });
  f.client.dispose();
  expect(f.closes).toEqual(["done"]);
  expect(f.commands.length).toBe(count);
});
test("stale session/epoch/uiId cannot write or close current surface", () => {
  const f = fixture();
  f.client.ready(80, 24);
  for (const wrong of [
    { sessionId: "other" },
    { epoch: 2 },
    { uiId: "other" },
  ]) {
    f.client.receive({
      ...address,
      ...wrong,
      type: "data",
      seq: 1,
      data: "bad",
    });
    f.client.receive({
      ...address,
      ...wrong,
      type: "close",
      reason: "cancelled",
    });
  }
  expect(f.data).toEqual([]);
  expect(f.closes).toEqual([]);
  f.receive(1, "ok");
  expect(f.data).toEqual(["ok"]);
});
test("gap, pre-ready output and oversized chunks explicitly cancel rather than silently drop ANSI", () => {
  for (const cause of ["gap", "early", "chunk"]) {
    const f = fixture();
    if (cause !== "early") f.client.ready(80, 24);
    f.receive(
      cause === "gap" ? 2 : 1,
      cause === "chunk"
        ? "界".repeat(Math.ceil(LIMIT.outputChunkBytes / 3))
        : "data",
    );
    expect(f.errors.length).toBe(1);
    expect(f.commands.at(-1)).toEqual({ ...address, type: "cancel" });
    expect(f.data).toEqual([]);
    f.receive(1, "after");
    expect(f.data).toEqual([]);
  }
});
test("slow xterm bounds pending bytes/events; late callbacks after cancellation do nothing", () => {
  const f = fixture();
  f.client.ready(80, 24);
  for (let seq = 1; seq <= 5; seq++)
    f.receive(seq, "x".repeat(LIMIT.outputChunkBytes));
  expect(f.data.length).toBe(4);
  expect(f.errors.length).toBe(1);
  expect(f.commands.at(-1)?.type).toBe("cancel");
  const count = f.commands.length;
  for (const processed of f.processed) processed();
  f.client.dispose();
  expect(f.commands.length).toBe(count);
  const g = fixture();
  g.client.ready(80, 24);
  for (let seq = 1; seq <= LIMIT.pendingEvents + 1; seq++) g.receive(seq, "x");
  expect(g.data.length).toBe(LIMIT.pendingEvents);
  expect(g.errors.length).toBe(1);
});
test("input bytes and binary validation fail closed, including transport/write exceptions", () => {
  for (const encoding of ["text", "binary"] as const) {
    const f = fixture();
    f.client.ready(80, 24);
    f.client.input(encoding === "text" ? "界".repeat(22_000) : "界", encoding);
    expect(f.commands.at(-1)?.type).toBe("cancel");
    expect(f.errors.length).toBe(1);
  }
  const errors: unknown[] = [];
  const commands: TerminalClientCommand[] = [];
  const client = createTerminalConnection(address, {
    send: (c) => {
      commands.push(c);
    },
    write: () => {
      throw new Error("parser");
    },
    onError: (e) => {
      errors.push(e);
    },
  });
  client.ready(80, 24);
  client.receive({ ...address, type: "data", seq: 1, data: "x" });
  expect(errors.length).toBe(1);
  expect(commands.at(-1)?.type).toBe("cancel");
  const failing = createTerminalConnection(address, {
    send: () => {
      throw new Error("transport");
    },
    write() {},
    onError: (e) => {
      errors.push(e);
    },
  });
  failing.ready(80, 24);
  failing.dispose();
  expect(errors.length).toBeGreaterThan(1);
});
test("output event rate is bounded even when every write immediately acknowledges", () => {
  const commands: TerminalClientCommand[] = [];
  const errors: unknown[] = [];
  const client = createTerminalConnection(address, {
    send: (c) => {
      commands.push(c);
    },
    write: (_d, done) => done(),
    onError: (e) => {
      errors.push(e);
    },
  });
  client.ready(80, 24);
  for (let seq = 1; seq <= LIMIT.outputEventsPerSecond + 1; seq++)
    client.receive({ ...address, type: "data", seq, data: "x" });
  expect(errors.length).toBe(1);
  expect(commands.at(-1)?.type).toBe("cancel");
});
test("Close/disconnect emits addressed cancel once, never emits a success value", () => {
  const f = fixture();
  f.client.ready(80, 24);
  f.receive(1);
  f.client.cancel();
  f.client.dispose();
  f.processed[0]();
  expect(f.commands.filter((c) => c.type === "cancel")).toEqual([
    { ...address, type: "cancel" },
  ]);
  expect(f.commands.filter((c) => c.type === "ack")).toEqual([]);
});
test("URL allowlist is http(s) only; HTML/OSC strings have no privileged interpretation", () => {
  expect(safeTerminalURL("https://example.com/path")).toBe(
    "https://example.com/path",
  );
  expect(safeTerminalURL("HTTP://example.com")).toBe("http://example.com/");
  for (const url of [
    "javascript:alert(1)",
    "file:///C:/secret",
    "shell:calc",
    "data:text/html,<script>",
    "//example.com",
    "relative",
    "\x1b]52;c;secret\x07",
  ])
    expect(safeTerminalURL(url)).toBeUndefined();
  expect(isTerminalKeyboardEvent({ target: null })).toBe(false);
  const f = fixture();
  f.client.ready(80, 24);
  f.receive(1, "<script>alert(1)</script>\x1b]52;c;secret\x07");
  expect(f.data).toEqual(["<script>alert(1)</script>\x1b]52;c;secret\x07"]); // Only the xterm writer receives data.
});
// Structural wire compatibility: event payload remains data-only, never a Component.
const _event: TerminalHostEvent = {
  ...address,
  type: "open",
  parentUiId: "parent",
};
void _event;
