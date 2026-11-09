import { afterEach, expect, test } from "bun:test";
import type { ExtensionUIEvent } from "../shared/extension-ui";
import type { SessionAddress } from "../shared/runtime-contract";
import { ComposerBridge } from "./composer-bridge";
import { createNativeUIHost, type NativeUIHost } from "./extension-ui";
import { UIRequestBroker } from "./ui-request-broker";

const address: SessionAddress = {
  hostId: "host",
  sessionId: "native-a",
  epoch: 1,
};
const hosts: NativeUIHost[] = [];
afterEach(() => {
  for (const host of hosts.splice(0)) host.dispose();
});
function fixture(available = true) {
  const events: ExtensionUIEvent[] = [];
  const emit = (event: ExtensionUIEvent) => {
    events.push(event);
  };
  const broker = new UIRequestBroker(emit);
  broker.setAvailable(available);
  const drafts = new ComposerBridge(emit);
  const create = (at = address) => {
    const host = createNativeUIHost({ address: at, broker, drafts, emit });
    hosts.push(host);
    return host;
  };
  const request = () => {
    const first = broker.pending()[0];
    if (!first) throw new Error("No native dialog");
    return first;
  };
  return { events, broker, drafts, create, request };
}

test("native dialogs work at startup, rotate stable bridge and reject stale replies", async () => {
  const f = fixture(),
    host = f.create(),
    ui = host.ui;
  const first = ui.confirm("Startup", "Allow?");
  const old = f.request();
  host.rotate({ ...address, epoch: 2 });
  expect(await first).toBe(false);
  expect(host.ui).toBe(ui);
  const next = ui.input("New startup", "name");
  expect(() =>
    f.broker.resolve({ ...old, kind: "confirm", value: true }),
  ).toThrow();
  f.broker.resolve({ ...f.request(), kind: "input", value: "new epoch" });
  expect(await next).toBe("new epoch");
  expect("custom" in ui).toBe(false);
  expect("theme" in ui).toBe(false);
  expect("handleTerminal" in host).toBe(false);
});

test("deny/cancel/abort/timeout/disconnect/UI absence never admits an ordinary guarded action", async () => {
  for (const mode of [
    "deny",
    "cancel",
    "abort",
    "timeout",
    "disconnect",
    "unavailable",
  ] as const) {
    const f = fixture(mode !== "unavailable"),
      host = f.create();
    const controller = new AbortController();
    let calls = 0;
    const invocation = host.ui
      .confirm("Fixture", "Allow?", {
        signal: controller.signal,
        timeout: mode === "timeout" ? 2 : undefined,
      })
      .then((allow) => {
        if (allow) calls++;
      });
    if (mode === "deny")
      f.broker.resolve({ ...f.request(), kind: "confirm", value: false });
    if (mode === "cancel") host.cancelAll("stop");
    if (mode === "abort") controller.abort();
    if (mode === "disconnect") f.broker.setAvailable(false);
    await invocation;
    expect(calls).toBe(0);
  }
});

test("select/editor use broker validation, native nesting and Stop preserve other sessions", async () => {
  const f = fixture(),
    one = f.create(),
    two = f.create({ ...address, sessionId: "native-b" });
  const select = one.ui.select("Pick", ["one", "two"]);
  const parent = f.request();
  expect(() =>
    f.broker.resolve({ ...parent, kind: "select", value: "invalid" }),
  ).toThrow();
  const child = f.broker.withContext(parent, () =>
    one.ui.editor("Edit", "initial"),
  );
  expect(f.request().parentUiId).toBe(parent.uiId);
  const independent = two.ui.input("Other");
  one.cancelAll("stop");
  expect(await select).toBeUndefined();
  expect(await child).toBeUndefined();
  expect(f.request().sessionId).toBe("native-b");
  f.broker.resolve({ ...f.request(), kind: "input", value: "survives" });
  expect(await independent).toBe("survives");
});

test("Composer CAS/paste and addressed status/notify reuse app-owned bridges", () => {
  const f = fixture(),
    one = f.create(),
    two = f.create({ ...address, sessionId: "native-b" });
  const ui = one.ui;
  const old = ui.composer.read();
  ui.composer.setText("extension text");
  ui.composer.paste("\r\npasted");
  expect(ui.composer.text()).toBe("extension text\npasted");
  expect(two.ui.composer.text()).toBe("");
  expect(
    ui.composer.sync({ text: "stale", images: [], pastes: [] }, old.revision)
      .applied,
  ).toBe(false);
  const revision = ui.composer.read().revision;
  expect(
    ui.composer.sync({ text: "fresh", images: [], pastes: [] }, revision)
      .applied,
  ).toBe(true);
  ui.setStatus("fixture", "running");
  ui.setWidget("plain", ["line"], "belowEditor");
  ui.setLabel("title", "Title");
  ui.notify("fixture", "warning");
  expect(one.getStatus()).toMatchObject({
    statuses: [{ key: "fixture", text: "running" }],
    widgets: [{ placement: "belowEditor" }],
    title: "Title",
  });
  const snapshot = one.getStatus();
  snapshot.statuses.length = 0;
  expect(one.getStatus().statuses).toHaveLength(1);
  expect(two.getStatus()).toEqual({ statuses: [], widgets: [] });
  expect(f.events).toContainEqual({
    type: "notify",
    address,
    message: "fixture",
    level: "warning",
  });
  one.dispose();
  expect(() => ui.composer.text()).toThrow();
});

test("ordinary UI disposal cannot turn another app-owned approval projection into durable cancellation", async () => {
  const f = fixture(),
    host = f.create();
  const own = host.ui.confirm("Ordinary", "Confirm?");
  const projection = {
    ...address,
    uiId: "durable-projection",
    kind: "confirm" as const,
    title: "Security",
    message: "Immutable operation",
  };
  const other = f.broker.request(projection);
  host.dispose();
  expect(await own).toBe(false);
  expect(f.broker.pending().map((request) => request.uiId)).toEqual([
    projection.uiId,
  ]);
  f.broker.resolve({ ...projection, kind: "confirm", value: true });
  expect(await other).toMatchObject({ kind: "confirm", value: true });
});
