import {
  CircleAlert,
  ExternalLink,
  LoaderCircle,
  RefreshCw,
  Ticket,
} from "lucide-react";
import { createContext, useContext, useState } from "react";
import { ProviderIcon } from "../../mainview/ProviderIcon";
import {
  byUrgency,
  fetchable,
  formatDate,
  formatReset,
  levelOf,
  lowestRemaining,
  shown,
  sourceLabel,
  type UsageDisplay,
  type UsageEntry,
  type UsageMetric,
  usage,
} from "./usage-data";
import "../../mainview/notifications.css";
import "./usage.css";

const number = new Intl.NumberFormat("ja-JP");
const Display = createContext<UsageDisplay>("remaining");

/**
 * Bar shows what is left, like a battery; colour only changes near the limit.
 * Decorative: the value next to it carries the number for screen readers.
 */
function Bar({ remaining }: { remaining: number; label?: string }) {
  const display = useContext(Display);
  return (
    <span
      className="usage-bar"
      aria-hidden="true"
      data-level={levelOf(remaining)}
    >
      <span style={{ width: `${shown(remaining, display)}%` }} />
    </span>
  );
}

function Metric({ metric }: { metric: UsageMetric }) {
  const display = useContext(Display);
  switch (metric.kind) {
    case "window":
      return (
        <div className="usage-metric">
          <span className="usage-metric-label">{metric.label}</span>
          <Bar remaining={metric.remaining} label={`${metric.label}の残り`} />
          <span
            className="usage-metric-value"
            data-level={levelOf(metric.remaining)}
          >
            {display === "remaining" ? "残り" : "使用"}
            {shown(metric.remaining, display)}%
          </span>
          {metric.resetsAt && (
            <span className="usage-metric-note">
              リセット {formatReset(metric.resetsAt)}
            </span>
          )}
        </div>
      );
    case "rate": {
      const share = Math.round((metric.remaining / metric.limit) * 100);
      return (
        <div className="usage-metric">
          <span className="usage-metric-label">{metric.label}</span>
          <Bar remaining={share} label={`${metric.label}の残り`} />
          <span className="usage-metric-value" data-level={levelOf(share)}>
            {number.format(metric.remaining)} / {number.format(metric.limit)}
          </span>
          {metric.resetsAt && (
            <span className="usage-metric-note">
              回復 {formatReset(metric.resetsAt)}
            </span>
          )}
        </div>
      );
    }
    case "balance":
      return (
        <div className="usage-metric" data-wide>
          <span className="usage-metric-label">{metric.label}</span>
          <strong
            className="usage-amount"
            data-level={metric.low ? "critical" : "ok"}
          >
            {metric.amount}
          </strong>
          {metric.low && (
            <span className="usage-metric-note">残高が少なくなっています</span>
          )}
        </div>
      );
    case "spend":
      return (
        <div className="usage-metric" data-wide>
          <span className="usage-metric-label">{metric.label}</span>
          <span className="usage-amount" data-spend>
            {metric.amount}
          </span>
          <span className="usage-metric-note">
            使用額（残高ではありません）
          </span>
        </div>
      );
    case "tickets":
      return (
        <div className="usage-metric" data-wide>
          <span className="usage-metric-label">
            <Ticket size={11} aria-hidden="true" />
            {metric.label}
          </span>
          <span className="usage-amount">{metric.count}枚</span>
          {metric.expiresAt && (
            <span className="usage-metric-note">
              {formatDate(metric.expiresAt)}まで
            </span>
          )}
        </div>
      );
  }
}

function Body({ entry }: { entry: UsageEntry }) {
  switch (entry.status) {
    case "ok":
      return (
        <div className="usage-metrics">
          {entry.metrics.map((metric) => (
            <Metric key={metric.label} metric={metric} />
          ))}
        </div>
      );
    case "loading":
      return (
        <div className="usage-state" role="status">
          <LoaderCircle size={12} className="spinner" aria-hidden="true" />
          取得中…
        </div>
      );
    case "error":
      return (
        <div className="usage-state" data-level="critical">
          <CircleAlert size={12} aria-hidden="true" />
          <span>{entry.message}</span>
          <button type="button" className="usage-link">
            再試行
          </button>
        </div>
      );
    case "unsupported":
      return (
        <div className="usage-state">
          <span>{entry.reason}</span>
          <button type="button" className="usage-link" title={entry.dashboard}>
            公式の使用量ページ <ExternalLink size={11} aria-hidden="true" />
          </button>
        </div>
      );
  }
}

function Entry({ entry, detailed }: { entry: UsageEntry; detailed?: boolean }) {
  const level = levelOf(lowestRemaining(entry));
  return (
    <article
      className="usage-card"
      data-ui-surface="card"
      data-detailed={detailed || undefined}
      aria-label={`${entry.name}${entry.account ? ` ${entry.account}` : ""}`}
    >
      <header className="usage-card-heading">
        <ProviderIcon provider={entry.provider} size={14} />
        <span className="usage-card-name">
          {entry.name}
          {entry.account && <small>{entry.account}</small>}
        </span>
        {level !== "ok" && (
          <span
            className="usage-level-dot"
            data-level={level}
            role="img"
            aria-label={level === "critical" ? "上限間近" : "残りわずか"}
          />
        )}
        <small className="usage-plan">
          {entry.plan === "subscription" ? "サブスク" : "API"}
        </small>
      </header>
      <Body entry={entry} />
      {detailed && (entry.source || entry.updated) && (
        <footer className="usage-card-footer">
          {entry.source && (
            <span data-private={entry.source === "private" || undefined}>
              {sourceLabel[entry.source]}
            </span>
          )}
          {entry.updated && <span>{entry.updated}に更新</span>}
        </footer>
      )}
    </article>
  );
}

function Refresh({ updated = "1分前" }: { updated?: string }) {
  const [busy, setBusy] = useState(false);
  return (
    <>
      <small className="usage-updated">
        {busy ? "更新中…" : `${updated}に更新`}
      </small>
      <button
        type="button"
        className="usage-icon-button"
        aria-label="すべて更新"
        title="すべて更新"
        disabled={busy}
        onClick={() => {
          setBusy(true);
          setTimeout(() => setBusy(false), 1200);
        }}
      >
        <RefreshCw size={14} className={busy ? "spinner" : undefined} />
      </button>
    </>
  );
}

/** Detailed page (Providers → 使用量): all Providers as cards with their source. */
export function UsagePage({
  entries = usage,
  display = "remaining",
}: {
  entries?: UsageEntry[];
  display?: UsageDisplay;
}) {
  return (
    <Display.Provider value={display}>
      <div className="usage-page">
        <div className="usage-page-heading">
          <div>
            <h1>使用量</h1>
            <p className="muted page-description">
              接続中のProviderから取得できる残量・残高を表示します。取得経路がないProviderは表示しません。
            </p>
          </div>
          <Refresh />
        </div>
        <div className="usage-grid">
          {byUrgency(fetchable(entries)).map((entry) => (
            <Entry key={entry.key} entry={entry} detailed />
          ))}
        </div>
      </div>
    </Display.Provider>
  );
}
