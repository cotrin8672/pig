import type { SessionUIState } from "../../../../../packages/config/src";
import { drafts } from "../../mainview/draft-store";
import { applyThemeTokens } from "../../mainview/dynamic-theme";
import { initialPaneTree } from "../../mainview/pane-layout";
import { useStore } from "../../mainview/store";
import { defaultAppearance } from "../../shared/appearance";
import type { ModelInfo, Snapshot } from "../../shared/rpc-schema";
import { defaultSettings } from "../../shared/settings";
import type { Message, TranscriptRecord } from "../../shared/transcript";
import { setStoryPreviewActive } from "../browser-rpc";

export const scenes = [
  "conversation",
  "running",
  "approval",
  "empty",
  "settings",
  "split",
] as const;
export type PreviewArgs = {
  scene: (typeof scenes)[number];
  themeColor: string;
  language: "ja" | "en";
};
export const previewDefaults: PreviewArgs = {
  scene: "conversation",
  themeColor: defaultAppearance.themeColor,
  language: "ja",
};
export const previewArgTypes = {
  scene: { control: false as const },
  themeColor: { control: "color" as const, name: "テーマカラー（保存しない）" },
  language: {
    control: "inline-radio" as const,
    options: ["ja", "en"],
    name: "言語",
  },
};
export const models: ModelInfo[] = [
  {
    provider: "anthropic",
    id: "claude-opus-5-5",
    name: "Claude Opus 5.5",
    contextWindow: 200000,
    vision: true,
    reasoning: true,
    effortLevels: ["low", "medium", "high"],
    effectiveDefaultEffort: "medium",
  },
  {
    provider: "openai-codex",
    id: "gpt-6.1-sol",
    name: "GPT-6.1 Sol",
    contextWindow: 200000,
    vision: true,
    reasoning: true,
    effortLevels: ["off", "low", "medium", "high", "xhigh"],
    effectiveDefaultEffort: "medium",
  },
  {
    provider: "mistral",
    id: "devstral-small",
    name: "Devstral Small",
    contextWindow: 128000,
    effortLevels: [],
  },
];
const project = "C:/storybook/pig";
const otherProject = "C:/storybook/notes";
const general = "C:/storybook/general";
const usage = {
  input: 2800,
  output: 820,
  cacheRead: 1200,
  cacheWrite: 0,
  totalTokens: 4820,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};
let epoch = 0;

function record(id: string, order: number, message: Message): TranscriptRecord {
  return {
    id,
    entryId: id,
    parentId: order ? `record-${order - 1}` : null,
    branchId: "preview",
    order,
    kind: "message",
    message,
  };
}
function answer(
  id: string,
  order: number,
  text: string,
  now: number,
): TranscriptRecord {
  return record(id, order, {
    role: "assistant",
    content: [{ type: "text", text }],
    api: "anthropic-messages",
    provider: models[0].provider,
    model: models[0].id,
    usage,
    stopReason: "stop",
    timestamp: now,
  });
}

export function activityFixture(
  generation: string,
  now = Date.now(),
): SessionUIState {
  const source = {
    label: "Storybook adapter",
    scope: { kind: "session" as const, id: "preview-main" },
    freshness: "live" as const,
  };
  return {
    generation,
    commands: [],
    keymaps: [],
    diagnostics: [],
    views: [
      {
        adapterId: "preview",
        revision: 1,
        view: {
          id: "todo",
          kind: "todo",
          title: "作業の進捗",
          source,
          items: [
            {
              id: "inspect",
              identity: "native",
              title: "既存の実装を確認",
              state: "completed",
            },
            {
              id: "render",
              identity: "native",
              title: "画面全体をStorybookで確認",
              state: "active",
            },
            {
              id: "extract",
              identity: "native",
              title: "共通化するまとまりを決める",
              state: "pending",
            },
          ],
        },
      },
      {
        adapterId: "preview",
        revision: 1,
        view: {
          id: "agents",
          kind: "agents",
          title: "レビュー",
          source,
          runs: [
            {
              id: "review",
              title: "変更箇所のレビュー",
              state: { phase: "running" },
              startedAt: new Date(now - 12000).toISOString(),
              output: {
                text: "Reviewing the current UI components…\nChecking shared behavior and focus handling.",
                stream: "combined",
              },
            },
          ],
        },
      },
      {
        adapterId: "preview",
        revision: 1,
        view: {
          id: "background",
          kind: "background",
          title: "バックグラウンド",
          source,
          runs: [
            {
              id: "tests",
              title: "描画テスト",
              command: "pnpm test:ui",
              state: { phase: "running" },
              startedAt: new Date(now - 8000).toISOString(),
              output: {
                text: "Checking rendered layout…\n24 checks scheduled.",
                stream: "stdout",
              },
            },
          ],
        },
      },
    ],
  };
}

/** Views in the shape bun/supported-adapters.ts publishes for supported Extensions. */
export function supportedExtensionsFixture(
  generation: string,
  now = Date.now(),
): SessionUIState {
  const source = (label: string) => ({
    label,
    scope: { kind: "session" as const, id: "preview-main" },
    freshness: "live" as const,
  });
  return {
    generation,
    commands: [
      {
        adapterId: "pig:schedule-prompt",
        id: "manage",
        title: "Manage scheduled prompts",
        busy: false,
      },
    ],
    keymaps: [],
    diagnostics: [],
    views: [
      {
        adapterId: "pig:subagents",
        revision: 1,
        view: {
          kind: "agents",
          id: "subagents",
          title: "Subagents",
          source: source("pi-subagents"),
          runs: [
            {
              id: "agent-2",
              title: "Find flaky tests",
              profile: "Explore",
              state: { phase: "running" },
              startedAt: new Date(now - 42_000).toISOString(),
              detail: "Scanning apps/desktop/src for retries…",
            },
            {
              id: "agent-1",
              title: "Summarize the send pipeline",
              profile: "general-purpose",
              state: { phase: "finished", outcome: "success" },
              startedAt: new Date(now - 300_000).toISOString(),
              endedAt: new Date(now - 240_000).toISOString(),
              output: {
                text: "send-controller.ts retries a lost send once with the same request.",
              },
            },
          ],
        },
      },
      {
        adapterId: "pig:schedule-prompt",
        revision: 1,
        view: {
          kind: "schedule",
          id: "schedule-prompt",
          title: "Scheduled prompts",
          source: source("pi-schedule-prompt"),
          actions: [{ id: "manage", label: "Manage", command: "manage" }],
          schedules: [
            {
              id: "ci-check",
              title: "check-ci",
              enabled: true,
              timing: {
                kind: "once",
                at: new Date(now + 600_000).toISOString(),
              },
              nextRunAt: new Date(now + 600_000).toISOString(),
              lifetime: "This session",
              runs: [],
            },
            {
              id: "progress",
              title: "progress-report",
              enabled: true,
              timing: { kind: "interval", milliseconds: 900_000 },
              nextRunAt: new Date(now + 300_000).toISOString(),
              lifetime: "Shared in this project",
              runs: [
                {
                  id: "progress:last",
                  title: "Last run",
                  state: {
                    phase: "finished",
                    outcome: "success",
                    label: "Prompt sent",
                  },
                  startedAt: new Date(now - 600_000).toISOString(),
                  detail: "Report progress on the open TODO items.",
                },
              ],
            },
          ],
        },
      },
    ],
  };
}

/** Data only. All snapshots belong to a synthetic host, never a user's session. */
export function createPreviewState(
  args: PreviewArgs,
  now = Date.now(),
): ReturnType<typeof useStore.getState> {
  const initial = useStore.getInitialState();
  const generation = `storybook-${++epoch}`;
  const address = (sessionId: string) => ({
    hostId: generation,
    sessionId,
    epoch,
  });
  const info = {
    id: "preview-main",
    cwd: project,
    title: "UIの共通化を検討",
    modified: now,
  };
  const records = [
    record("record-0", 0, {
      role: "user",
      content:
        "まず今の画面をそのまま見ながら、どこを共通化できるか確認したい。",
      timestamp: now - 60000,
    }),
    answer(
      "record-1",
      1,
      "## 画面全体から確認します\n\nサイドバー、会話、入力欄を**本番と同じコンポーネント**で表示しています。\n\n- モデルの選択やメニューを開く\n- 通知センターを確認する\n- 設定画面へ移動する\n\n共通化する範囲は、この画面を見ながら決めます。",
      now - 45000,
    ),
    record("record-2", 2, {
      role: "user",
      content: "その方針で。表示を確認してから、まとまりごとに切り出そう。",
      timestamp: now - 30000,
    }),
    answer(
      "record-3",
      3,
      "了解です。本番のコードは移動せず、Storybook上だけで確認を進めます。\n\n```tsx\n<App /> // 現在の画面そのもの\n```",
      now - 15000,
    ),
  ];
  const snapshot = (
    id: string,
    cwd: string,
    title: string,
    content: TranscriptRecord[],
  ): Snapshot => ({
    address: address(id),
    snapshotSeq: 1,
    info: { id, cwd, title, modified: now },
    model: models[0],
    modelCatalog: models,
    effort: "medium",
    effortLevels: models[0].effortLevels ?? [],
    contextUsage: { tokens: 42000, contextWindow: 200000, percent: 21 },
    transcript: {
      records: content,
      tools: {},
      history: { revision: generation },
      current: null,
      running: false,
      liveToEntry: {},
    },
  });
  const main = snapshot(
    info.id,
    project,
    info.title,
    args.scene === "empty" ? [] : records,
  );
  const secondary = snapshot(
    "preview-notes",
    otherProject,
    "次のレビューで見ること",
    [
      record("notes-0", 0, {
        role: "user",
        content: "レビューの観点をまとめて。",
        timestamp: now - 90000,
      }),
      answer(
        "notes-1",
        1,
        "見た目だけでなく、操作、状態変化、狭い幅での表示を確認します。",
        now - 80000,
      ),
    ],
  );
  if (args.scene === "running" || args.scene === "approval") {
    main.transcript = { ...main.transcript, running: true };
    main.sessionUI = activityFixture(generation, now);
  }
  if (args.scene === "empty") main.info.title = "新しいチャット";
  return {
    ...initial,
    initialized: true,
    cachedSidebar: false,
    hostId: generation,
    page: args.scene === "settings" ? ("settings" as const) : ("chat" as const),
    settingsCategory: "appearance" as const,
    appearance: { ...defaultAppearance, themeColor: args.themeColor },
    settings: { ...defaultSettings, language: args.language },
    active: main.info.id,
    snapshots: { [main.info.id]: main, [secondary.info.id]: secondary },
    addresses: {
      [main.info.id]: main.address,
      [secondary.info.id]: secondary.address,
    },
    sessions: {
      [project]: [main.info],
      [otherProject]: [secondary.info],
      [general]: [],
    },
    bootstrap: {
      generalCwd: general,
      projects: [project, otherProject],
      providers: [
        {
          id: "anthropic",
          name: "Anthropic",
          configured: true,
          stored: true,
          apiKey: true,
          extension: false,
        },
        {
          id: "openai-codex",
          name: "OpenAI Codex",
          configured: true,
          stored: true,
          apiKey: false,
          oauth: { subscription: true },
          extension: false,
        },
        {
          id: "mistral",
          name: "Mistral",
          configured: true,
          stored: true,
          apiKey: true,
          extension: false,
        },
      ],
      models,
      imageModels: [],
      classificationModels: [],
      classificationProviders: [],
      disabledModels: [],
      modelOverrides: {},
      desktop: { sessions: {}, recentModels: ["anthropic/claude-opus-5-5"] },
    },
    providerUsage: [
      {
        key: "anthropic",
        provider: "anthropic",
        label: "Anthropic",
        source: "api" as const,
        status: "ready" as const,
        observedAt: now,
        data: {
          windows: [
            {
              id: "5h",
              label: "5h",
              usedPercent: 32,
              resetsAt: now + 7200000,
              durationMs: 18000000,
            },
          ],
          balances: [],
        },
      },
      {
        key: "openai-codex",
        provider: "openai-codex",
        label: "OpenAI Codex",
        source: "api" as const,
        status: "ready" as const,
        observedAt: now,
        data: {
          windows: [
            {
              id: "5h",
              label: "5h",
              usedPercent: 68,
              resetsAt: now + 3600000,
              durationMs: 18000000,
            },
          ],
          balances: [],
        },
      },
    ],
    paneTree: initialPaneTree(args.scene === "split" ? "columns" : "single"),
    panes:
      args.scene === "split"
        ? {
            1: { sessionId: main.info.id },
            2: { sessionId: secondary.info.id },
          }
        : { 1: { sessionId: main.info.id } },
    activePane: 1,
    pendingUI:
      args.scene === "approval"
        ? [
            {
              ...main.address,
              uiId: "preview-question",
              kind: "confirm" as const,
              title: "レビューを続けますか？",
              message:
                "入力要求も本番のUIで表示しています。回答はStorybook内だけで完結します。",
            },
          ]
        : [],
    noticeHistory: [
      {
        id: "preview-notice-1",
        level: "success" as const,
        message: "セッション一覧の確認が完了しました。",
        createdAt: now - 120000,
        read: true,
        session: { id: secondary.info.id, cwd: otherProject },
        title: secondary.info.title,
      },
      {
        id: "preview-notice-2",
        level: "info" as const,
        message: "画面全体から共通化の範囲を検討できます。",
        createdAt: now - 60000,
        read: false,
      },
      {
        id: "preview-notice-3",
        level: "warning" as const,
        message: "送信・ツール実行・ネイティブ操作は接続していません。",
        createdAt: now - 30000,
        read: false,
      },
    ],
    notices: [],
  } satisfies ReturnType<typeof useStore.getState>;
}

/** Called by Storybook beforeEach; cleanup runs when leaving the story. */
export function installPreview(args: PreviewArgs) {
  const previous = useStore.getState();
  const style = document.documentElement.style.cssText;
  const language = document.documentElement.lang;
  const historyState = history.state;
  const next = createPreviewState(args);
  setStoryPreviewActive(true);
  useStore.setState(next, true);
  applyThemeTokens(document.documentElement.style, args.themeColor);
  document.documentElement.lang = args.language;
  return () => {
    setStoryPreviewActive(false);
    for (const snapshot of Object.values(next.snapshots))
      drafts.discard(snapshot.address, true);
    useStore.setState(previous, true);
    document.documentElement.style.cssText = style;
    document.documentElement.lang = language;
    history.replaceState(historyState, "");
  };
}
