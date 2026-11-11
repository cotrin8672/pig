import { expect, test } from "bun:test";
import { fauxAssistantMessage } from "@earendil-works/pi-ai";
import { shallow } from "zustand/shallow";
import type { UIRequest } from "../shared/extension-ui";
import type { Snapshot } from "../shared/rpc-schema";
import { emptyTranscript, hydrate } from "../shared/transcript";
import { navigate, navigationRevision } from "./navigation";
import { receiveExtension, receiveRuntime } from "./runtime-events";
import { useStore } from "./store";
import {
  selectAppView,
  selectBrokerView,
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
    expect(selectAppView(useStore.getState()).openingSnapshot?.info.id).toBe(
      "b",
    );
    navigate("chat", "a");
    expect(shallow(selectBrokerView(useStore.getState()), broker)).toBe(false);
    expect(selectAppView(useStore.getState()).openingView).toBe(false);
    expect(selectAppView(useStore.getState()).activeSnapshot?.info.id).toBe(
      "a",
    );
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
});
