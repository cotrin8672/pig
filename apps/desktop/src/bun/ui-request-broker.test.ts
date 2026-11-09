import { expect, test } from "bun:test";
import type { ExtensionUIEvent, UIRequest } from "../shared/extension-ui";
import type { SessionAddress } from "../shared/runtime-contract";
import { UI_TEXT_LIMIT, UIRequestBroker } from "./ui-request-broker";

const a: SessionAddress = { hostId: "host", sessionId: "opaque-a", epoch: 1 };
const b: SessionAddress = { ...a, sessionId: "opaque-b" };
const confirm = (
  uiId: string,
  address = a,
): UIRequest & { kind: "confirm" } => ({
  ...address,
  uiId,
  kind: "confirm",
  title: "Permission",
  message: "Run tool?",
});
function fixture() {
  const events: ExtensionUIEvent[] = [];
  const broker = new UIRequestBroker((event) => events.push(event));
  broker.setAvailable(true);
  return { broker, events };
}

test("Project Trust works before any extension host, unavailable/cancel never grants", async () => {
  const { broker } = fixture();
  const trust: UIRequest & { kind: "project-trust" } = {
    ...a,
    uiId: "trust",
    kind: "project-trust",
    title: "Trust project",
    cwd: "/fixture",
    fingerprint: "fixture-hash",
    resources: [{ path: "/fixture/extension.ts", kind: "code" }],
  };
  const pending = broker.request(trust);
  expect(broker.pending()).toEqual([trust]);
  broker.resolve({ ...trust, kind: "project-trust", value: "safe" });
  expect(await pending).toMatchObject({ kind: "project-trust", value: "safe" });
  broker.setAvailable(false);
  expect(await broker.request({ ...trust, uiId: "unavailable" })).toMatchObject(
    { kind: "cancel" },
  );
});

test("reply validates host/session/epoch/id, kind, selected membership, UTF-8 size, resolve once", async () => {
  const { broker, events } = fixture();
  const request: UIRequest & { kind: "select" } = {
    ...a,
    uiId: "select",
    kind: "select",
    title: "Choose",
    options: ["allowed"],
  };
  const pending = broker.request(request);
  for (const wrong of [
    { hostId: "old-host" },
    { sessionId: "other" },
    { epoch: 0 },
    { uiId: "other" },
  ]) {
    expect(() =>
      broker.resolve({
        ...request,
        ...wrong,
        kind: "select",
        value: "allowed",
      }),
    ).toThrow();
  }
  expect(() =>
    broker.resolve({ ...request, kind: "input", value: "allowed" }),
  ).toThrow("kind mismatch");
  expect(() =>
    broker.resolve({ ...request, kind: "select", value: "not-an-option" }),
  ).toThrow("selected");
  expect(() =>
    broker.resolve({
      ...request,
      kind: "select",
      value: "あ".repeat(UI_TEXT_LIMIT / 2),
    }),
  ).toThrow("limit");
  broker.resolve({ ...request, kind: "select", value: "allowed" });
  expect(await pending).toMatchObject({ kind: "select", value: "allowed" });
  expect(() => broker.resolve({ ...request, kind: "cancel" })).toThrow();
  await expect(broker.request(request)).rejects.toThrow("already used");
  expect(events.filter((event) => event.type === "requestEnd")).toHaveLength(1);
});

test("native dialog list: independent sessions cannot steal focus; nested child wins", async () => {
  const { broker } = fixture();
  const parent = {
    ...a,
    uiId: "editor",
    title: "Edit",
    kind: "editor" as const,
  };
  const parentPending = broker.request(parent);
  const independent = broker.request(confirm("independent", b));
  const childRequest = { ...confirm("child"), parentUiId: parent.uiId };
  const child = broker.withContext(parent, () => {
    expect(broker.currentParent(a)).toEqual(parent);
    expect(broker.currentParent(b)).toBeUndefined();
    return broker.request(childRequest);
  });
  expect(broker.currentParent(a)).toBeUndefined();
  expect(broker.pending().map((request) => request.uiId)).toEqual([
    "child",
    "editor",
    "independent",
  ]);
  expect(broker.isForeground(childRequest)).toBe(true);
  expect(broker.isForeground(confirm("independent", b))).toBe(false);
  broker.resolve({ ...childRequest, kind: "confirm", value: false });
  expect(await child).toMatchObject({ value: false });
  expect(broker.isForeground(parent)).toBe(true);
  broker.resolve({ ...parent, kind: "editor", value: "Edited" });
  expect(await parentPending).toMatchObject({ value: "Edited" });
  broker.resolve({
    ...confirm("independent", b),
    kind: "confirm",
    value: true,
  });
  expect(await independent).toMatchObject({ value: true });
  expect(broker.pending()).toEqual([]);
});

test("queued parent promotes its waiting descendants, cancellation cascades only addressed session", async () => {
  const { broker } = fixture();
  const first = broker.request(confirm("first", b));
  const parent = broker.request(confirm("parent"));
  const child = broker.request({ ...confirm("child"), parentUiId: "parent" });
  broker.cancelSession(b);
  expect(await first).toMatchObject({ kind: "cancel" });
  expect(broker.pending()[0]?.uiId).toBe("child");
  broker.cancelSession({ ...a, hostId: "wrong-host" });
  expect(broker.pending()).toHaveLength(2);
  broker.cancelSession(a);
  expect(await parent).toMatchObject({ kind: "cancel" });
  expect(await child).toMatchObject({ kind: "cancel" });
  expect(broker.pending()).toHaveLength(0);
});

test("AbortSignal/deadline/disconnect settle once and clean pending state", async () => {
  const { broker, events } = fixture();
  const controller = new AbortController();
  const one = broker.request(confirm("abort"), { signal: controller.signal });
  controller.abort();
  controller.abort();
  expect(await one).toMatchObject({ kind: "cancel" });
  const two = broker.request({
    ...confirm("timeout"),
    expiresAt: Date.now() + 5,
  });
  expect(await two).toMatchObject({ kind: "cancel" });
  expect(events).toContainEqual(
    expect.objectContaining({ type: "requestEnd", reason: "timeout" }),
  );
  const three = broker.request(confirm("disconnect"));
  const four = broker.request({
    ...b,
    uiId: "editor",
    kind: "editor",
    title: "Edit",
  });
  broker.setAvailable(false);
  expect(await three).toMatchObject({ kind: "cancel" });
  expect(await four).toMatchObject({ kind: "cancel" });
  expect(broker.pending()).toHaveLength(0);
  expect(events.filter((event) => event.type === "requestEnd")).toHaveLength(4);
});

test("async context scope survives await without contaminating independent session startup", async () => {
  const { broker } = fixture();
  const parent = confirm("parent");
  const pending = broker.request(parent);
  const scoped = broker.withContext(parent, async () => {
    await Promise.resolve();
    expect(broker.currentParent(a)?.uiId).toBe("parent");
    expect(broker.currentParent(b)).toBeUndefined();
  });
  expect(broker.currentParent(a)).toBeUndefined();
  await scoped;
  broker.cancelSession(a);
  await pending;
});

test("explicit Root selection can answer another session; an unresolved child still owns its parent", async () => {
  const { broker } = fixture();
  const first = broker.request(confirm("first"));
  const second = broker.request(confirm("second", b));
  expect(broker.pending()[0]?.uiId).toBe("first");
  broker.resolve({ ...confirm("second", b), kind: "confirm", value: false });
  expect(await second).toMatchObject({ value: false });
  const child = broker.request({ ...confirm("child"), parentUiId: "first" });
  expect(() =>
    broker.resolve({ ...confirm("first"), kind: "confirm", value: true }),
  ).toThrow("waiting child");
  const oversize = {
    ...confirm("child"),
    kind: "confirm" as const,
    value: true,
    extra: "x".repeat(4 * UI_TEXT_LIMIT),
  };
  expect(() => broker.resolve(oversize)).toThrow("size");
  broker.cancelSession(a);
  await first;
  await child;
});

test("cancelling A blocks reentrant A requests without denying B startup", async () => {
  let lateA: Promise<unknown> | undefined;
  let startupB: Promise<unknown> | undefined;
  const broker = new UIRequestBroker((event) => {
    if (event.type === "requestEnd" && event.address.uiId === "first") {
      expect(broker.isAvailable(a)).toBe(false);
      expect(broker.isAvailable(b)).toBe(true);
      lateA = broker.request(confirm("late-a"));
      startupB = broker.request(confirm("startup-b", b));
    }
  });
  broker.setAvailable(true);
  const first = broker.request(confirm("first"));
  broker.cancelSession(a);
  expect(await first).toMatchObject({ kind: "cancel" });
  expect(await lateA).toMatchObject({ kind: "cancel" });
  expect(broker.pending().map((request) => request.sessionId)).toEqual([
    b.sessionId,
  ]);
  broker.resolve({ ...confirm("startup-b", b), kind: "confirm", value: true });
  expect(await startupB).toMatchObject({ kind: "confirm", value: true });
});

test("a failed requestEnd sink cannot strand other native dialogs on disconnect", async () => {
  const broker = new UIRequestBroker((event) => {
    if (event.type === "requestEnd") throw new Error("lost view");
  });
  broker.setAvailable(true);
  const pending = [
    broker.request(confirm("a")),
    broker.request(confirm("b", b)),
  ];
  broker.setAvailable(false);
  expect(
    (await Promise.all(pending)).every((reply) => reply.kind === "cancel"),
  ).toBe(true);
  expect(broker.pending()).toEqual([]);
});
