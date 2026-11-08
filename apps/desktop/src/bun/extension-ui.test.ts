import { expect, spyOn, test } from "bun:test";
import type { ExtensionUIContext } from "@earendil-works/pi-coding-agent";
import { ExtensionDialogs, notificationUI } from "./extension-ui";

function fixture() {
  const dialogs = new ExtensionDialogs();
  const ui = notificationUI(
    {} as ExtensionUIContext,
    () => {},
    dialogs,
    "session",
  );
  return { dialogs, ui };
}

test("standard dialogs resolve typed values and publish complete per-session pending arrays", async () => {
  const { dialogs, ui } = fixture();
  const changes: number[] = [];
  const unsubscribe = dialogs.subscribe((_sessionId, requests) =>
    changes.push(requests.length),
  );
  const select = ui.select("Choose", ["one", "two"]);
  const confirm = ui.confirm("Confirm", "Continue?");
  const input = ui.input("Input", "placeholder");
  const editor = ui.editor("Editor", "prefill");
  const requests = dialogs.list();
  expect(requests.map((r) => r.kind)).toEqual([
    "select",
    "confirm",
    "input",
    "editor",
  ]);
  expect(requests.every((r) => r.sessionId === "session")).toBe(true);
  for (const [index, value] of ["two", true, "", "new\ntext"].entries())
    dialogs.answer({ sessionId: "session", id: requests[index].id, value });
  expect(await Promise.all([select, confirm, input, editor])).toEqual([
    "two",
    true,
    "",
    "new\ntext",
  ]);
  expect(changes).toEqual([1, 2, 3, 4, 3, 2, 1, 0]);
  expect(dialogs.list()).toEqual([]);
  unsubscribe();
  await expect(
    ui.custom(() => {
      throw new Error("must not run");
    }),
  ).rejects.toThrow("TUI components are not supported");
});

test("responses validate session, ID, option and value without consuming pending requests", async () => {
  const { dialogs, ui } = fixture();
  const result = ui.select("Choose", ["one"]);
  const request = dialogs.list()[0];
  request.title = "mutated snapshot";
  if (request.kind === "select") request.options.push("forged");
  expect(dialogs.list()[0].title).toBe("Choose");
  for (const response of [
    { sessionId: "other", id: request.id, value: "one" },
    { sessionId: "session", id: "unknown", value: "one" },
    { sessionId: "session", id: request.id, value: false },
    { sessionId: "session", id: request.id, value: "forged" },
    { sessionId: "session", id: request.id, cancelled: true, value: "one" },
  ])
    expect(() => dialogs.answer(response)).toThrow();
  expect(dialogs.list()).toHaveLength(1);
  dialogs.answer({ ...request, value: "one" });
  expect(await result).toBe("one");
  expect(() => dialogs.answer({ ...request, value: "one" })).toThrow();
  const confirm = ui.confirm("Confirm", "message");
  const pending = dialogs.list()[0];
  expect(() => dialogs.answer({ ...pending, value: "true" })).toThrow();
  dialogs.answer({ ...pending, cancelled: true });
  expect(await confirm).toBe(false);
});

test("abort, timeout, cancellation and disposal clean pending requests and listeners", async () => {
  const { dialogs, ui } = fixture();
  const controller = new AbortController();
  const remove = spyOn(controller.signal, "removeEventListener");
  const result = ui.input("Input", undefined, {
    signal: controller.signal,
    timeout: 10000,
  });
  controller.abort();
  expect(await result).toBeUndefined();
  expect(remove).toHaveBeenCalledTimes(1);
  expect(
    await ui.confirm("Confirm", "message", { signal: controller.signal }),
  ).toBe(false);
  expect(await ui.select("Choose", ["one"], { timeout: 1 })).toBeUndefined();
  const other = dialogs.request("other", { kind: "input", title: "Other" });
  const editor = ui.editor("Editor");
  dialogs.close("session");
  expect(await editor).toBeUndefined();
  expect(await ui.input("Already closed")).toBeUndefined();
  expect(dialogs.list()).toHaveLength(1);
  dialogs.activate("session");
  const confirm = ui.confirm("Confirm", "message");
  dialogs.dispose();
  expect(await other).toBeUndefined();
  expect(await confirm).toBe(false);
  expect(await ui.editor("Disposed")).toBeUndefined();
  expect(dialogs.list()).toEqual([]);
  remove.mockRestore();
});

test("invalid request payloads and timeout are rejected", () => {
  const { dialogs } = fixture();
  expect(() =>
    dialogs.request(
      "s",
      { kind: "input", title: "Input" },
      { timeout: Number.NaN },
    ),
  ).toThrow();
  expect(() =>
    dialogs.request("s", {
      kind: "select",
      title: "Choose",
      options: [4] as unknown as string[],
    }),
  ).toThrow();
  expect(dialogs.list()).toEqual([]);
});
