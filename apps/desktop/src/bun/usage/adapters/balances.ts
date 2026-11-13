import type {
  UsageBalance,
  UsageData,
  UsageWindow,
} from "../../../shared/provider-usage";
import { array, decimal, number, object, timestamp } from "../contracts";

export function deepseekUsage(value: unknown): UsageData {
  const balances = array(object(value).balance_infos).flatMap(
    (item): UsageBalance[] => {
      const row = object(item);
      const amount = decimal(row.total_balance);
      return amount !== undefined && typeof row.currency === "string"
        ? [{ label: "Balance", amount, currency: row.currency }]
        : [];
    },
  );
  return { windows: [], balances };
}
export function moonshotUsage(value: unknown, currency: string): UsageData {
  const amount = decimal(object(object(value).data).available_balance);
  return {
    windows: [],
    balances:
      amount === undefined ? [] : [{ label: "Balance", amount, currency }],
  };
}
export function vercelUsage(value: unknown): UsageData {
  const body = object(value);
  const amount = decimal(body.balance);
  const details: string[] = [];
  const pass = object(body.token_pass);
  const remaining = decimal(pass.remaining);
  if (remaining !== undefined) details.push(`Token Pass: ${remaining} USD`);
  return {
    windows: [],
    balances:
      amount === undefined
        ? []
        : [{ label: "Balance", amount, currency: "USD" }],
    details,
  };
}
export function openrouterUsage(value: unknown): UsageData {
  const row = object(object(value).data);
  const amount = decimal(row.limit_remaining);
  return {
    windows: [],
    balances:
      amount === undefined
        ? []
        : [
            {
              label: "Key budget (not account balance)",
              amount,
              currency: "USD",
            },
          ],
  };
}
export function minimaxUsage(value: unknown, currency: string): UsageData {
  const root = object(value);
  const body = root.data ? object(root.data) : root;
  const amount = decimal(body.balance ?? body.available_balance);
  if (amount !== undefined)
    return { windows: [], balances: [{ label: "Balance", amount, currency }] };
  const windows: UsageWindow[] = [];
  for (const item of array(body.model_remains)) {
    const row = object(item);
    const model =
      typeof row.model_name === "string" ? row.model_name : "Token Plan";
    for (const [prefix, label, reset, duration] of [
      ["current_interval", "interval", row.end_time, undefined],
      ["current_weekly", "week", row.current_weekly_end_time, 604800000],
    ] as const) {
      const total = number(row[`${prefix}_total_count`]);
      const count = number(row[`${prefix}_usage_count`]);
      const percent = number(row[`${prefix}_remaining_percent`]);
      if (
        !total ||
        total <= 0 ||
        count === undefined ||
        count < 0 ||
        count > total
      )
        continue;
      // Official MiniMax CLI: legacy usage_count is REMAINING, newer may be USED.
      const legacy = (count / total) * 100;
      const consumed = 100 - legacy;
      let left = legacy;
      if (percent !== undefined) {
        if (
          Math.min(Math.abs(percent - legacy), Math.abs(percent - consumed)) > 1
        )
          continue;
        left = percent;
      }
      windows.push({
        id: `${model}/${prefix}`,
        label: `${model} / ${label}`,
        usedPercent: 100 - left,
        resetsAt: timestamp(reset),
        durationMs: duration,
      });
    }
  }
  return { windows, balances: [] };
}
export function zaiUsage(value: unknown): UsageData {
  const windows: UsageWindow[] = [];
  for (const item of array(object(object(value).data).limits)) {
    const row = object(item);
    const used = number(row.percentage);
    if (typeof row.type !== "string" || used === undefined || used < 0)
      continue;
    // Unknown units/windows are not called "5h" or given an invented reset duration.
    windows.push({
      id: row.type,
      label: row.type,
      usedPercent: used,
      resetsAt: timestamp(row.nextResetTime),
    });
  }
  return { windows, balances: [] };
}
export function radiusBalance(value: unknown): UsageData {
  const body = object(value);
  const amount = decimal(object(body.balance).available);
  return {
    windows: [],
    balances:
      amount === undefined || body.currency !== "USD"
        ? []
        : [
            {
              label: "Available (after reservations)",
              amount,
              currency: "USD",
            },
          ],
  };
}
