import { expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ja } from "../shared/i18n";
import { useStore } from "./store";

// Keep the real list, menu and confirmation button; only the desktop bridge is absent in SSR.
mock.module("./rpc", () => ({
  rpc: { send: {}, request: {} },
  openChat: async () => {},
  refreshSessions: async () => {},
  openChatLink: async () => {},
  regenerate: async () => {},
}));
const { SessionList } = await import("./SessionList");

function render(opening = false, running = false) {
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
