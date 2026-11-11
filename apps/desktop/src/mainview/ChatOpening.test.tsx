import { expect, mock, test } from "bun:test";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import type { Snapshot } from "../shared/rpc-schema";
import { emptyTranscript } from "../shared/transcript";
import { drafts } from "./draft-store";
import { useStore } from "./store";

if (process.env.PIG_CHAT_OPENING_CHILD !== "1") {
  test("loading chat components in an isolated process", async () => {
    const child = Bun.spawn(
      [process.execPath, "test", fileURLToPath(import.meta.url)],
      {
        env: { ...process.env, PIG_CHAT_OPENING_CHILD: "1" },
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    const [code, out, error] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    expect(code, out + error).toBe(0);
  });
} else {
  mock.module("./rpc", () => ({
    rpc: { send: {}, request: {} },
    cancelOpening: async () => {},
    updateUiPreferences: () => {},
    updateAppearance: () => {},
    updateSettings: () => {},
    sends: { subscribe: () => () => {}, read: () => undefined },
    openChat: async () => {},
    openChatLink: async () => {},
    forkChat: async () => {},
    regenerate: async () => {},
    refresh: async () => {},
    refreshSessions: async () => {},
    initRuntimeConnection: () => {},
    initSessionLinks: () => {},
    initSessionReadTracking: () => {},
  }));
  mock.module("./DraftRecovery", () => ({ DraftRecovery: () => null }));
  mock.module("./Composer", () => ({ Composer: () => null }));
  const { ChatOpening } = await import("./ChatOpening");
  const { ChatHeader } = await import("./ChatHeader");
  const { WindowTitlebar } = await import("./WindowTitlebar");
  const snapshot: Snapshot = {
    address: { hostId: "opening-test", sessionId: "existing", epoch: 1 },
    snapshotSeq: 1,
    info: {
      id: "existing",
      cwd: "project",
      title: "Existing chat",
      modified: 1,
    },
    model: { provider: "test", id: "model", name: "Current model" },
    effort: "high",
    effortLevels: ["low", "high"],
    transcript: emptyTranscript(),
  };
  function render(existing: boolean, openMessage?: string) {
    const state = useStore.getInitialState();
    const previous = { ...state };
    Object.assign(state, {
      openMessage,
      openingTarget: {
        cwd: "project",
        id: existing ? "existing" : undefined,
        selection: snapshot,
      },
      snapshots: { existing: snapshot },
      newChatDrafts: { project: "New draft" },
      bootstrap: {
        ...state.bootstrap,
        models: [snapshot.model],
        desktop: { ...state.bootstrap.desktop, chatWidth: 900 },
      },
    });
    try {
      return renderToStaticMarkup(<ChatOpening />);
    } finally {
      Object.assign(state, previous);
    }
  }

  test("new and existing loading chats use the real chat shell, editor, width and model picker", () => {
    for (const existing of [false, true]) {
      const html = render(existing);
      for (const text of [
        'class="session-layout"',
        'class="chat-shell"',
        "--chat-width:900px",
        'class="composer-dock"',
        'class="composer"',
        'class="picker model-picker"',
        "Current model",
        'aria-busy="true"',
      ])
        expect(html).toContain(text);
      expect(html).not.toContain("chat-opening-composer");
      expect(html).not.toContain("chat-opening-heading");
      expect(html.match(/<textarea\b/g)).toHaveLength(1);
      expect(html).toMatch(/<button[^>]*type="submit"[^>]*disabled=""/);
    }
  });

  test("chat headings render in the titlebar without width or close buttons", () => {
    const state = useStore.getInitialState();
    const previous = { ...state };
    Object.assign(state, {
      bootstrap: { ...state.bootstrap, generalCwd: "general" },
    });
    try {
      for (const [cwd, project] of [
        ["C:\\work\\pig", "pig"],
        ["/work/another-project", "another-project"],
        ["general", "Chats"],
      ]) {
        const html = renderToStaticMarkup(
          <WindowTitlebar maximized={false} onAction={() => {}}>
            <ChatHeader cwd={cwd} title="Session <title>" />
          </WindowTitlebar>,
        );
        expect(html).toContain('data-expanded="false"');
        expect(html.indexOf('class="window-titlebar-drag')).toBeLessThan(
          html.indexOf('class="chat-header"'),
        );
        expect(html).toContain(`<span title="${project}">${project}</span>`);
        expect(html).toContain("Session &lt;title&gt;");
        expect(html).not.toContain("chat-header-actions");
        expect(html).not.toContain('aria-label="Reset chat width"');
        expect(html).not.toContain('aria-label="Close chat (history is kept)"');
        expect(html.match(/<button\b/g)).toHaveLength(3);
        for (const action of ["Minimize", "Maximize", "Close window"])
          expect(html).toContain(`aria-label="${action}"`);
      }
    } finally {
      Object.assign(state, previous);
    }
  });

  test("the titlebar follows active chats, startup targets, and page navigation", async () => {
    const { App } = await import("./App");
    const { navigationRevision } = await import("./navigation");
    const state = useStore.getInitialState();
    const previous = {
      ...state,
      active: state.active,
      openingAddress: state.openingAddress,
      openingTarget: state.openingTarget,
      openingViewRevision: state.openingViewRevision,
    };
    Object.assign(state, {
      page: "chat",
      active: "existing",
      opening: false,
      snapshots: { existing: { ...snapshot, ready: false } },
      extensionStatuses: {},
      bootstrap: { ...state.bootstrap, generalCwd: "general" },
    });
    try {
      const { addressKey } = await import("./chat-snapshot");
      state.extensionStatuses = {
        [addressKey(snapshot.address)]: {
          title: "Live session title",
          statuses: [],
          widgets: [],
        },
      };
      const active = renderToStaticMarkup(<App />);
      const main = active.split("<main>")[1].split("</main>")[0];
      expect(main).not.toContain('class="chat-header"');
      expect(main).not.toContain("Live session title");
      const bar = active.slice(active.indexOf('class="window-titlebar"'));
      expect(bar).toContain('class="chat-header"');
      expect(bar).toContain("Live session title");
      expect(bar).not.toContain("chat-header-actions");

      state.opening = true;
      state.openingViewRevision = navigationRevision;
      state.openingTarget = { cwd: "/work/new-project" };
      const fresh = renderToStaticMarkup(<App />);
      const freshBar = fresh.slice(fresh.indexOf('class="window-titlebar"'));
      expect(freshBar).toContain("new-project");
      expect(freshBar).toContain("New chat");
      expect(freshBar).not.toContain("Live session title");
      expect(freshBar).not.toContain("chat-header-actions");

      state.openingTarget = { cwd: "project", id: "existing" };
      state.openingAddress = snapshot.address;
      const preview = renderToStaticMarkup(<App />);
      const previewBar = preview.slice(
        preview.indexOf('class="window-titlebar"'),
      );
      expect(previewBar).toContain("Live session title");
      expect(previewBar).not.toContain("chat-header-actions");

      state.page = "settings";
      expect(renderToStaticMarkup(<App />)).not.toContain(
        'class="chat-header"',
      );
    } finally {
      Object.assign(state, previous);
    }
  });

  test("connection and recovery messages remain visible outside the composer", () => {
    const html = render(true, "Connection unavailable — checking state.");
    expect(html).toContain(
      '<p class="muted" role="status">Connection unavailable — checking state.</p>',
    );
  });

  test("new loading chats retain typed text; existing loading chats never borrow another chat's draft", () => {
    drafts.edit(snapshot.address, (content) => ({
      ...content,
      text: "Existing draft",
    }));
    const fresh = render(false);
    expect(fresh).toContain("New draft</textarea>");
    expect(fresh).not.toContain("readOnly");
    const existing = render(true);
    expect(existing).toContain("Existing draft</textarea>");
    expect(existing).not.toContain("New draft");
    expect(existing).not.toContain('readOnly=""');
    expect(existing).not.toContain('class="chat-opening-content"');
  });

  test("a failed retired preview remains readable without allowing draft edits", async () => {
    const { OpeningComposer } = await import("./ChatOpening");
    const preview: Snapshot = {
      ...snapshot,
      ready: false,
      address: { ...snapshot.address, epoch: 99 },
      failure: "Startup failed",
    };
    drafts.retire(preview.address);
    const html = renderToStaticMarkup(<OpeningComposer preview={preview} />);
    expect(html).toContain('readOnly=""');
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*disabled=""/);
  });

  test("startup approval is non-modal and a background request stays accessible without blocking navigation", async () => {
    const { UIRequestBroker } = await import("./UIRequestBroker");
    const state = useStore.getInitialState();
    const previous = { ...state };
    const request = {
      ...snapshot.address,
      uiId: "startup",
      kind: "confirm" as const,
      title: "Startup approval",
      message: "Allow?",
    };
    Object.assign(state, {
      page: "chat",
      active: snapshot.info.id,
      openingAddress: undefined,
      snapshots: { existing: { ...snapshot, ready: false } },
      pendingUI: [request],
    });
    try {
      const foreground = renderToStaticMarkup(<UIRequestBroker />);
      expect(foreground).toContain('aria-modal="false"');
      expect(foreground).not.toContain("ui-waiting-floating");
      state.active = "another-chat";
      const background = renderToStaticMarkup(<UIRequestBroker />);
      expect(background).toContain("ui-waiting-floating");
      expect(state.pendingUI).toEqual([request]);
    } finally {
      Object.assign(state, previous);
    }
  });

  test("the real app shows history during startup, without a skeleton or runtime actions", async () => {
    const { App } = await import("./App");
    const { navigationRevision } = await import("./navigation");
    const state = useStore.getInitialState();
    const previous = { ...state };
    const preview: Snapshot = {
      ...snapshot,
      ready: false,
      transcript: {
        ...emptyTranscript(),
        history: { revision: "branch", before: "older" },
        records: [
          {
            id: "prompt",
            entryId: "prompt",
            parentId: null,
            branchId: "branch",
            order: 50,
            kind: "message",
            message: {
              role: "user",
              content: "History is readable before the model is ready",
              timestamp: 1,
            },
          },
        ],
      },
    };
    Object.assign(state, {
      page: "chat",
      active: "existing",
      opening: true,
      openingViewRevision: navigationRevision,
      openingAddress: snapshot.address,
      openingTarget: { cwd: "project", id: "existing" },
      snapshots: { existing: preview },
      bootstrap: {
        ...state.bootstrap,
        generalCwd: "general",
        projects: ["project"],
      },
    });
    try {
      const html = renderToStaticMarkup(<App />);
      expect(html).toContain("History is readable before the model is ready");
      expect(html).toContain("Load earlier messages");
      const newChatButtons = [
        ...html.matchAll(/<button[^>]*title="New chat"[^>]*>/g),
      ];
      expect(newChatButtons).toHaveLength(2);
      for (const [button] of newChatButtons)
        expect(button).not.toContain("disabled");
      expect(html).not.toContain("chat-opening-content");
      expect(html).not.toContain('aria-busy="true"');
      expect(html).toMatch(/<button[^>]*type="submit"[^>]*disabled=""/);
    } finally {
      Object.assign(state, previous);
    }
  });
}
