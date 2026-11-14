import {
  ChevronDown,
  CircleAlert,
  Clock3,
  LoaderCircle,
  RefreshCw,
} from "lucide-react";
import {
  type FocusEvent,
  type PointerEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import {
  balanceText,
  clampPercent,
  type ProviderUsage,
  resetCountdown,
  shortUsageLabels,
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
/** Shortest window first so ring order means the same on every row. */
function ringWindows(entry: ProviderUsage) {
  return [...(entry.data?.windows ?? [])]
    .sort(
      (a, b) =>
        (a.durationMs ?? Number.POSITIVE_INFINITY) -
        (b.durationMs ?? Number.POSITIVE_INFINITY),
    )
    .slice(0, 2);
}
/** Each ring carries its own reset; "2h 13m" vs "11/18" tells the windows apart. */
function Reset({ window, now }: { window: UsageWindow; now: number }) {
  const reset =
    window.resetsAt !== undefined ? resetCountdown(window.resetsAt, now) : "—";
  const [month, day] = reset.split("/");
  return (
    <span
      className="provider-usage-reset"
      data-date={!!day || undefined}
      data-level={usageLevel(window.usedPercent)}
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
  );
}
/**
 * One details popover per dock (docs/ui-guidelines.md 「情報量の多いホバー表示」):
 * moving between rows swaps its content instead of stacking popovers. Top layer
 * so the sidebar's overflow can't clip it; a short close delay lets the pointer
 * cross into it. Like ActionsMenu, list scroll and window resize close it.
 */
function useUsagePopover() {
  const id = useId();
  const panel = useRef<HTMLDivElement>(null);
  const anchor = useRef<HTMLElement | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [active, setActive] = useState<string>();
  const close = useCallback(() => {
    clearTimeout(timer.current);
    anchor.current = null;
    setActive(undefined);
  }, []);
  const open = (key: string, row: HTMLElement) => {
    clearTimeout(timer.current);
    anchor.current = row;
    setActive(key);
  };
  const leave = () => {
    clearTimeout(timer.current);
    timer.current = setTimeout(close, 150);
  };
  useEffect(() => () => clearTimeout(timer.current), []);
  useLayoutEffect(() => {
    const popup = panel.current;
    const row = anchor.current;
    if (!active || !popup || !row) return;
    const position = () => {
      const box = row.getBoundingClientRect();
      const { width, height } = popup.getBoundingClientRect();
      const right = box.right + 8;
      const left =
        right + width <= innerWidth - 8 ? right : box.left - width - 8;
      popup.style.left = `${Math.max(8, Math.min(left, innerWidth - width - 8))}px`;
      popup.style.top = `${Math.max(8, Math.min(box.top, innerHeight - height - 8))}px`;
    };
    if (!popup.matches(":popover-open")) popup.showPopover();
    position();
    // Pointer popovers close on scroll like ActionsMenu; a keyboard-focused
    // row scrolls itself into view, so its popover follows instead.
    const scroll = () => (row.matches(":focus-visible") ? position() : close());
    const dismiss = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    const list = row.closest(".provider-usage-list");
    list?.addEventListener("scroll", scroll);
    window.addEventListener("resize", close);
    document.addEventListener("keydown", dismiss);
    return () => {
      list?.removeEventListener("scroll", scroll);
      window.removeEventListener("resize", close);
      document.removeEventListener("keydown", dismiss);
    };
  }, [active, close]);
  return {
    active,
    rowProps: (key: string) => ({
      "aria-describedby": active === key ? id : undefined,
      onPointerEnter: (event: PointerEvent<HTMLElement>) =>
        open(key, event.currentTarget),
      onPointerLeave: leave,
      // Keyboard focus only: a mouse click must not pin the popover open.
      onFocus: (event: FocusEvent<HTMLElement>) => {
        if (event.currentTarget.matches(":focus-visible"))
          open(key, event.currentTarget);
      },
      onBlur: leave,
    }),
    render: (content: ReactNode) =>
      active && (
        <div
          ref={panel}
          id={id}
          role="tooltip"
          popover="manual"
          className="usage-popover"
          onPointerEnter={() => clearTimeout(timer.current)}
          onPointerLeave={leave}
        >
          {content}
        </div>
      ),
  };
}
function UsageDetails({
  entry,
  display,
  mode,
  problem,
}: {
  entry: ProviderUsage;
  display: UsageDisplay;
  mode: string;
  problem?: string;
}) {
  const t = useT();
  return (
    <>
      <div className="usage-popover-heading">
        <ProviderIcon provider={entry.provider} size={14} />
        <strong>{entry.label}</strong>
      </div>
      {entry.status === "loading" && !entry.data && (
        <p className="usage-popover-note">{t.usageLoading}</p>
      )}
      {problem && (
        <p className="usage-popover-note" data-problem>
          <CircleAlert size={12} aria-hidden="true" />
          {problem}
        </p>
      )}
      {ringWindows(entry)
        .concat(entry.data?.windows.slice(2) ?? [])
        .map((window) => {
          const percent = usagePercent(window.usedPercent, display);
          return (
            <div
              key={window.id}
              className="usage-popover-window"
              data-level={usageLevel(window.usedPercent)}
            >
              <div className="usage-popover-figures">
                <span>{window.label}</span>
                <span>
                  <small>{mode}</small> <strong>{Math.round(percent)}%</strong>
                </span>
              </div>
              <div className="usage-popover-track" aria-hidden="true">
                <span style={{ width: `${clampPercent(percent)}%` }} />
              </div>
              {window.resetsAt !== undefined && (
                <div className="usage-popover-reset">
                  <Clock3 size={11} aria-hidden="true" />
                  <span>{t.usageResets}</span>
                  <time dateTime={new Date(window.resetsAt).toISOString()}>
                    {new Date(window.resetsAt).toLocaleString(undefined, {
                      month: "numeric",
                      day: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </time>
                </div>
              )}
            </div>
          );
        })}
      {entry.data?.balances.map((balance) => (
        <div className="usage-popover-figures" key={balance.label}>
          <span>{balance.label}</span>
          <strong>{balanceText(balance)}</strong>
        </div>
      ))}
      {entry.data?.details?.map((detail) => (
        <p className="usage-popover-note" key={detail}>
          {detail}
        </p>
      ))}
    </>
  );
}
function tooltip(
  entry: ProviderUsage,
  display: UsageDisplay,
  mode: string,
  problem?: string,
) {
  const lines = [entry.label];
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
  const popover = useUsagePopover();
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
  const names = shortUsageLabels(sorted);
  const activeEntry = sorted.find((entry) => entry.key === popover.active);
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
            const windows = ringWindows(entry);
            const balance = entry.data?.balances[0];
            const problem = entry.problem && problems[entry.problem];
            const detail = tooltip(entry, display, mode, problem);
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
                data-active={popover.active === entry.key || undefined}
                // biome-ignore lint/a11y/noNoninteractiveTabindex: rows reveal details on keyboard focus
                tabIndex={0}
                aria-label={detail}
                {...popover.rowProps(entry.key)}
              >
                <ProviderIcon provider={entry.provider} size={12} />
                <span className="provider-usage-name">
                  {names.get(entry.key)}
                </span>
                {windows.length ? (
                  windows.map((w) => (
                    <span key={w.id} className="provider-usage-window">
                      <UsageRing window={w} now={now} display={display} />
                      <Reset window={w} now={now} />
                    </span>
                  ))
                ) : (
                  <span
                    className="provider-usage-value"
                    data-balance={!!balance || undefined}
                  >
                    {balance ? (
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
                )}
              </li>
            );
          })}
        </ul>
      )}
      {!collapsed &&
        popover.render(
          activeEntry && (
            <UsageDetails
              entry={activeEntry}
              display={display}
              mode={mode}
              problem={activeEntry.problem && problems[activeEntry.problem]}
            />
          ),
        )}
    </section>
  );
}
