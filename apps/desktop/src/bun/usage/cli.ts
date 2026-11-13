import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ansiRegex from "ansi-regex";
import type { UsageData, UsageWindow } from "../../shared/provider-usage";
import {
  array,
  nonempty,
  number,
  object,
  timestamp,
  UsageError,
} from "./contracts";
import { usageProcess } from "./process";

export interface UsageCommand {
  provider: string;
  command: string;
  args: readonly string[];
  label: string;
  parse(output: string): UsageData;
}
/** Fixed, read-only commands only. Never supplies a prompt, logs in or accepts trust. */
export const usageCommands: readonly UsageCommand[] = [
  {
    provider: "meta",
    command: "muse",
    label: "Meta Muse CLI",
    args: ["usage", "--json"],
    parse: parseQuotaJson,
  },
  {
    provider: "qwen-token-plan",
    command: "bl",
    label: "Qwen CLI",
    args: ["usage", "token-plan", "--output", "json"],
    parse: parseQuotaJson,
  },
];

export function parseQuotaJson(output: string): UsageData {
  let parsed: unknown;
  try {
    parsed = JSON.parse(output);
  } catch {
    throw new UsageError("format");
  }
  const root = object(parsed);
  const body = Object.keys(object(root.data)).length ? object(root.data) : root;
  if (body.hasQuotaData === false) throw new UsageError("unavailable");
  const windows: UsageWindow[] = [];
  const add = (id: string, value: unknown) => {
    const row = object(value);
    const used = number(
      row.usedPercent ?? row.used_percent ?? row.usage_percentage,
    );
    if (used === undefined || used < 0) return;
    const mins = number(row.windowDurationMins ?? row.window_minutes);
    windows.push({
      id,
      label: id,
      usedPercent: used,
      resetsAt: timestamp(row.resetsAt ?? row.resetAt ?? row.resets_at),
      durationMs: mins && mins > 0 ? mins * 60_000 : undefined,
    });
  };
  for (const [index, window] of array(body.windows).entries()) {
    const row = object(window);
    add(typeof row.label === "string" ? row.label : String(index), row);
  }
  // Muse's subscription response retains independent window/weekly buckets.
  for (const [id, value] of Object.entries(object(body.subs_usage)))
    add(id, value);
  return nonempty({ windows, balances: [] });
}
export function parseClaudeCli(output: string): UsageData {
  const text = output.replace(ansiRegex(), "");
  const windows: UsageWindow[] = [];
  for (const [id, label, duration, pattern] of [
    [
      "five_hour",
      "5h",
      18_000_000,
      /Current session\b([\s\S]*?)(?=Current week|Extra usage|$)/i,
    ],
    [
      "seven_day",
      "7d",
      604_800_000,
      /Current week(?:\s*\(all models\))?\s*\n([\s\S]*?)(?=Current week|Extra usage|$)/i,
    ],
  ] as const) {
    const section = text.match(pattern)?.[1];
    const percent = section?.match(/(\d+(?:\.\d+)?)\s*%\s*(used|remaining)/i);
    if (!percent) continue;
    const value = Number(percent[1]);
    if (value < 0 || value > 100) continue;
    windows.push({
      id,
      label,
      usedPercent:
        percent[2].toLowerCase() === "remaining" ? 100 - value : value,
      durationMs: duration,
    });
  }
  // Reset strings depend on CLI locale/timezone. Do not fabricate timestamps.
  return nonempty({ windows, balances: [] });
}

/** Fixed usage commands run in a disposable directory, without touching project settings. */
export async function runUsageCommand(
  path: string,
  args: readonly string[],
  signal: AbortSignal,
) {
  const cwd = await mkdtemp(join(tmpdir(), "pig-usage-"));
  try {
    const argv = [...args];
    const settings = argv.indexOf("--settings");
    if (settings >= 0 && argv[settings + 1]?.startsWith("{")) {
      const file = join(cwd, "settings.json");
      await writeFile(file, argv[settings + 1], { mode: 0o600 });
      argv[settings + 1] = file;
    }
    return await usageProcess(path, argv, cwd, signal);
  } finally {
    await rm(cwd, { recursive: true, force: true }).catch(() => {});
  }
}
