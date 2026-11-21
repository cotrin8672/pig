import type { TranscriptRecord } from "../../shared/transcript";
import type { ToolFixture } from "./kit";

/*
 * Fixtures for the pig-supported agent extensions:
 * - pi-subagents 0.89 (`subagent`): args follow its renderCall (agent / task /
 *   tasks / async); details are a story-local summary of each child run.
 * - pi-ask-user 0.17 (`ask_user`): text and details follow AskToolDetails.
 * - pi-schedule-prompt 0.5 (`schedule_prompt`): text follows tool.ts, and the
 *   `scheduled_prompt` custom message follows scheduler.ts markers.
 */

const text = (value: string, details?: unknown) => ({
  status: "done" as const,
  result: { content: [{ type: "text" as const, text: value }], details },
});

export type ChildRun = {
  agent: string;
  task: string;
  status: "done" | "running" | "error";
  model: string;
  seconds: number;
  turns: number;
  tokens: number;
  output: string;
};

/** pi-subagents 0.89 result entry: exitCode, progressSummary and finalOutput. */
const childResult = (run: ChildRun) => ({
  agent: run.agent,
  task: run.task,
  model: run.model,
  exitCode: run.status === "error" ? 1 : 0,
  progressSummary: {
    toolCount: run.turns,
    tokens: run.tokens,
    durationMs: run.seconds * 1000,
  },
  finalOutput: run.output,
});

const reviewOutput = `## Findings

1. **send-controller.ts** retries a lost send once with the same request ID — safe.
2. **draft-store.ts** clears the draft before the receipt is confirmed. If the host restarts in between, the text is lost.
3. Tests cover the retry path but not the restart window.

Recommendation: keep the draft until \`receipt.accepted\` arrives.`;

export const subagentSingle: ToolFixture = {
  description: {
    purpose:
      "pi-subagents の子エージェントに作業を任せ、その結果を親の会話へ返すツール。調査・レビューなど、文脈を分けたい作業に使う。",
    input:
      "エージェント名（reviewer など）と依頼文。async を付けるとバックグラウンドで走り、結果は後から届く。",
    output:
      "子エージェントの最終回答（Markdown）と、モデル・ターン数・トークン・所要時間などの実行情報。",
  },
  tool: {
    call: {
      id: "subagent-review",
      name: "subagent",
      arguments: {
        agent: "reviewer",
        task: "送信パイプラインで二重送信や下書き消失が起きる経路をレビューして",
      },
    },
    live: false,
    state: text(reviewOutput, {
      mode: "single",
      results: [
        childResult({
          agent: "reviewer",
          task: "送信パイプラインで二重送信や下書き消失が起きる経路をレビューして",
          status: "done",
          model: "claude-sonnet-5",
          seconds: 84,
          turns: 12,
          tokens: 48_200,
          output: reviewOutput,
        }),
      ],
    }),
  },
  error: "Subagent reviewer failed: model rate limit exceeded (429)",
};

const lanes: ChildRun[] = [
  {
    agent: "scout",
    task: "apps/desktop/src から再試行ロジックを列挙",
    status: "done",
    model: "gpt-5.4-mini",
    seconds: 31,
    turns: 6,
    tokens: 12_400,
    output:
      "Found 4 retry sites: send-controller.ts, sdk-send-receipts.ts, provider-usage.ts, packages.ts.",
  },
  {
    agent: "reviewer",
    task: "見つかった再試行の二重実行リスクを評価",
    status: "done",
    model: "claude-sonnet-5",
    seconds: 77,
    turns: 11,
    tokens: 39_800,
    output:
      "send-controller.ts is idempotent via request IDs. provider-usage.ts may double count on reconnect.",
  },
  {
    agent: "tester",
    task: "provider-usage の再接続テストを追加",
    status: "error",
    model: "gpt-5.4",
    seconds: 45,
    turns: 9,
    tokens: 21_000,
    output:
      "bun test failed: provider-usage.test.ts:88 expected 1 refresh, got 2",
  },
];

export const subagentParallel: ToolFixture = {
  description: subagentSingle.description,
  tool: {
    call: {
      id: "subagent-parallel",
      name: "subagent",
      arguments: {
        tasks: lanes.map(({ agent, task }) => ({ agent, task })),
      },
    },
    live: false,
    state: text(
      lanes.map((lane) => `### ${lane.agent}\n${lane.output}`).join("\n\n"),
      { mode: "parallel", results: lanes.map(childResult) },
    ),
  },
  error: "Parallel run aborted by the user",
};

const askOptions = [
  {
    title: "Chipに統合",
    description: "Composer左下の件数Chipから開く。帯は出さない。",
  },
  {
    title: "右端のレール",
    description: "ペイン右端に縦のアイコン列を置く。",
  },
  {
    title: "上端のアイランド",
    description: "ペイン上端に一番急ぐ1件を出す。",
  },
];

export const askUser: ToolFixture = {
  description: {
    purpose:
      "pi-ask-user でユーザーに質問し、選択肢または自由記述の回答を待つツール。設計判断や曖昧な要件の確認に使う。",
    input:
      "質問文、判断材料（context）、選択肢（タイトルと説明）、複数選択・自由記述の可否。",
    output:
      "選ばれた選択肢とコメント、または自由記述。取り消された場合は cancelled。",
  },
  tool: {
    call: {
      id: "ask-user",
      name: "ask_user",
      arguments: {
        question: "セッションの作業状況はどこに表示しますか？",
        context:
          "現在は Composer の上に帯が出て、入力欄と重なっています。ガイドラインでは Composer の上下に帯を足さない方針です。",
        options: askOptions,
        allowMultiple: false,
        allowFreeform: true,
      },
    },
    live: false,
    state: text("User answered: Chipに統合 — 以前の方針どおりに", {
      question: "セッションの作業状況はどこに表示しますか？",
      context:
        "現在は Composer の上に帯が出て、入力欄と重なっています。ガイドラインでは Composer の上下に帯を足さない方針です。",
      options: askOptions,
      response: {
        kind: "selection",
        selections: ["Chipに統合"],
        comment: "以前の方針どおりに",
      },
      cancelled: false,
    }),
  },
  error: "User cancelled the question",
};

const job = {
  id: "k3f9q2",
  name: "morning-ci",
  type: "cron",
  schedule: "0 0 9 * * *",
  prompt: "CIの失敗を確認して、原因と直し方を要約して",
};

export const scheduleAdd: ToolFixture = {
  description: {
    purpose:
      "pi-schedule-prompt でプロンプトを予約するツール。指定時刻・一定間隔・cron でこのチャットへ自動送信する。",
    input:
      "action（add / list / remove / enable / disable / update / cleanup）、schedule、prompt、type、name など。この例は毎朝9時の cron を追加する。",
    output:
      "作成・更新したジョブのID・種類・スケジュール・プロンプト。list はジョブ一覧と次回・前回の実行。",
  },
  tool: {
    call: {
      id: "schedule-add",
      name: "schedule_prompt",
      arguments: {
        action: "add",
        type: job.type,
        schedule: job.schedule,
        name: job.name,
        prompt: job.prompt,
      },
    },
    live: false,
    state: text(
      `✓ Created cron job "${job.name}" (${job.id})\nType: cron\nSchedule: ${job.schedule}\nPrompt: ${job.prompt}`,
    ),
  },
  error:
    "Missing required parameters for add action: schedule. You must provide both schedule and prompt.",
};

export const scheduleList: ToolFixture = {
  description: scheduleAdd.description,
  tool: {
    call: {
      id: "schedule-list",
      name: "schedule_prompt",
      arguments: { action: "list" },
    },
    live: false,
    state: text(
      [
        `✓ ${job.name} (${job.id})`,
        `  Type: cron | Schedule: ${job.schedule}`,
        `  Prompt: ${job.prompt}`,
        "  Last: 2026-11-21 09:00 | Next: 2026-11-22 09:00",
        "  Runs: 4 | Status: success",
        "✓ progress-report (p81xa0)",
        "  Type: interval | Schedule: 15m",
        "  Prompt: 未完了のTODOの進捗を報告して",
        "  Never run | Next: 2026-11-21 18:15",
        "  Runs: 0 | Status: pending",
        "✗ nightly-bench (b20zz1)",
        "  Type: cron | Schedule: 0 30 2 * * *",
        "  Prompt: ベンチマークを走らせて前日比を出して",
        "  Last: 2026-11-20 02:30 ",
        "  Runs: 9 | Status: error",
      ].join("\n"),
    ),
  },
  error: "Failed to read schedule store",
};

const record = (
  id: string,
  details: Record<string, unknown>,
  content: { type: "text"; text: string }[] = [],
): TranscriptRecord => ({
  id,
  branchId: "main",
  parentId: null,
  order: 0,
  kind: "message",
  message: {
    role: "custom",
    customType: "scheduled_prompt",
    content,
    display: true,
    details,
    timestamp: Date.UTC(2026, 10, 21, 0, 0),
  } as never,
});

/** Visible-only marker posted right before the scheduled prompt is sent. */
export const firedMarker = record("scheduled-fired", {
  jobId: job.id,
  jobName: job.name,
  prompt: job.prompt,
});
/** Start marker of a job that runs in a separate session (subagent mode). */
export const subagentStartMarker = record(
  "scheduled-subagent-start",
  {
    jobId: "b20zz1",
    jobName: "nightly-bench",
    prompt: "ベンチマークを走らせて前日比を出して",
    mode: "subagent_start",
    model: "gpt-5.4-mini",
  },
  [
    {
      type: "text",
      text: "🕐 Scheduled (subagent: gpt-5.4-mini): nightly-bench",
    },
  ],
);
/** Marker for a job that ran in a separate session (subagent mode). */
export const subagentDoneMarker = record(
  "scheduled-subagent",
  {
    jobId: "b20zz1",
    jobName: "nightly-bench",
    prompt: "ベンチマークを走らせて前日比を出して",
    mode: "subagent_done",
    model: "gpt-5.4-mini",
    output:
      "Startup 412ms (-3%), first paint 618ms (+1%), search query p95 38ms (-12%).",
  },
  [
    {
      type: "text",
      text: "Startup 412ms (-3%), first paint 618ms (+1%), search query p95 38ms (-12%).",
    },
  ],
);
export const scheduledPrompt = job;
