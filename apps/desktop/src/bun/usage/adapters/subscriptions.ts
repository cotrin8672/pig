import type { UsageData, UsageWindow } from "../../../shared/provider-usage";
import { array, number, object, timestamp } from "../contracts";

const HOUR = 3_600_000;
export function codexUsage(value: unknown): UsageData {
  const body = object(value);
  const windows: UsageWindow[] = [];
  const add = (prefix: string, limits: unknown) => {
    const row = object(limits);
    for (const id of ["primary_window", "secondary_window"] as const) {
      const window = object(row[id]);
      const used = number(window.used_percent);
      if (used === undefined || used < 0) continue;
      const seconds = number(window.limit_window_seconds);
      windows.push({
        id: `${prefix}/${id}`,
        label:
          seconds === 604800
            ? `${prefix} / 7d`
            : seconds === 18000
              ? `${prefix} / 5h`
              : `${prefix} / ${id}`,
        usedPercent: used,
        resetsAt: timestamp(window.reset_at),
        durationMs: seconds && seconds > 0 ? seconds * 1000 : undefined,
      });
    }
  };
  add("Codex", body.rate_limit);
  for (const entry of array(body.additional_rate_limits)) {
    const row = object(entry);
    const name =
      typeof row.limit_name === "string"
        ? row.limit_name
        : typeof row.limit_id === "string"
          ? row.limit_id
          : undefined;
    if (name) add(name, row.rate_limit);
  }
  const details: string[] = [];
  const tickets = number(object(body.rate_limit_reset_credits).available_count);
  if (tickets !== undefined) details.push(`Reset tickets: ${tickets}`);
  const credits = object(body.credits);
  if (
    typeof credits.balance === "string" ||
    typeof credits.balance === "number"
  )
    details.push(`Codex credits: ${credits.balance}`);
  return { windows, balances: [], details };
}
export function claudeUsage(value: unknown): UsageData {
  const body = object(value);
  const windows: UsageWindow[] = [];
  for (const [id, label, duration] of [
    ["five_hour", "5h", 5 * HOUR],
    ["seven_day", "7d", 7 * 24 * HOUR],
    ["seven_day_opus", "Opus / 7d", 7 * 24 * HOUR],
    ["seven_day_sonnet", "Sonnet / 7d", 7 * 24 * HOUR],
    ["seven_day_oauth_apps", "OAuth apps / 7d", 7 * 24 * HOUR],
  ] as const) {
    const row = object(body[id]);
    const used = number(row.utilization);
    if (used === undefined || used < 0) continue;
    windows.push({
      id,
      label,
      usedPercent: used,
      resetsAt: timestamp(row.resets_at),
      durationMs: duration,
    });
  }
  return { windows, balances: [] };
}
export function mistralUsage(value: unknown): UsageData {
  const row = object(object(value).vibe_budget);
  const used = number(row.usage_percentage);
  const initial = number(row.initial_budget);
  if (used === undefined || used < 0 || initial === undefined || initial <= 0)
    return { windows: [], balances: [] };
  return {
    windows: [
      {
        id: "vibe",
        label: "Vibe",
        usedPercent: used,
        resetsAt: timestamp(row.reset_at),
      },
    ],
    balances: [],
    details: row.payg_enabled === true ? ["PAYG"] : undefined,
  };
}
export function goUsage(value: unknown): UsageData {
  const body = object(value);
  const usage = object(body.usage);
  const windows: UsageWindow[] = [];
  for (const id of ["rolling", "weekly", "monthly"]) {
    const row = object(usage[id]);
    const used = number(row.percent);
    if (used !== undefined && used >= 0)
      windows.push({
        id,
        label: id,
        usedPercent: used,
        resetsAt: timestamp(row.resetsAt),
      });
  }
  return { windows, balances: [] };
}
export function copilotUsage(value: unknown): UsageData {
  const body = object(value);
  const windows: UsageWindow[] = [];
  const snapshots = object(body.quota_snapshots);
  for (const id of ["premium_interactions", "chat", "completions"]) {
    const row = object(snapshots[id]);
    // An unlimited seat/credits-only response has no known quota denominator.
    const left = number(row.percent_remaining);
    if (row.unlimited === true || left === undefined || left < 0 || left > 100)
      continue;
    windows.push({
      id,
      label: id,
      usedPercent: 100 - left,
      resetsAt: timestamp(body.quota_reset_date),
    });
  }
  return { windows, balances: [] };
}
export function kimiUsage(value: unknown): UsageData {
  const body = object(value);
  const windows: UsageWindow[] = [];
  const add = (id: string, value: unknown) => {
    if (!/5.?h|hour|week|month/i.test(id)) return;
    const row = object(value);
    const total = number(row.limit ?? row.total);
    const left = number(row.remaining ?? row.remains);
    const used = number(row.used ?? row.usage);
    const ratio = number(row.used_ratio ?? row.usedRatio);
    const remainingRatio = number(row.remaining_ratio ?? row.remainingRatio);
    const percent =
      ratio !== undefined
        ? ratio * 100
        : remainingRatio !== undefined
          ? (1 - remainingRatio) * 100
          : total && total > 0
            ? used !== undefined
              ? (used / total) * 100
              : left !== undefined
                ? (1 - left / total) * 100
                : undefined
            : undefined;
    if (percent !== undefined && percent >= 0)
      windows.push({
        id,
        label: id,
        usedPercent: percent,
        resetsAt: timestamp(row.reset_time ?? row.resetAt ?? row.resets_at),
      });
  };
  for (const name of ["limits", "usage", "usages"]) {
    const source = body[name];
    if (Array.isArray(source)) {
      for (const item of source) {
        const row = object(item);
        const id = row.window ?? row.name ?? row.period;
        if (typeof id === "string") add(id, row);
      }
    } else {
      for (const [id, row] of Object.entries(object(source))) add(id, row);
    }
  }
  return { windows, balances: [] };
}
