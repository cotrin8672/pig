/** Story-only fixtures for session-wide indicators shown per pane. */
export type RunState = "running" | "waiting" | "done" | "failed";
export type SessionStatus = { key: string; text: string };
export type SessionWidget = { key: string; lines: string[] };
export type BackgroundTask = {
  id: string;
  command: string;
  state: RunState;
  elapsed: string;
  exit?: number;
  output: string[];
};
export type Subagent = {
  id: string;
  name: string;
  task: string;
  state: RunState;
  model: string;
  elapsed: string;
  step?: string;
};
export type SessionInfo = {
  title: string;
  model: string;
  prompt?: string;
  response?: string;
  /** `ctx.ui.setStatus(key, text)` */
  statuses: SessionStatus[];
  /** `ctx.ui.setWidget(key, lines)` */
  widgets: SessionWidget[];
  tasks: BackgroundTask[];
  agents: Subagent[];
};
export type SectionKey = "status" | "widgets" | "tasks" | "agents";

const rich: SessionInfo = {
  title: "pane機能にインジケータを追加",
  model: "Claude Opus 4.6",
  prompt:
    "UI.setStatus と setWidget をペインごとに表示したい。バックグラウンドの dev サーバーとレビュー用のサブエージェントも動かしておいて。",
  response:
    "dev サーバーをバックグラウンドで起動し、reviewer と explorer の2つのサブエージェントに分担させました。拡張のステータスとウィジェットは、それぞれのペインのセッションに紐づけて表示します。",
  statuses: [
    { key: "git", text: "main ↑2 ●3" },
    { key: "ponytail", text: "full" },
    { key: "lint", text: "2 warnings" },
  ],
  widgets: [
    {
      key: "plan",
      lines: [
        "☑ 既存の SessionPanel を調査",
        "☑ ExtensionStatus の型を確認",
        "◐ インジケータのデザイン案を作成",
        "☐ 描画テストを追加",
      ],
    },
  ],
  tasks: [
    {
      id: "t1",
      command: "pnpm dev",
      state: "running",
      elapsed: "12m",
      output: [
        "VITE v6.2.0 ready in 412 ms",
        "➜ Local: http://localhost:5173/",
      ],
    },
    {
      id: "t2",
      command: "pnpm test --watch",
      state: "running",
      elapsed: "4m",
      output: ["✓ 248 passed", "watching for file changes…"],
    },
    {
      id: "t3",
      command: "pnpm build:web",
      state: "done",
      elapsed: "38s",
      exit: 0,
      output: ["✓ built in 37.6s"],
    },
  ],
  agents: [
    {
      id: "a1",
      name: "reviewer",
      task: "差分のレビュー",
      state: "running",
      model: "GPT-6.1 Sol",
      elapsed: "2m",
      step: "PaneWorkspace.tsx を読んでいます",
    },
    {
      id: "a2",
      name: "explorer",
      task: "既存のドック実装の調査",
      state: "running",
      model: "Claude Haiku 4.6",
      elapsed: "1m",
      step: "session-panel.css を検索",
    },
    {
      id: "a3",
      name: "docs",
      task: "ガイドの該当箇所を要約",
      state: "done",
      model: "Claude Haiku 4.6",
      elapsed: "52s",
    },
  ],
};

const light: SessionInfo = {
  title: "DualPumpLLEのコードを確認",
  model: "GPT-6.1 Sol",
  prompt: "計算結果の保存処理を確認して。",
  response:
    "保存処理を確認しました。境界条件のテストをバックグラウンドで回しています。",
  statuses: [{ key: "venv", text: "py3.13 (.venv)" }],
  widgets: [],
  tasks: [
    {
      id: "t1",
      command: "pytest -x tests/boundary",
      state: "running",
      elapsed: "1m",
      output: ["collected 42 items", "tests/boundary/test_flux.py ....."],
    },
  ],
  agents: [],
};

const empty: SessionInfo = {
  title: "New chat",
  model: "Mistral Vibe",
  statuses: [],
  widgets: [],
  tasks: [],
  agents: [],
};

/** Something needs the user: a failed task and a subagent waiting for input. */
function withAttention(info: SessionInfo): SessionInfo {
  return {
    ...info,
    tasks: info.tasks.map((task) =>
      task.id === "t2"
        ? {
            ...task,
            state: "failed",
            exit: 1,
            output: ["✗ 3 failed, 245 passed", "pane-layout.test.ts:88"],
          }
        : task,
    ),
    agents: info.agents.map((agent) =>
      agent.id === "a1"
        ? { ...agent, state: "waiting", step: "どちらの方針で直すか確認待ち" }
        : agent,
    ),
  };
}

export function paneFixtures(attention: boolean): SessionInfo[] {
  return [attention ? withAttention(rich) : rich, light, empty];
}

export const isLive = (state: RunState) => state === "running";
export const needsUser = (state: RunState) =>
  state === "failed" || state === "waiting";
export const dotClass: Record<RunState, string> = {
  running: "running",
  waiting: "waiting",
  done: "completed",
  failed: "failed",
};

export function isEmpty(info: SessionInfo) {
  return (
    !info.statuses.length &&
    !info.widgets.length &&
    !info.tasks.length &&
    !info.agents.length
  );
}

/** Most urgent first: failed > waiting > running > status text. */
export function headline(
  info: SessionInfo,
): { state?: RunState; text: string } | undefined {
  const failed = info.tasks.find((task) => task.state === "failed");
  if (failed)
    return {
      state: "failed",
      text: `${failed.command} が失敗 (exit ${failed.exit})`,
    };
  const waiting = info.agents.find((agent) => agent.state === "waiting");
  if (waiting) return { state: "waiting", text: `${waiting.name} が入力待ち` };
  const task = info.tasks.find((item) => isLive(item.state));
  if (task)
    return { state: "running", text: `${task.command} · ${task.elapsed}` };
  const agent = info.agents.find((item) => isLive(item.state));
  if (agent)
    return {
      state: "running",
      text: `${agent.name} · ${agent.step ?? agent.task}`,
    };
  const status = info.statuses[0];
  return status && { text: status.text };
}

export function sectionState(info: SessionInfo, key: SectionKey) {
  const runs =
    key === "tasks" ? info.tasks : key === "agents" ? info.agents : [];
  if (runs.some((run) => run.state === "failed")) return "failed";
  if (runs.some((run) => run.state === "waiting")) return "waiting";
  if (runs.some((run) => isLive(run.state))) return "running";
  return undefined;
}
export function sectionCount(info: SessionInfo, key: SectionKey) {
  return key === "status"
    ? info.statuses.length
    : key === "widgets"
      ? info.widgets.length
      : key === "tasks"
        ? info.tasks.length
        : info.agents.length;
}
