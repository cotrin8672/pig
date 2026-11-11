import { expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ja } from "../shared/i18n";
import { useStore } from "./store";

// Keep the real list, menu and confirmation button; only the desktop bridge is absent in SSR.
mock.module("./rpc", () => ({
  rpc: { send: {}, request: {} },
  openChat: async () => {},
  refreshSessions: async () => {},
  refresh: async () => {},
  openChatLink: async () => {},
  regenerate: async () => {},
}));
const { SessionList } = await import("./SessionList");
const { SidebarSessions } = await import("./SidebarSessions");

function render(opening = false, running = false, otherOpening = false) {
  const state = useStore.getInitialState();
  const previous = { ...state, active: state.active };
  const session = {
    id: "test-session",
    cwd: "test-project",
    title: "Chat",
    modified: 1,
  };
  Object.assign(state, {
    settings: { ...state.settings, language: "ja" },
    bootstrap: { ...state.bootstrap, desktop: { sessions: {} } },
    sessions: { [session.cwd]: [session] },
    snapshots: {},
    pendingUI: [],
    active: session.id,
    opening,
    modelPending: running,
    pendingOpens: otherOpening
      ? { other: { cwd: "test-project", id: "other-chat" } }
      : {},
  });
  try {
    return renderToStaticMarkup(<SessionList cwd={session.cwd} />);
  } finally {
    Object.assign(state, previous);
  }
}

function deleteButton(html: string) {
  const tag = html.match(
    /<button\b[^>]*class="confirm-button session-menu-delete "[^>]*>/,
  )?.[0];
  expect(tag).toBeDefined();
  return tag ?? "";
}

test("session deletion uses the shared two-press button, not a delete dialog", () => {
  const html = render();
  expect(deleteButton(html)).not.toContain("disabled");
  expect(deleteButton(html)).toContain("aria-description=");
  expect(html).toContain(
    ja["This permanently deletes this chat’s local history."],
  );
  expect(html).toContain(
    'class="confirm-armed" aria-hidden="true">確定</span>',
  );
  expect(html).not.toContain("✓");
  expect(html).toMatch(/<h2[^>]*>チャット名を変更<\/h2>/);
  expect(html).not.toContain("チャットを削除</h2>");
});

test("deletion stays disabled while a session is running or opening", () => {
  expect(deleteButton(render(false, true))).toContain('disabled=""');
  expect(deleteButton(render(true, false))).toContain('disabled=""');
});

test("chat selection stays enabled during startup and another chat's startup does not lock actions", () => {
  const starting = render(true);
  expect(starting.match(/<button[^>]*class="thread"[^>]*>/)?.[0]).not.toContain(
    "disabled",
  );
  expect(deleteButton(render(false, false, true))).not.toContain("disabled");
});

test("collapsed lists mount no rows, while project headings expose a background wait", () => {
  const state = useStore.getInitialState();
  const previous = { ...state };
  const session = {
    id: "waiting",
    cwd: "project",
    title: "Background",
    modified: 1,
  };
  Object.assign(state, {
    settings: { ...state.settings, language: "ja" },
    bootstrap: {
      ...state.bootstrap,
      projects: [session.cwd],
      generalCwd: "",
      desktop: { sessions: {} },
    },
    sessions: { [session.cwd]: [session] },
    snapshots: {},
    pendingUI: [
      {
        hostId: "waiting",
        sessionId: session.id,
        epoch: 1,
        uiId: "approval",
        kind: "confirm",
        title: "Continue?",
        message: "Continue?",
      },
    ],
  });
  try {
    expect(
      renderToStaticMarkup(<SessionList cwd={session.cwd} expanded={false} />),
    ).toBe("");
    const html = renderToStaticMarkup(<SidebarSessions />);
    expect(html).toContain(`aria-label="${ja["Waiting for your answer"]}: 1"`);
    expect(html).toContain('class="session-dot waiting"');
  } finally {
    Object.assign(state, previous);
  }
});
