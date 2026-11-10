import { afterEach, expect, test } from "bun:test";
import type { UIRequest } from "../shared/extension-ui";
import type { Snapshot } from "../shared/rpc-schema";
import { emptyTranscript } from "../shared/transcript";
import { addressKey } from "./chat-snapshot";
import { drafts, emptyContent } from "./draft-store";
import {
  ownedTerminalCommand,
  receiveExtension,
  receiveRuntime,
  receiveRuntimeState,
  receiveSnapshot,
  receiveTerminal,
  receiveWire,
  runtimeRevision,
  subscribeTerminal,
} from "./runtime-events";
import { useStore } from "./store";
import {
  addRequest,
  focusedRequest,
  uiKey,
  validReply,
} from "./ui-request-state";

const original = useStore.getState();
afterEach(() => useStore.setState(original, true));
function fixture() {
  const address = {
    hostId: "runtime",
    sessionId: crypto.randomUUID(),
    epoch: 1,
  };
  const snapshot: Snapshot = {
    address,
    snapshotSeq: 1,
    info: {
      id: address.sessionId,
      cwd: "/fixture",
      title: "Fixture",
      modified: 1,
    },
    transcript: emptyTranscript(),
    effort: "off",
    effortLevels: ["off"],
  };
  return { address, snapshot };
}
test("startup Trust and native/custom UI appear at root before any chat snapshot exists", () => {
  const { address } = fixture();
  receiveRuntime({ type: "opening", address, cwd: "/fixture", openId: "open" });
  const request: UIRequest = {
    ...address,
    uiId: "trust",
    title: "Project trust",
    kind: "project-trust",
    cwd: "/fixture",
    fingerprint: "fp",
    resources: [{ path: "AGENTS.md", kind: "instructions" }],
  };
  receiveExtension({ type: "request", request });
  expect(Object.keys(useStore.getState().snapshots)).toHaveLength(0);
  expect(useStore.getState().pendingUI).toEqual([request]);
  expect(
    validReply(request, {
      ...address,
      uiId: "trust",
      kind: "project-trust",
      value: "safe",
    }),
  ).toBe(true);
  receiveRuntime({ type: "closed", address, reason: "cancelled" });
  expect(useStore.getState().pendingUI).toHaveLength(0);
});
test("one waiting list prioritizes same-owner child without unrelated focus theft", () => {
  const { address } = fixture();
  const parent: UIRequest = {
    ...address,
    uiId: "p",
    title: "terminal",
    kind: "terminal",
  };
  const parallel: UIRequest = {
    ...address,
    sessionId: "different",
    uiId: "q",
    title: "parallel",
    kind: "confirm",
    message: "?",
  };
  const child: UIRequest = {
    ...address,
    uiId: "c",
    parentUiId: "p",
    title: "child",
    kind: "input",
  };
  const requests = addRequest(addRequest([parent], parallel), child);
  expect(focusedRequest(requests)?.uiId).toBe("c");
  expect(focusedRequest(requests, uiKey(parallel))?.uiId).toBe("q");
  expect(addRequest(requests, child)).toBe(requests);
  expect(validReply(child, { ...child, kind: "confirm", value: true })).toBe(
    false,
  );
  expect(
    validReply(
      {
        ...address,
        uiId: "s",
        kind: "select",
        title: "pick",
        options: ["allowed"],
      },
      { ...address, uiId: "s", kind: "select", value: "not allowed" },
    ),
  ).toBe(false);
});
test("subscriptions retain inactive draft, status and snapshots across all navigation pages", () => {
  const { address, snapshot } = fixture();
  receiveSnapshot(snapshot);
  useStore.setState({ active: "unrelated", page: "extensions" });
  receiveExtension({
    type: "draft",
    address,
    draft: { ...emptyContent(), text: "extension edit", revision: 1 },
  });
  receiveExtension({
    type: "status",
    address,
    status: {
      statuses: [{ key: "phase", text: "ready" }],
      widgets: [
        {
          key: "widget",
          placement: "aboveEditor",
          lines: ["literal <script>"],
        },
      ],
      title: "extension title",
    },
  });
  receiveWire({
    type: "snapshot",
    address,
    snapshotSeq: 4,
    transcript: { ...emptyTranscript(), running: true },
  });
  receiveSnapshot({ ...snapshot, snapshotSeq: 2 });
  expect(useStore.getState().page).toBe("extensions");
  expect(drafts.read(address).content.text).toBe("extension edit");
  expect(useStore.getState().extensionStatuses[addressKey(address)].title).toBe(
    "extension title",
  );
  expect(useStore.getState().snapshots[address.sessionId].snapshotSeq).toBe(4);
});
test("replaced remaps active tab/draft and rejects old epoch status, snapshots and terminal", () => {
  const { address, snapshot } = fixture();
  receiveSnapshot(snapshot);
  useStore.setState({ active: address.sessionId });
  drafts.edit(address, () => ({ ...emptyContent(), text: "unsynced" }));
  const next = { ...address, sessionId: `${address.sessionId}-fork`, epoch: 2 };
  receiveRuntime({
    type: "replaced",
    previous: address,
    snapshot: {
      ...snapshot,
      address: next,
      info: { ...snapshot.info, id: next.sessionId },
    },
  });
  receiveSnapshot({ ...snapshot, snapshotSeq: 999 });
  receiveExtension({
    type: "status",
    address,
    status: { statuses: [], widgets: [], title: "stale" },
  });
  expect(useStore.getState().active).toBe(next.sessionId);
  expect(useStore.getState().snapshots[address.sessionId]).toBeUndefined();
  expect(drafts.read(next).content.text).toBe("unsynced");
  expect(
    useStore.getState().extensionStatuses[addressKey(address)],
  ).toBeUndefined();
});
test("terminal boundary adds host owner even before ready snapshot and never uses active tab", () => {
  const { address } = fixture();
  const request: UIRequest = {
    ...address,
    uiId: "terminal",
    kind: "terminal",
    title: "TUI",
  };
  receiveExtension({ type: "request", request });
  useStore.setState({ active: "unrelated" });
  const events: string[] = [];
  const unsubscribe = subscribeTerminal((event) => {
    events.push(event.type);
  });
  receiveTerminal({
    type: "open",
    sessionId: address.sessionId,
    epoch: address.epoch,
    uiId: request.uiId,
  });
  expect(useStore.getState().terminals[uiKey(request)]).toBeDefined();
  const command = ownedTerminalCommand(request, {
    type: "ready",
    sessionId: request.sessionId,
    epoch: request.epoch,
    uiId: request.uiId,
    cols: 80,
    rows: 24,
  });
  expect(command.hostId).toBe(address.hostId);
  expect(command.sessionId).toBe(address.sessionId);
  receiveTerminal({
    type: "data",
    sessionId: address.sessionId,
    epoch: 0,
    uiId: request.uiId,
    seq: 1,
    data: "stale",
  });
  expect(events).toEqual(["open"]);
  unsubscribe();
  receiveRuntime({ type: "closed", address, reason: "close" });
  expect(() => ownedTerminalCommand(request, command)).toThrow("Stale");
});
test("failed startup retains readable history, while cancellation removes previews and rejects late replies", () => {
  const { address, snapshot } = fixture();
  receiveSnapshot({ ...snapshot, ready: false });
  receiveRuntime({
    type: "closed",
    address,
    reason: "failed",
    message: "Model unavailable",
  });
  expect(useStore.getState().snapshots[address.sessionId]).toMatchObject({
    ready: false,
    failure: "Model unavailable",
  });
  receiveSnapshot({ ...snapshot, snapshotSeq: 99 });
  expect(useStore.getState().snapshots[address.sessionId].ready).toBe(false);
  const cancelled = fixture();
  receiveSnapshot({ ...cancelled.snapshot, ready: false });
  receiveRuntime({
    type: "closed",
    address: cancelled.address,
    reason: "cancelled",
  });
  receiveSnapshot({ ...cancelled.snapshot, snapshotSeq: 99 });
  expect(
    useStore.getState().snapshots[cancelled.address.sessionId],
  ).toBeUndefined();
});

test("reconnect response racing newer root events cannot restore ended requests", () => {
  const { address } = fixture();
  const before = runtimeRevision;
  receiveRuntime({ type: "opening", address, cwd: "/fixture" });
  const applied = receiveRuntimeState(
    {
      hostId: address.hostId,
      sessions: [],
      drafts: [],
      statuses: [],
      pendingUI: [
        { ...address, uiId: "late", kind: "terminal", title: "stale" },
      ],
    },
    before,
  );
  expect(applied).toBe(false);
  expect(useStore.getState().pendingUI).toHaveLength(0);
});

test.each([
  "close",
  "cancelled",
  "failed",
] as const)("runtime %s only notifies an actual failure, not an intentional close/cancel", (reason) => {
  const { address } = fixture();
  useStore.setState({ notices: [], noticeHistory: [] });
  receiveRuntime({ type: "opening", address, cwd: "/fixture" });
  receiveRuntime({ type: "closed", address, reason, message: "Session ended" });
  expect(useStore.getState().notices).toHaveLength(reason === "failed" ? 1 : 0);
  expect(useStore.getState().noticeHistory).toHaveLength(
    reason === "failed" ? 1 : 0,
  );
});
