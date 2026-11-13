import {
  ChevronDown,
  CircleAlert,
  LoaderCircle,
  RefreshCw,
} from "lucide-react";
import { useEffect, useState } from "react";
import {
  balanceText,
  clampPercent,
  headlineWindow,
  observationAge,
  type ProviderUsage,
  resetCountdown,
  sortUsage,
  timeRemaining,
  USAGE_REFRESH_COOLDOWN_MS,
  type UsageDisplay,
  type UsageWindow,
  usageLevel,
  usagePercent,
} from "../shared/provider-usage";
import { useT } from "./i18n";
import { ProviderIcon } from "./ProviderIcon";
import "./provider-usage.css";

export function UsageRing({
  window,
  display,
  now,
}: {
  window: UsageWindow;
  display: UsageDisplay;
  now: number;
}) {
  const time = timeRemaining(window, now);
  const quota = clampPercent(usagePercent(window.usedPercent, display));
  return (
    <svg
      className="provider-usage-ring"
      viewBox="0 0 18 18"
      width="18"
      height="18"
      aria-hidden="true"
      data-level={usageLevel(window.usedPercent)}
    >
      <circle className="usage-ring-track" cx="9" cy="9" r="7.8" />
      {time !== undefined && (
        <circle
          className="usage-ring-time"
          cx="9"
          cy="9"
          r="7.8"
          pathLength="100"
          strokeDasharray={`${time} 100`}
          transform="rotate(-90 9 9) translate(0 18) scale(1 -1)"
        />
      )}
      <circle className="usage-ring-track" data-inner cx="9" cy="9" r="4.2" />
      <circle
        className="usage-ring-quota"
        cx="9"
        cy="9"
        r="4.2"
        pathLength="100"
        strokeDasharray={`${quota} 100`}
        transform="rotate(-90 9 9) translate(0 18) scale(1 -1)"
      />
    </svg>
  );
}
function tooltip(
  entry: ProviderUsage,
  display: UsageDisplay,
  now: number,
  mode: string,
  problem?: string,
) {
  const lines = [
    entry.label,
    `${entry.source}${entry.observedAt ? ` · ${observationAge(entry.observedAt, now)}` : ""}`,
  ];
  if (problem) lines.push(problem);
  for (const window of entry.data?.windows ?? [])
    lines.push(
      `${window.label}: ${mode} ${Math.round(usagePercent(window.usedPercent, display))}%${window.resetsAt ? ` · ${new Date(window.resetsAt).toLocaleString()}` : ""}`,
    );
  for (const balance of entry.data?.balances ?? [])
    lines.push(`${balance.label}: ${balance.currency} ${balance.amount}`);
  lines.push(...(entry.data?.details ?? []));
  return lines.join("\n");
}
export function ProviderUsageView({
  entries,
  display = "remaining",
  now = Date.now(),
  refreshing = false,
  onRefresh,
}: {
  entries: ProviderUsage[];
  display?: UsageDisplay;
  now?: number;
  refreshing?: boolean;
  onRefresh?: () => void;
}) {
  const t = useT();
  const [collapsed, setCollapsed] = useState(false);
  const [coolingDown, setCoolingDown] = useState(false);
  useEffect(() => {
    if (!coolingDown || refreshing) return;
    const timer = setTimeout(
      () => setCoolingDown(false),
      USAGE_REFRESH_COOLDOWN_MS,
    );
    return () => clearTimeout(timer);
  }, [coolingDown, refreshing]);
  if (!entries.length) return null;
  const mode = display === "remaining" ? t.Remaining : t.Used;
  const problems = {
    auth: t.usageAuth,
    permission: t.usagePermission,
    "rate-limit": t.usageRateLimit,
    network: t.usageNetwork,
    format: t.usageFormat,
    unavailable: t.usageUnavailable,
  };
  const sorted = sortUsage(entries);
  return (
    <section className="provider-usage-card" aria-label={t.usageTitle}>
      <div className="provider-usage-heading">
        <button
          type="button"
          className="provider-usage-toggle"
          aria-expanded={!collapsed}
          onClick={() => setCollapsed(!collapsed)}
        >
          <ChevronDown size={11} aria-hidden="true" />
          <span>{t.usageTitle}</span>
        </button>
        <button
          type="button"
          className="provider-usage-refresh"
          aria-label={t.usageRefresh}
          title={t.usageRefresh}
          disabled={refreshing || coolingDown || !onRefresh}
          onClick={() => {
            setCoolingDown(true);
            onRefresh?.();
          }}
        >
          <RefreshCw
            size={11}
            className={refreshing ? "spinner" : undefined}
            aria-hidden="true"
          />
        </button>
      </div>
      {!collapsed && (
        <ul className="provider-usage-list">
          {sorted.map((entry) => {
            const window = headlineWindow(entry);
            const balance = entry.data?.balances[0];
            const problem = entry.problem && problems[entry.problem];
            const detail = tooltip(entry, display, now, mode, problem);
            const reset =
              window?.resetsAt !== undefined
                ? resetCountdown(window.resetsAt, now)
                : "—";
            const [month, day] = reset.split("/");
            return (
              <li
                key={entry.key}
                className="provider-usage-row"
                data-stale={
                  entry.status === "error" ||
                  (entry.observedAt !== undefined &&
                    now - entry.observedAt > 600_000) ||
                  undefined
                }
                title={detail}
                aria-label={detail}
              >
                <ProviderIcon provider={entry.provider} size={12} />
                <span className="provider-usage-name">{entry.label}</span>
                <span className="provider-usage-rings">
                  {entry.data?.windows.slice(0, 2).map((w) => (
                    <UsageRing
                      key={w.id}
                      window={w}
                      now={now}
                      display={display}
                    />
                  ))}
                </span>
                <span
                  className="provider-usage-value"
                  data-level={
                    window ? usageLevel(window.usedPercent) : undefined
                  }
                  data-balance={(!window && !!balance) || undefined}
                >
                  {window ? (
                    `${Math.round(usagePercent(window.usedPercent, display))}%`
                  ) : balance ? (
                    balanceText(balance)
                  ) : entry.status === "loading" ? (
                    <LoaderCircle
                      size={11}
                      className="spinner"
                      aria-label={t.usageLoading}
                    />
                  ) : (
                    <CircleAlert size={11} aria-label={problem} />
                  )}
                </span>
                {window && (
                  <span
                    className="provider-usage-reset"
                    data-date={!!day || undefined}
                  >
                    {day ? (
                      <>
                        <span>{month}</span>
                        <span>/</span>
                        <span>{day}</span>
                      </>
                    ) : (
                      reset
                    )}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
