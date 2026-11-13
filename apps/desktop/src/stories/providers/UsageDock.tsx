import {
  Bell,
  ChevronDown,
  CircleAlert,
  LoaderCircle,
  Puzzle,
  RefreshCw,
  Settings2,
  Settings as SettingsIcon,
} from "lucide-react";
import { type CSSProperties, useState } from "react";
import { ProviderIcon } from "../../mainview/ProviderIcon";
import {
  byUrgency,
  fetchable,
  formatDate,
  formatDateTime,
  formatReset,
  levelOf,
  lowestRemaining,
  shown,
  timeLeft,
  type UsageDisplay,
  type UsageEntry,
  type UsageMetric,
  usage,
} from "./usage-data";
import "../../mainview/notifications.css";
import "../../mainview/settings.css";
import "./usage-dock.css";

/** Remaining share (0–100) of a metric that has one. */
const share = (m: UsageMetric) =>
  m.kind === "window"
    ? m.remaining
    : m.kind === "rate"
      ? Math.round((m.remaining / m.limit) * 100)
      : undefined;

const percent = (remaining: number, display: UsageDisplay) =>
  `${display === "remaining" ? "残り" : "使用"}${shown(remaining, display)}%`;

/** Full figures for the row tooltip; the row itself only shows the most urgent one. */
function describe(entry: UsageEntry, display: UsageDisplay) {
  const head = `${entry.name}${entry.account ? ` ${entry.account}` : ""}`;
  if (entry.status === "loading") return `${head}: 取得中`;
  if (entry.status === "error") return `${head}: ${entry.message}`;
  if (entry.status === "unsupported") return `${head}: ${entry.reason}`;
  const lines = entry.metrics.map((m): string => {
    switch (m.kind) {
      case "window":
        return `${m.label} ${percent(m.remaining, display)}${m.resetsAt ? ` · ${formatDateTime(m.resetsAt)}にリセット` : ""}`;
      case "rate":
        return `${m.label} ${m.remaining.toLocaleString()} / ${m.limit.toLocaleString()}`;
      case "balance":
        return `${m.label} ${m.amount}`;
      case "spend":
        return `${m.label} ${m.amount}（使用額）`;
      case "tickets":
        return `${m.label} ${m.count}枚${m.expiresAt ? ` · ${formatDate(m.expiresAt)}まで` : ""}`;
      default:
        return "";
    }
  });
  return [head, ...lines].join("\n");
}

/** Balance-only entries show an amount instead of a share. */
function balanceOnly(entry: UsageEntry) {
  if (entry.status !== "ok") return undefined;
  if (entry.metrics.some((m) => share(m) !== undefined)) return undefined;
  const balance = entry.metrics.find((m) => m.kind === "balance");
  return balance?.kind === "balance" ? balance : undefined;
}

/**
 * Ways to fit "time left until reset" into the same 30px bar column:
 * - bars:   quota only (current)
 * - nested: faint outer fill = time left, inner line = quota
 * - tick:   quota line + a tick where the time left is (fill short of the tick = running out early)
 * - ring:   small double ring per window, outer = time, inner = quota
 */
export type DockVariant = "bars" | "nested" | "tick" | "ring";

type Window = { remaining: number; time?: number };

function windowsOf(metrics: UsageMetric[]): Window[] {
  return metrics
    .flatMap((m) => {
      const remaining = share(m);
      if (remaining === undefined) return [];
      const time =
        m.kind === "window" || m.kind === "rate"
          ? timeLeft(m.resetsAt, m.windowMins)
          : undefined;
      return [{ remaining, time }];
    })
    .slice(0, 2);
}

function Ring({
  remaining,
  time,
  display,
}: Window & { display: UsageDisplay }) {
  const quota = shown(remaining, display);
  return (
    <svg
      className="ud-ring"
      data-level={levelOf(remaining)}
      width="13"
      height="13"
      viewBox="0 0 13 13"
      aria-hidden="true"
    >
      <circle className="ud-ring-track" cx="6.5" cy="6.5" r="5.5" />
      {time !== undefined && (
        <circle
          className="ud-ring-time"
          cx="6.5"
          cy="6.5"
          r="5.5"
          pathLength="100"
          strokeDasharray={`${time} 100`}
          transform="rotate(-90 6.5 6.5)"
        />
      )}
      <circle className="ud-ring-track" cx="6.5" cy="6.5" r="2.75" data-inner />
      <circle
        className="ud-ring-quota"
        cx="6.5"
        cy="6.5"
        r="2.75"
        pathLength="100"
        strokeDasharray={`${quota} 100`}
        transform="rotate(-90 6.5 6.5)"
      />
    </svg>
  );
}

function Bars({
  metrics,
  display,
  variant = "bars",
}: {
  metrics: UsageMetric[];
  display: UsageDisplay;
  variant?: DockVariant;
}) {
  const windows = windowsOf(metrics);
  if (variant === "ring")
    return (
      <span className="ud-bars" data-variant="ring" aria-hidden="true">
        {windows.map((w, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: fixed positions
          <Ring key={index} {...w} display={display} />
        ))}
      </span>
    );
  return (
    <span className="ud-bars" data-variant={variant} aria-hidden="true">
      {windows.map(({ remaining, time }, index) => (
        <span
          // biome-ignore lint/suspicious/noArrayIndexKey: fixed positions
          key={index}
          className="ud-bar"
          data-level={levelOf(remaining)}
        >
          {variant === "nested" && time !== undefined && (
            <span className="ud-bar-time" style={{ width: `${time}%` }} />
          )}
          <span
            className="ud-bar-quota"
            style={{ width: `${shown(remaining, display)}%` }}
          />
          {variant === "tick" && time !== undefined && (
            <span className="ud-bar-tick" style={{ left: `${time}%` }} />
          )}
        </span>
      ))}
    </span>
  );
}

/** Value + reset columns. Windows show the lowest share; balances show the amount. */
function Figures({
  entry,
  display,
}: {
  entry: UsageEntry;
  display: UsageDisplay;
}) {
  if (entry.status === "loading")
    return (
      <span className="ud-value" data-muted>
        <LoaderCircle size={11} className="spinner" aria-label="取得中" />
      </span>
    );
  if (entry.status === "error")
    return (
      <span className="ud-value" data-level="critical">
        <CircleAlert size={11} aria-label="取得エラー" />
      </span>
    );
  if (entry.status !== "ok") return null;
  const balance = balanceOnly(entry);
  if (balance)
    return (
      <span
        className="ud-value"
        data-wide
        data-level={balance.low ? "critical" : undefined}
      >
        {balance.amount}
      </span>
    );
  const lowest = entry.metrics
    .filter((m) => share(m) !== undefined)
    .sort((a, b) => (share(a) ?? 0) - (share(b) ?? 0))[0];
  if (!lowest) return null;
  const remaining = share(lowest) ?? 0;
  const resetsAt = "resetsAt" in lowest ? lowest.resetsAt : undefined;
  return (
    <>
      <span className="ud-value" data-level={levelOf(remaining)}>
        {shown(remaining, display)}%
      </span>
      <span className="ud-reset">{resetsAt ? formatReset(resetsAt) : ""}</span>
    </>
  );
}

function Row({
  entry,
  display,
  variant,
}: {
  entry: UsageEntry;
  display: UsageDisplay;
  variant: DockVariant;
}) {
  return (
    <li className="ud-row" title={describe(entry, display)}>
      <ProviderIcon provider={entry.provider} size={12} />
      <span className="ud-name">{entry.short}</span>
      {entry.status === "ok" ? (
        <Bars metrics={entry.metrics} display={display} variant={variant} />
      ) : (
        <span className="ud-bars" />
      )}
      <Figures entry={entry} display={display} />
    </li>
  );
}

/**
 * Always-on usage list between the chat list and the footer icons.
 * Rows are fixed-height, so refreshing never moves the sidebar.
 * Providers without a way to fetch usage are left out.
 */
export function UsageDock({
  entries = usage,
  collapsed: initiallyCollapsed = false,
  display = "remaining",
  variant = "bars",
  ringSize = 13,
}: {
  entries?: UsageEntry[];
  collapsed?: boolean;
  display?: UsageDisplay;
  variant?: DockVariant;
  /** Ring diameter in px; the bar column and row height follow it. */
  ringSize?: number;
}) {
  const [collapsed, setCollapsed] = useState(initiallyCollapsed);
  const [busy, setBusy] = useState(false);
  const sorted = byUrgency(fetchable(entries));
  const top = sorted[0];
  const topShare = top && lowestRemaining(top);
  const topBalance = top && balanceOnly(top);
  return (
    <section
      className="ud"
      aria-label="使用量"
      data-variant={variant}
      style={{ "--ud-ring": `${ringSize}px` } as CSSProperties}
    >
      <div className="ud-heading">
        <button
          type="button"
          className="ud-toggle"
          aria-expanded={!collapsed}
          onClick={() => setCollapsed(!collapsed)}
        >
          <ChevronDown size={11} className="ud-chevron" aria-hidden="true" />
          使用量
          {collapsed && top && topShare !== undefined && (
            <span className="ud-summary" data-level={levelOf(topShare)}>
              {top.short}{" "}
              {topBalance ? topBalance.amount : `${shown(topShare, display)}%`}
            </span>
          )}
        </button>
        <small className="ud-updated">{busy ? "更新中" : "1m"}</small>
        <button
          type="button"
          className="ud-refresh"
          aria-label="使用量を更新"
          title="使用量を更新"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            setTimeout(() => setBusy(false), 1200);
          }}
        >
          <RefreshCw size={11} className={busy ? "spinner" : undefined} />
        </button>
      </div>
      {!collapsed && (
        <ul className="ud-list">
          {sorted.map((entry) => (
            <Row
              key={entry.key}
              entry={entry}
              display={display}
              variant={variant}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

/** Settings → 一般 row, same segmented control as "コンテキストの表示". */
export function UsageDisplaySetting({
  value,
  onChange,
}: {
  value: UsageDisplay;
  onChange: (value: UsageDisplay) => void;
}) {
  return (
    <div className="settings-card ud-settings">
      <div className="settings-row">
        <div className="settings-label">
          <span id="usage-display-label">使用量の表示</span>
        </div>
        <fieldset
          className="segmented-control"
          aria-labelledby="usage-display-label"
        >
          {(["remaining", "used"] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              aria-pressed={value === mode}
              onClick={() => onChange(mode)}
            >
              {mode === "remaining" ? "残り" : "使用済み"}
            </button>
          ))}
        </fieldset>
      </div>
    </div>
  );
}

const threads = [
  "このアプリに、Codex, Ant…",
  "既存の通知機能、Exten…",
  "このUIダサすぎる。どうにかして…",
  "たかさ変わるのやめて。C:\\Us…",
  "チャットが増えてくるとこうなっ…",
  "この謎の上方向の余白なん…",
  "多分前のpig-nightlyのチャ…",
  "チャットを上の方にスクロールし…",
  "いわゆるSteering(応答途中…",
  "今追加されたChatRenderer…",
  "CI失敗してる。多分piの実機…",
  "このアプリにアプリ内からの更…",
  "つぎはannotion機能を作り…",
  "不要なテストコードがないかを…",
];

/** A slice of the real sidebar (production classes) with the dock above the footer. */
export function SidebarWithDock({
  entries,
  collapsed,
  display,
  variant,
}: {
  entries?: UsageEntry[];
  collapsed?: boolean;
  display?: UsageDisplay;
  variant?: DockVariant;
}) {
  return (
    <aside className="sidebar ud-sidebar">
      <header>
        <strong className="sidebar-brand">pig</strong>
      </header>
      <div className="ud-threads">
        {threads.map((title) => (
          <div key={title} className="ud-thread">
            {title}
          </div>
        ))}
      </div>
      <UsageDock
        entries={entries}
        collapsed={collapsed}
        display={display}
        variant={variant}
      />
      <div className="sidebar-footer">
        <button type="button" className="sidebar-icon" aria-label="設定">
          <SettingsIcon size={16} aria-hidden="true" />
        </button>
        <button type="button" className="sidebar-icon" aria-label="Providers">
          <Settings2 size={16} aria-hidden="true" />
          <span className="sidebar-provider-dot connected" aria-hidden="true" />
        </button>
        <button type="button" className="sidebar-icon" aria-label="拡張機能">
          <Puzzle size={16} aria-hidden="true" />
        </button>
        <button type="button" className="sidebar-icon" aria-label="通知">
          <Bell size={16} aria-hidden="true" />
        </button>
      </div>
    </aside>
  );
}
