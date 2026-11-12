import { expect, mock, test } from "bun:test";
import { fileURLToPath } from "node:url";
import { fauxAssistantMessage } from "@earendil-works/pi-ai";
import { renderToStaticMarkup } from "react-dom/server";
import type { Snapshot } from "../shared/rpc-schema";
import { emptyTranscript, type Message } from "../shared/transcript";
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
    requestSelection: async (
      _address: unknown,
      request: () => Promise<unknown>,
    ) => request(),
    updateAppearance: () => {},
    updateSettings: () => {},
    sends: {
      subscribe: () => () => {},
      read: () => undefined,
      getTick: () => 0,
      optimistic: () => [],
    },
    openChat: async () => {},
    showPendingOpen: () => {},
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
      expect(html).not.toContain("<kbd");
      expect(html.match(/<textarea\b/g)).toHaveLength(1);
      expect(html.includes('title="Send" aria-label="Send" disabled=""')).toBe(
        existing,
      );
      expect(html).not.toContain('aria-disabled="true"');
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
      initialized: true,
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
      const main = active.split(/<main[^>]*>/)[1].split("</main>")[0];
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

  test("extension notices render between chat records, outside persisted transcript messages", async () => {
    const { Chat } = await import("./App");
    const { addressKey } = await import("./chat-snapshot");
    const { appendExtensionNotice } = await import("./extension-notices");
    const state = useStore.getInitialState();
    const previous = state.extensionNotices;
    const records = ["before notice", "after notice"].map((content, order) => ({
      id: `notice-test-${order}`,
      order,
      parentId: null,
      branchId: "main",
      kind: "message" as const,
      message: { role: "user" as const, content, timestamp: order },
    }));
    const transcript = { ...emptyTranscript(), records };
    state.extensionNotices = {
      [addressKey(snapshot.address)]: appendExtensionNotice(
        [],
        {
          type: "notify",
          address: snapshot.address,
          level: "warning",
          message: "inline warning",
        },
        { ...transcript, records: records.slice(0, 1) },
      ),
    };
    try {
      const html = renderToStaticMarkup(
        <Chat snapshot={{ ...snapshot, transcript }} />,
      );
      expect(html).toContain('class="extension-notice warning"');
      expect(html.indexOf("before notice")).toBeLessThan(
        html.indexOf("inline warning"),
      );
      expect(html.indexOf("inline warning")).toBeLessThan(
        html.indexOf("after notice"),
      );
      expect(html.match(/class="message user"/g)).toHaveLength(2);
    } finally {
      state.extensionNotices = previous;
    }
  });

  test("model dividers keep both turns visible and show provider icons before each model", async () => {
    const { Chat } = await import("./App");
    const messages: Message[] = [
      { role: "user", content: "First prompt", timestamp: 0 },
      {
        ...fauxAssistantMessage("First answer"),
        provider: "anthropic",
        model: "claude-fable-5-2",
      },
      { role: "user", content: "Second prompt", timestamp: 1 },
      {
        ...fauxAssistantMessage("Second answer"),
        provider: "openai-codex",
        model: "gpt-6.1-sol",
      },
    ];
    const html = renderToStaticMarkup(
      <Chat
        snapshot={{
          ...snapshot,
          transcript: {
            ...emptyTranscript(),
            records: messages.map((message, order) => ({
              id: `model-test-${order}`,
              order,
              parentId: null,
              branchId: "main",
              kind: "message",
              message,
            })),
          },
        }}
      />,
    );
    expect(html.match(/class="model-divider"/g)).toHaveLength(1);
    const divider = html.slice(
      html.indexOf('<div class="model-divider">'),
      html.indexOf("Second prompt"),
    );
    for (const name of [
      "anthropic/claude-fable-5-2",
      "openai-codex/gpt-6.1-sol",
    ]) {
      expect(divider).toContain(name);
      expect(
        divider.lastIndexOf("<svg", divider.indexOf(name)),
      ).toBeGreaterThan(-1);
    }
    expect(divider.match(/<svg\b/g)).toHaveLength(2);
    expect(html.indexOf("First answer")).toBeLessThan(
      html.indexOf('class="model-divider"'),
    );
    expect(html).toContain("Second answer");
    expect(html.match(/class="message user"/g)).toHaveLength(2);
  });

  test("startup metadata and rewind markers leave the conversation empty", async () => {
    const { Chat } = await import("./App");
    const html = renderToStaticMarkup(
      <Chat
        snapshot={{
          ...snapshot,
          transcript: {
            ...emptyTranscript(),
            records: [
              {
                id: "model",
                order: 0,
                branchId: "main",
                parentId: null,
                kind: "session-entry",
                entryType: "model_change",
                data: {},
              },
              ...["piris.rewind", "pig.rewind"].map((customType, i) => ({
                id: customType,
                order: i + 1,
                branchId: "main",
                parentId: "model",
                kind: "custom-entry" as const,
                customType,
                data: { entryId: "a2ccf4cd" },
              })),
            ],
          },
        }}
      />,
    );
    expect(html).toContain("What shall we build?");
    expect(html).toContain("Working in project");
    expect(html).not.toContain("Raw record");
    expect(html).not.toContain("a2ccf4cd");
    expect(html).not.toContain('class="transcript-search"');
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

  test("a failed retired preview remains editable without granting runtime capabilities", async () => {
    const { OpeningComposer } = await import("./ChatOpening");
    const preview: Snapshot = {
      ...snapshot,
      ready: false,
      address: { ...snapshot.address, epoch: 99 },
      failure: "Startup failed",
    };
    drafts.retire(preview.address);
    const html = renderToStaticMarkup(<OpeningComposer preview={preview} />);
    expect(html).not.toContain('readOnly=""');
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
      state.snapshots = { existing: snapshot };
      expect(renderToStaticMarkup(<UIRequestBroker />)).toContain(
        'aria-modal="false"',
      );
      state.active = "another-chat";
      const background = renderToStaticMarkup(<UIRequestBroker />);
      expect(background).toContain("ui-waiting-floating");
      expect(state.pendingUI).toEqual([request]);
    } finally {
      Object.assign(state, previous);
    }
  });

  test("logout uses the shared two-press confirmation button", async () => {
    const { ProviderDetail } = await import("./Providers");
    const html = renderToStaticMarkup(
      <ProviderDetail
        provider={{
          id: "p",
          name: "Provider",
          apiKey: true,
          configured: true,
          stored: true,
          extension: false,
        }}
      >
        <span />
      </ProviderDetail>,
    );
    expect(html).toContain('class="confirm-button');
    expect(html).toContain("Sign out");
    expect(html).toContain('class="confirm-armed" aria-hidden="true">Confirm');
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
      initialized: true,
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
      expect(html).not.toContain("What shall we build?");
      expect(html).toContain("Load earlier messages");
      const newChatButtons = [
        ...html.matchAll(/<button[^>]*title="New chat"[^>]*>/g),
      ];
      expect(newChatButtons).toHaveLength(2);
      for (const [button] of newChatButtons)
        expect(button).not.toContain("disabled");
      expect(html).not.toContain("chat-opening-content");
      expect(html).not.toContain('aria-busy="true"');
      expect(html).toContain('title="Send" aria-label="Send"');
      expect(html).not.toContain('title="Send" aria-label="Send" disabled=""');
    } finally {
      Object.assign(state, previous);
    }
  });
}
