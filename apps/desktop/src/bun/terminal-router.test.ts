import { expect, test } from "bun:test";
import type { TerminalHostEvent, UIAddress } from "../shared/terminal-ui";
import { TERMINAL_IN_USE, TerminalRouter } from "./terminal-router";

const address: UIAddress = { sessionId: "chat", epoch: 1, uiId: "ui" };
function setup() {
  const delivered: { to: string; event: TerminalHostEvent }[] = [];
  const cancelled: UIAddress[] = [];
  const router = new TerminalRouter(
    {
      broadcast: (event) => delivered.push({ to: "*", event }),
      to: (client, event) => delivered.push({ to: client, event }),
    },
    (target) => cancelled.push(target),
  );
  return { router, delivered, cancelled };
}

test("the first ready window owns input and output; others are refused once", () => {
  const { router, delivered } = setup();
  router.event({ ...address, type: "open", title: "Shell" });
  router.event({ ...address, type: "data", seq: 1, data: "early" });
  expect(
    router.accept("a", { ...address, type: "ready", cols: 80, rows: 24 }),
  ).toBe(true);
  router.event({ ...address, type: "data", seq: 2, data: "owned" });
  expect(() =>
    router.accept("b", { ...address, type: "ready", cols: 80, rows: 24 }),
  ).toThrow(TERMINAL_IN_USE);
  // Later commands from the mirror are dropped without repeated errors.
  expect(router.accept("b", { ...address, type: "ack", seq: 2 })).toBe(false);
  expect(router.accept("b", { ...address, type: "cancel" })).toBe(false);
  expect(
    router.accept("a", {
      ...address,
      type: "input",
      inputSeq: 1,
      encoding: "text",
      data: "ls",
    }),
  ).toBe(true);
  router.event({ ...address, type: "close", reason: "done" });
  expect(delivered.map(({ to, event }) => `${to}:${event.type}`)).toEqual([
    "*:open",
    "*:data",
    "a:data",
    "*:close",
  ]);
});

test("a mirror closing its dialog never cancels the owner's terminal", () => {
  const { router, cancelled } = setup();
  router.event({ ...address, type: "open" });
  router.accept("a", { ...address, type: "ready", cols: 80, rows: 24 });
  expect(router.accept("b", { ...address, type: "cancel" })).toBe(false);
  router.drop("b");
  expect(cancelled).toEqual([]);
  router.drop("a");
  expect(cancelled).toEqual([address]);
});

test("unknown terminals pass through to the host's own validation", () => {
  const { router } = setup();
  expect(router.accept("a", { ...address, type: "cancel" })).toBe(true);
});
