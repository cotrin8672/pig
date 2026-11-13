/**
 * Preview data for the Provider usage meter. Shapes follow
 * docs/provider-usage-feasibility.md: each kind of figure stays separate, and
 * nothing is derived (no "budget − spend = balance").
 */

/** Where the figure came from; shown so users can judge how much to trust it. */
export type UsageSource =
  | "official" // documented API / MCP / app-server
  | "headers" // rate-limit headers of the last real response
  | "admin" // official API that needs an extra admin key
  | "private"; // undocumented endpoint used by an official client

export type UsageMetric =
  /** Subscription window: Codex 5h/week, Claude 5h/week, Mistral plan budget… */
  | {
      kind: "window";
      label: string;
      /** Remaining share, 0–100. */
      remaining: number;
      /** Epoch ms. */
      resetsAt?: number;
      /** Window length (Codex windowDurationMins); lets the UI show time left as a share. */
      windowMins?: number;
    }
  /** A real balance reported by the Provider. Never computed by pig. */
  | { kind: "balance"; label: string; amount: string; low?: boolean }
  /** Spend is not a balance: labelled as such. */
  | { kind: "spend"; label: string; amount: string }
  /** Short-term limits from response headers. */
  | {
      kind: "rate";
      label: string;
      remaining: number;
      limit: number;
      /** Epoch ms. */
      resetsAt?: number;
      windowMins?: number;
    }
  /** Codex rate-limit reset tickets. */
  | { kind: "tickets"; label: string; count: number; expiresAt?: number };

export type UsageEntry = {
  key: string;
  provider: string;
  name: string;
  /** Short label for the compact dock. */
  short: string;
  /** Account label when the Provider has several accounts. */
  account?: string;
  plan: "subscription" | "api";
  source?: UsageSource;
  updated?: string;
} & (
  | { status: "ok"; metrics: UsageMetric[] }
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "unsupported"; reason: string; dashboard: string }
);

/** Fixed clock so stories render the same every time. */
export const NOW = new Date(2026, 10, 12, 14, 0).getTime();
const in_ = (h: number, m = 0, s = 0) => NOW + ((h * 60 + m) * 60 + s) * 1000;
const on = (month: number, day: number, hour: number) =>
  new Date(2026, month - 1, day, hour).getTime();

export const sourceLabel: Record<UsageSource, string> = {
  official: "公式API",
  headers: "直近の応答ヘッダー",
  admin: "管理者キー",
  private: "非公開API",
};

export const usage: UsageEntry[] = [
  {
    key: "codex-1",
    short: "Codex Work",
    provider: "openai-codex",
    name: "OpenAI Codex",
    account: "Work",
    plan: "subscription",
    source: "official",
    updated: "1分前",
    status: "ok",
    metrics: [
      {
        kind: "window",
        label: "5時間",
        remaining: 12,
        resetsAt: in_(1, 12),
        windowMins: 300,
      },
      {
        kind: "window",
        label: "週",
        remaining: 64,
        resetsAt: on(11, 17, 9),
        windowMins: 10_080,
      },
      {
        kind: "tickets",
        label: "リセットチケット",
        count: 2,
        expiresAt: on(11, 30, 0),
      },
    ],
  },
  {
    key: "codex-2",
    short: "Codex Personal",
    provider: "openai-codex",
    name: "OpenAI Codex",
    account: "Personal",
    plan: "subscription",
    source: "official",
    updated: "1分前",
    status: "ok",
    metrics: [
      {
        kind: "window",
        label: "5時間",
        remaining: 91,
        resetsAt: in_(4, 40),
        windowMins: 300,
      },
      {
        kind: "window",
        label: "週",
        remaining: 77,
        resetsAt: on(11, 13, 2),
        windowMins: 10_080,
      },
    ],
  },
  {
    key: "anthropic",
    short: "Claude Max",
    provider: "anthropic",
    name: "Anthropic",
    account: "Claude Max",
    plan: "subscription",
    status: "unsupported",
    reason: "公開されている取得経路がありません",
    dashboard: "claude.ai/settings/usage",
  },
  {
    key: "mistral",
    short: "Mistral",
    provider: "mistral",
    name: "Mistral",
    plan: "subscription",
    source: "official",
    updated: "3分前",
    status: "ok",
    metrics: [
      {
        kind: "window",
        label: "API予算",
        remaining: 48,
        resetsAt: on(12, 1, 0),
      },
      { kind: "spend", label: "今月の従量課金", amount: "€4.18" },
    ],
  },
  {
    key: "deepseek",
    short: "DeepSeek",
    provider: "deepseek",
    name: "DeepSeek",
    plan: "api",
    source: "official",
    updated: "2分前",
    status: "ok",
    metrics: [{ kind: "balance", label: "残高", amount: "¥3.20", low: true }],
  },
  {
    key: "openrouter",
    short: "OpenRouter",
    provider: "openrouter",
    name: "OpenRouter",
    plan: "api",
    source: "admin",
    updated: "2分前",
    status: "ok",
    metrics: [{ kind: "balance", label: "残高", amount: "$12.40" }],
  },
  {
    key: "openai",
    short: "OpenAI API",
    provider: "openai",
    name: "OpenAI API",
    plan: "api",
    source: "headers",
    updated: "5分前",
    status: "ok",
    metrics: [
      {
        kind: "rate",
        label: "リクエスト/分",
        remaining: 4_980,
        limit: 5_000,
        resetsAt: in_(0, 0, 12),
        windowMins: 1,
      },
      {
        kind: "rate",
        label: "トークン/分",
        remaining: 612_000,
        limit: 800_000,
        resetsAt: in_(0, 0, 8),
        windowMins: 1,
      },
    ],
  },
  {
    key: "google",
    short: "AI Studio",
    provider: "google",
    name: "Google AI Studio",
    plan: "api",
    status: "error",
    message: "Cloud Monitoringの権限がありません",
  },
  {
    key: "vercel",
    short: "Vercel",
    provider: "vercel-ai-gateway",
    name: "Vercel AI Gateway",
    plan: "api",
    source: "official",
    status: "loading",
  },
];

/** Lowest remaining share across an entry's windows; drives sort order and warning dots. */
export function lowestRemaining(entry: UsageEntry) {
  if (entry.status !== "ok") return undefined;
  const shares = entry.metrics.flatMap((m) =>
    m.kind === "window"
      ? [m.remaining]
      : m.kind === "rate"
        ? [Math.round((m.remaining / m.limit) * 100)]
        : m.kind === "balance" && m.low
          ? [5]
          : [],
  );
  return shares.length ? Math.min(...shares) : undefined;
}

export type Level = "ok" | "warn" | "critical";
export function levelOf(remaining: number | undefined): Level {
  if (remaining === undefined || remaining > 25) return "ok";
  return remaining > 10 ? "warn" : "critical";
}

/** Most urgent first, then the rest in connection order; unknowns go last. */
export function byUrgency(entries: UsageEntry[]) {
  const rank = (e: UsageEntry) =>
    e.status === "ok"
      ? (lowestRemaining(e) ?? 100)
      : e.status === "error"
        ? 101
        : 102;
  return [...entries].sort((a, b) => rank(a) - rank(b));
}

export const alerting = (entries: UsageEntry[]) =>
  entries.filter((e) => levelOf(lowestRemaining(e)) !== "ok").length;

/**
 * Language-independent reset time: `12s`, `45m`, `1h 12m` within a day, else `12/1`.
 * Short enough for the dock's fixed reset column.
 */
export function formatReset(at: number, now = NOW) {
  const seconds = Math.max(0, Math.round((at - now) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  if (minutes < 24 * 60) {
    const rest = minutes % 60;
    return `${Math.floor(minutes / 60)}h${rest ? ` ${rest}m` : ""}`;
  }
  return formatDate(at);
}

/** `12/1` regardless of locale. */
export function formatDate(at: number) {
  const date = new Date(at);
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

/** `12/1 9:00` for tooltips, where there is room for the exact time. */
export function formatDateTime(at: number) {
  const date = new Date(at);
  return `${formatDate(at)} ${date.getHours()}:${String(date.getMinutes()).padStart(2, "0")}`;
}

/** Settings → 一般 → 使用量の表示. Levels and sort order always follow what is left. */
export type UsageDisplay = "remaining" | "used";
export const shown = (remaining: number, display: UsageDisplay) =>
  display === "remaining" ? remaining : 100 - remaining;

/** Providers without a way to fetch usage are hidden for now. */
export const fetchable = (entries: UsageEntry[]) =>
  entries.filter((entry) => entry.status !== "unsupported");

/** Share of the window still to run before reset (0–100); shrinks as the reset nears. */
export function timeLeft(
  resetsAt: number | undefined,
  windowMins: number | undefined,
  now = NOW,
) {
  if (!resetsAt || !windowMins) return undefined;
  const share = ((resetsAt - now) / (windowMins * 60_000)) * 100;
  return Math.round(Math.min(100, Math.max(0, share)));
}
