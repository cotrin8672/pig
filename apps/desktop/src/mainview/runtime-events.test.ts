import { afterEach, expect, test } from "bun:test";
import type { UIRequest } from "../shared/extension-ui";
import type { Snapshot } from "../shared/rpc-schema";
import { emptyTranscript } from "../shared/transcript";
import { addressKey } from "./chat-snapshot";
import { drafts, emptyContent } from "./draft-store";
import {
  receiveExtension,
  receiveRuntime,
  receiveRuntimeState,
  receiveSnapshot,
  receiveWire,
  runtimeRevision,
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
test("startup Trust and native UI appear at root before any chat snapshot exists", () => {
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
    title: "parent",
    kind: "confirm",
    message: "Continue?",
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
test("replaced remaps active tab/draft and rejects old epoch status, snapshots and requests", () => {
  const { address, snapshot } = fixture();
  receiveSnapshot(snapshot);
  useStore.setState({ active: address.sessionId });
  drafts.edit(address, () => ({ ...emptyContent(), text: "unsynced" }));
  const request: UIRequest = {
    ...address,
    uiId: "native",
    kind: "input",
    title: "Input",
  };
  receiveExtension({ type: "request", request });
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
  receiveExtension({ type: "request", request });
  expect(useStore.getState().pendingUI).toHaveLength(0);
  expect(useStore.getState().active).toBe(next.sessionId);
  expect(useStore.getState().snapshots[address.sessionId]).toBeUndefined();
  expect(drafts.read(next).content.text).toBe("unsynced");
  expect(
    useStore.getState().extensionStatuses[addressKey(address)],
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
      pendingUI: [{ ...address, uiId: "late", kind: "input", title: "stale" }],
    },
    before,
  );
  expect(applied).toBe(false);
  expect(useStore.getState().pendingUI).toHaveLength(0);
});

test("reconnect replays every native pending request and drops ended requests without navigation or revision rollback", () => {
  const { address, snapshot } = fixture();
  receiveSnapshot(snapshot);
  useStore.setState({ page: "settings", active: "unrelated" });
  drafts.receive(address, { ...emptyContent(), text: "newer", revision: 4 });
  const pendingUI: UIRequest[] = [
    {
      ...address,
      uiId: "confirm",
      kind: "confirm",
      title: "Confirm",
      message: "?",
    },
    { ...address, uiId: "input", kind: "input", title: "Input" },
    { ...address, uiId: "editor", kind: "editor", title: "Editor" },
    {
      ...address,
      uiId: "select",
      kind: "select",
      title: "Select",
      options: ["ok"],
    },
    {
      ...address,
      uiId: "trust",
      kind: "project-trust",
      title: "Trust",
      cwd: "/fixture",
      fingerprint: "fp",
      resources: [],
    },
  ];
  receiveExtension({ type: "request", request: pendingUI[0] });
  receiveExtension({
    type: "request",
    request: { ...address, uiId: "ended", kind: "input", title: "Ended" },
  });
  expect(
    receiveRuntimeState(
      {
        hostId: address.hostId,
        sessions: [{ address, phase: "ready", snapshot }],
        drafts: [
          { address, draft: { ...emptyContent(), text: "older", revision: 2 } },
        ],
        statuses: [],
        pendingUI,
      },
      runtimeRevision,
    ),
  ).toBe(true);
  expect(useStore.getState().pendingUI).toEqual(pendingUI);
  expect(focusedRequest(useStore.getState().pendingUI)?.uiId).toBe("confirm");
  expect(useStore.getState().page).toBe("settings");
  expect(useStore.getState().active).toBe("unrelated");
  expect(drafts.read(address).content.text).toBe("newer");
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
