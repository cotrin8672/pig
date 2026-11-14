import { expect, test } from "bun:test";
import { fauxAssistantMessage } from "@earendil-works/pi-ai";
import { shallow } from "zustand/shallow";
import type { UIRequest } from "../shared/extension-ui";
import type { Snapshot } from "../shared/rpc-schema";
import { emptyTranscript, hydrate } from "../shared/transcript";
import { addressKey } from "./chat-snapshot";
import { navigate, navigationRevision } from "./navigation";
import { receiveExtension, receiveRuntime } from "./runtime-events";
import { useStore } from "./store";
import {
  selectAppView,
  selectBrokerView,
  selectConversationView,
  selectPaneHeading,
  selectProjectActivity,
  selectRequestPreviews,
  selectSessionStatus,
} from "./ui-selectors";

function snapshot(id: string, cwd = "project"): Snapshot {
  return {
    address: { hostId: "selectors", sessionId: id, epoch: 2 },
    snapshotSeq: 1,
    info: { id, cwd, title: id, modified: 1 },
    effort: "off",
    effortLevels: [],
    transcript: emptyTranscript(),
  };
}
function fixture() {
  const a = snapshot("a");
  const b = snapshot("b");
  return {
    ...useStore.getInitialState(),
    hostId: "selectors",
    active: "a",
    snapshots: { a, b },
    addresses: { a: a.address, b: b.address },
    sessions: { project: [a.info, b.info] },
  };
}
function request(): UIRequest {
  return {
    ...snapshot("b").address,
    uiId: "confirm",
    kind: "confirm",
    title: "Allow?",
    message: "Continue?",
  };
}

test("pane headings use their own metadata and ignore streaming bodies and focus", () => {
  const state = {
    ...fixture(),
    panes: { 1: { sessionId: "a" }, 2: { sessionId: "b" } },
  };
  const a = selectPaneHeading(state, 1);
  expect(a).toEqual({ project: "project", general: false, title: "a" });
  state.snapshots.b = { ...state.snapshots.b, snapshotSeq: 9 };
  state.activePane = 2;
  state.snapshots.a = { ...state.snapshots.a, snapshotSeq: 5 };
  expect(shallow(selectPaneHeading(state, 1), a)).toBe(true);
  state.snapshots.b.info = { ...state.snapshots.b.info, title: "Renamed b" };
  expect(selectPaneHeading(state, 2).title).toBe("Renamed b");
  expect(shallow(selectPaneHeading(state, 1), a)).toBe(true);
  state.bootstrap.desktop = {
    projects: { project: { name: "Custom project" } },
    sessions: {},
  };
  expect(selectPaneHeading(state, 1).project).toBe("Custom project");
  state.extensionStatuses = {
    [addressKey(state.snapshots.b.address)]: {
      title: "Extension b",
      statuses: [],
      widgets: [],
    },
  };
  expect(selectPaneHeading(state, 2).title).toBe("Extension b");
  state.extensionStatuses = {};
  expect(selectPaneHeading(state, 2).title).toBe("Renamed b");
});

test("pane headings show local projects and listed titles before a snapshot exists", () => {
  const state = {
    ...fixture(),
    panes: { 1: { openId: "local" }, 2: { openId: "existing" } },
    pendingOpens: {
      local: { cwd: "C:\\work\\local", draftId: "draft", deferred: true },
      existing: { cwd: "project", id: "b" },
    },
    snapshots: {},
  };
  expect(selectPaneHeading(state, 1)).toEqual({
    project: "local",
    general: false,
    title: undefined,
  });
  expect(selectPaneHeading(state, 2).title).toBe("b");
  state.bootstrap.generalCwd = "C:\\work\\local";
  expect(selectPaneHeading(state, 1).general).toBe(true);
});

test("theme previews do not invalidate the app/conversation; opacity still updates the shell", () => {
  const state = fixture();
  const app = selectAppView(state);
  const broker = selectBrokerView(state);
  for (const themeColor of ["#ff0000", "#000000", "#ffffff", "#7dbfbd"]) {
    state.appearance = { ...state.appearance, themeColor };
    expect(shallow(selectAppView(state), app)).toBe(true);
    expect(shallow(selectBrokerView(state), broker)).toBe(true);
  }
  state.appearance = {
    ...state.appearance,
    opacity: { ...state.appearance.opacity, [state.appearance.backdrop]: 0.5 },
  };
  expect(selectAppView(state).windowOpacity).toBe(0.5);
  expect(shallow(selectAppView(state), app)).toBe(false);
});

test("100 background tokens leave the app, broker, project and footer ownership selections unchanged", () => {
  const state = fixture();
  const app = selectAppView(state);
  const broker = selectBrokerView(state);
  const previews = selectRequestPreviews(state);
  const footerAddress = state.snapshots.b.address;
  const activity = selectProjectActivity(state, "project");
  state.snapshots.b = {
    ...state.snapshots.b,
    transcript: { ...emptyTranscript(), running: true },
  };
  const running = selectProjectActivity(state, "project");
  expect(shallow(activity, running)).toBe(false);
  for (let token = 0; token < 100; token++) {
    state.snapshots = {
      ...state.snapshots,
      b: {
        ...state.snapshots.b,
        address: { ...state.snapshots.b.address },
        snapshotSeq: token + 2,
        transcript: {
          ...hydrate([fauxAssistantMessage(String(token))]),
          running: true,
        },
      },
    };
    expect(shallow(selectAppView(state), app)).toBe(true);
    expect(shallow(selectBrokerView(state), broker)).toBe(true);
    expect(shallow(selectRequestPreviews(state), previews)).toBe(true);
    expect(shallow(state.snapshots.b.address, footerAddress)).toBe(true);
    expect(shallow(selectProjectActivity(state, "project"), running)).toBe(
      true,
    );
  }
  state.page = "settings";
  const settings = selectAppView(state);
  state.snapshots.a = { ...state.snapshots.a, snapshotSeq: 20 };
  expect(shallow(selectAppView(state), settings)).toBe(true);
});

test("100 active tokens update the conversation without invalidating the app shell", () => {
  const state = fixture();
  const app = selectAppView(state);
  let conversation = selectConversationView(state);
  for (let token = 0; token < 100; token++) {
    state.snapshots = {
      ...state.snapshots,
      a: {
        ...state.snapshots.a,
        info: { ...state.snapshots.a.info },
        address: { ...state.snapshots.a.address },
        snapshotSeq: token + 2,
        transcript: {
          ...hydrate([fauxAssistantMessage(String(token))]),
          running: true,
        },
      },
    };
    expect(shallow(selectAppView(state), app)).toBe(true);
    const next = selectConversationView(state);
    expect(shallow(next, conversation)).toBe(false);
    expect(next.activeSnapshot).toBe(state.snapshots.a);
    conversation = next;
  }
  state.snapshots.a = {
    ...state.snapshots.a,
    address: { ...state.snapshots.a.address, epoch: 3 },
    ready: false,
  };
  expect(shallow(selectAppView(state), app)).toBe(true);
  expect(selectConversationView(state).activeSnapshot?.address.epoch).toBe(3);
  expect(selectConversationView(state).activeSnapshot?.ready).toBe(false);
});

test("shell title and cwd still reflect metadata, extension title removal and active navigation", () => {
  const state = { ...fixture(), initialized: true };
  expect(selectAppView(state)).toMatchObject({
    showChatHeader: true,
    chatTitle: "a",
    chatCwd: "project",
  });
  state.snapshots.a.info = {
    ...state.snapshots.a.info,
    title: "Renamed",
    cwd: "moved",
  };
  expect(selectAppView(state)).toMatchObject({
    chatTitle: "Renamed",
    chatCwd: "moved",
  });
  state.extensionStatuses = {
    [addressKey(state.snapshots.a.address)]: {
      title: "Extension title",
      statuses: [],
      widgets: [],
    },
  };
  expect(selectAppView(state).chatTitle).toBe("Extension title");
  state.extensionStatuses = {
    [addressKey(state.snapshots.a.address)]: {
      title: "",
      statuses: [],
      widgets: [],
    },
  };
  expect(selectAppView(state).chatTitle).toBe("");
  state.extensionStatuses = {};
  expect(selectAppView(state).chatTitle).toBe("Renamed");
  state.active = "b";
  expect(selectAppView(state).chatTitle).toBe("b");
  state.page = "settings";
  expect(selectAppView(state).showChatHeader).toBe(false);
});

test("opening shell uses listed metadata, then preview metadata, without subscribing to preview tokens", () => {
  const state = {
    ...fixture(),
    initialized: true,
    opening: true,
    openingViewRevision: navigationRevision,
    openingTarget: { cwd: "project", id: "not-loaded" },
  };
  state.sessions.project.push({
    id: "not-loaded",
    cwd: "project",
    title: "Listed title",
    modified: 1,
  });
  expect(selectAppView(state)).toMatchObject({
    showChatHeader: true,
    chatTitle: "Listed title",
    chatCwd: "project",
    openingExistingChat: true,
  });
  expect(selectConversationView(state).openingSnapshot).toBeUndefined();
  state.openingTarget = { cwd: "project", id: "b" };
  state.snapshots.b = { ...state.snapshots.b, ready: false };
  const app = selectAppView(state);
  expect(app.chatTitle).toBe("b");
  state.snapshots.b = {
    ...state.snapshots.b,
    snapshotSeq: 2,
    transcript: hydrate([fauxAssistantMessage("preview")]),
  };
  expect(shallow(selectAppView(state), app)).toBe(true);
  expect(selectConversationView(state).openingSnapshot).toBe(state.snapshots.b);
  state.snapshots.b.info = {
    ...state.snapshots.b.info,
    title: "Preview title",
  };
  expect(selectAppView(state).chatTitle).toBe("Preview title");
});

test("project and row share waiting priority, count each session once, and reject old owners", () => {
  const state = fixture();
  state.snapshots.b.transcript.running = true;
  state.pendingUI = [request(), { ...request(), uiId: "child" }];
  expect(selectSessionStatus(state, "b")).toBe("waiting");
  expect(selectProjectActivity(state, "project")).toEqual([
    undefined,
    false,
    "waiting",
    false,
  ]);
  state.pendingUI = [{ ...request(), epoch: 1 }];
  expect(selectSessionStatus(state, "b")).toBe("running");
  state.pendingUI = [{ ...request(), hostId: "old-host" }];
  expect(selectSessionStatus(state, "b")).toBe("running");
  state.pendingUI = [];
  state.snapshots.b.transcript.running = false;
  state.bootstrap = {
    ...state.bootstrap,
    desktop: {
      sessions: {
        b: { completion: { id: "done", outcome: "error" } },
      },
    },
  };
  expect(selectProjectActivity(state, "project")).toEqual([
    undefined,
    false,
    "failed",
    true,
  ]);
  state.bootstrap.desktop.sessions.b.archived = true;
  expect(selectProjectActivity(state, "project")).toEqual([undefined, false]);
});

test("snapshot failures turn row and project red before completion and after read, then clear on restart", () => {
  const state = fixture();
  state.snapshots.b.transcript.running = true;
  expect(selectSessionStatus(state, "b")).toBe("running");
  state.snapshots.b.failure = "WebSocket closed 1012";
  expect(selectSessionStatus(state, "b")).toBe("failed");
  expect(selectProjectActivity(state, "project")).toEqual([
    undefined,
    false,
    "failed",
    false,
  ]);
  state.snapshots.b.transcript.running = false;
  state.bootstrap = {
    ...state.bootstrap,
    desktop: {
      sessions: {
        b: {
          completion: { id: "failed", outcome: "error" },
          readCompletionId: "failed",
        },
      },
    },
  };
  expect(selectSessionStatus(state, "b")).toBe("failed");
  state.pendingUI = [request()];
  expect(selectSessionStatus(state, "b")).toBe("waiting");
  state.pendingUI = [];
  state.snapshots.b.failure = undefined;
  state.snapshots.b.transcript.running = true;
  expect(selectSessionStatus(state, "b")).toBe("running");
  state.snapshots.b.transcript.running = false;
  // Until a later success is recorded, reading alone never clears a failure.
  expect(selectSessionStatus(state, "b")).toBe("failed");
  Reflect.deleteProperty(state.snapshots, "b");
  expect(selectSessionStatus(state, "b")).toBe("failed");
  expect(selectProjectActivity(state, "project")).toEqual([
    undefined,
    false,
    "failed",
    false,
  ]);
  state.bootstrap.desktop.sessions.b.completion = {
    id: "ok",
    outcome: "success",
  };
  state.bootstrap.desktop.sessions.b.readCompletionId = "ok";
  expect(selectSessionStatus(state, "b")).toBeUndefined();
});

test("broker readiness changes when a startup preview becomes live, but not for its tokens", () => {
  const state = fixture();
  state.pendingUI = [request()];
  state.snapshots.b.ready = false;
  const previews = selectRequestPreviews(state);
  state.snapshots.b = { ...state.snapshots.b, snapshotSeq: 2 };
  expect(shallow(selectRequestPreviews(state), previews)).toBe(true);
  delete state.snapshots.b.ready;
  expect(selectRequestPreviews(state)).toEqual({});
  expect(shallow(selectRequestPreviews(state), previews)).toBe(false);
  state.pendingUI = [];
  expect(selectBrokerView(state).pendingUI).toEqual([]);
});

test("same-chat navigation still releases a selected prompt and the opening view", () => {
  const previous = useStore.getState();
  const history = globalThis.history;
  Object.assign(globalThis, {
    history: { state: { page: "chat", sessionKey: "a" } },
  });
  useStore.setState({
    ...fixture(),
    opening: true,
    openingTarget: { cwd: "project", id: "b" },
    openingViewRevision: navigationRevision,
  });
  try {
    const broker = selectBrokerView(useStore.getState());
    expect(
      selectConversationView(useStore.getState()).openingSnapshot?.info.id,
    ).toBe("b");
    navigate("chat", "a");
    expect(shallow(selectBrokerView(useStore.getState()), broker)).toBe(false);
    expect(selectConversationView(useStore.getState()).openingView).toBe(false);
    expect(
      selectConversationView(useStore.getState()).activeSnapshot?.info.id,
    ).toBe("a");
  } finally {
    useStore.setState(previous, true);
    Object.assign(globalThis, { history });
  }
});

test.each([
  "done",
  "cancelled",
  "timeout",
  "failed",
] as const)("project wait ends immediately on request %s", (reason) => {
  const previous = useStore.getState();
  const session = snapshot(`wait-${reason}`);
  useStore.setState({
    ...fixture(),
    snapshots: { [session.info.id]: session },
    addresses: { [session.info.id]: session.address },
    sessions: { project: [session.info] },
  });
  try {
    const pending = { ...request(), ...session.address };
    receiveExtension({ type: "request", request: pending });
    receiveExtension({ type: "request", request: pending });
    expect(selectProjectActivity(useStore.getState(), "project")).toEqual([
      "waiting",
      false,
    ]);
    expect(useStore.getState().pendingUI).toHaveLength(1);
    receiveExtension({ type: "requestEnd", address: pending, reason });
    expect(selectProjectActivity(useStore.getState(), "project")).toEqual([
      undefined,
      false,
    ]);
  } finally {
    useStore.setState(previous, true);
  }
});

test("replacement drops old-epoch waits and accepts the new owner's requests", () => {
  const previous = useStore.getState();
  const session = snapshot("wait-replace");
  useStore.setState({
    ...fixture(),
    snapshots: { [session.info.id]: session },
    addresses: { [session.info.id]: session.address },
    sessions: { project: [session.info] },
  });
  try {
    receiveExtension({
      type: "request",
      request: { ...request(), ...session.address },
    });
    const next = { ...session, address: { ...session.address, epoch: 3 } };
    receiveRuntime({
      type: "replaced",
      previous: session.address,
      snapshot: next,
    });
    expect(selectProjectActivity(useStore.getState(), "project")).toEqual([
      undefined,
      false,
    ]);
    receiveExtension({
      type: "request",
      request: { ...request(), ...next.address },
    });
    expect(selectProjectActivity(useStore.getState(), "project")).toEqual([
      "waiting",
      false,
    ]);
  } finally {
    useStore.setState(previous, true);
  }
});

// Structural notification regression, not a wall-time benchmark. Allow the
// synthetic workload to share CI CPUs with the browser and SDK integration tests.
test("20 projects with 500 sessions do not publish changed activity for 100 token updates", () => {
  const state = fixture();
  const projects = Array.from({ length: 20 }, (_, i) => `project-${i}`);
  const sessions = Object.fromEntries(
    projects.map((cwd) => [
      cwd,
      Array.from({ length: 500 }, (_, i) => snapshot(`${cwd}-${i}`, cwd).info),
    ]),
  );
  const background = snapshot("project-0-0", projects[0]);
  background.transcript.running = true;
  const large: ReturnType<typeof useStore.getState> = {
    ...state,
    sessions,
    snapshots: { ...state.snapshots, [background.info.id]: background },
  };
  const before = projects.map((cwd) => selectProjectActivity(large, cwd));
  let changed = 0;
  for (let token = 0; token < 100; token++) {
    large.snapshots = {
      ...large.snapshots,
      [background.info.id]: {
        ...large.snapshots[background.info.id],
        snapshotSeq: token + 2,
      },
    };
    projects.forEach((cwd, i) => {
      if (!shallow(before[i], selectProjectActivity(large, cwd))) changed++;
    });
  }
  expect(changed).toBe(0);
}, 30_000);
