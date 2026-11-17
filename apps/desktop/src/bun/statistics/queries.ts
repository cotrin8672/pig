import type { Database } from "bun:sqlite";
import {
  type ShellCommandStatistics,
  type StatisticsData,
  type StatisticsPeriod,
  type TokenSplit,
  validateStatisticsPeriod,
} from "../../shared/statistics";
import { number, object } from "./normalize";

const zero = (): TokenSplit => ({
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
});
const dayKey = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

/** Local calendar boundaries, not 24h arithmetic: includes DST transitions. */
export function statisticsRange(period: StatisticsPeriod, now = Date.now()) {
  validateStatisticsPeriod(period);
  const end = new Date(now);
  end.setHours(24, 0, 0, 0);
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  start.setDate(
    start.getDate() -
      (period === "all"
        ? 364
        : period === "30d"
          ? 29
          : period === "7d"
            ? 6
            : 0),
  );
  return { start: start.getTime(), end: end.getTime() };
}

type UsageRow = {
  provider: string | null;
  model: string | null;
  purpose: string;
  input: number | null;
  output: number | null;
  cache_read: number | null;
  cache_write: number | null;
  requests: number;
  speed: number | null;
  measured: number;
  unknown: number;
};
const modelId = (r: Pick<UsageRow, "provider" | "model" | "purpose">) =>
  JSON.stringify([r.provider, r.model, r.model ? null : r.purpose]);

/** All SQL executes on the statistics worker. Only aggregates cross the boundary. */
export function queryStatistics(
  db: Database,
  period: StatisticsPeriod,
  now = Date.now(),
): StatisticsData {
  const range = statisticsRange(period, now);
  const bounds = db.query("SELECT min(at) AS first FROM events").get() as {
    first: number | null;
  };
  const start =
    period === "all" && bounds.first !== null
      ? Math.max(range.start, bounds.first)
      : range.start;
  const days: string[] = [];
  const date = new Date(start);
  date.setHours(0, 0, 0, 0);
  while (date.getTime() < range.end && days.length < 366) {
    days.push(dayKey(date));
    date.setDate(date.getDate() + 1);
  }
  const rows = db
    .query(`
    SELECT provider, model, CASE WHEN model IS NULL THEN purpose ELSE '' END AS purpose,
      sum(input) AS input, sum(output) AS output, sum(cache_read) AS cache_read,
      sum(cache_write) AS cache_write, count(*) AS requests,
      avg(CASE WHEN purpose = 'conversation' AND duration_ms > 0 AND output IS NOT NULL
        AND json_extract(data, '$.stopReason') IN ('stop', 'length', 'toolUse')
        THEN output * 1000.0 / duration_ms END) AS speed,
      sum(CASE WHEN purpose = 'conversation' AND duration_ms > 0 AND output IS NOT NULL
        AND json_extract(data, '$.stopReason') IN ('stop', 'length', 'toolUse') THEN 1 ELSE 0 END) AS measured,
      sum(CASE WHEN input IS NULL OR output IS NULL OR cache_read IS NULL OR cache_write IS NULL THEN 1 ELSE 0 END) AS unknown
    FROM model_requests WHERE at >= ? AND at < ?
    GROUP BY provider, model, CASE WHEN model IS NULL THEN purpose ELSE '' END
    ORDER BY coalesce(sum(input),0) + coalesce(sum(output),0) + coalesce(sum(cache_read),0) + coalesce(sum(cache_write),0) DESC
  `)
    .all(start, range.end) as UsageRow[];
  const models = rows.map((r) => ({
    id: modelId(r),
    name: r.model ?? `(${r.purpose || "unknown"})`,
    tokens: {
      input: r.input ?? 0,
      output: r.output ?? 0,
      cacheRead: r.cache_read ?? 0,
      cacheWrite: r.cache_write ?? 0,
    },
    requests: r.requests,
    tokensPerSecond: r.speed,
    measuredRequests: r.measured,
  }));
  const daily = Object.fromEntries(models.map((m) => [m.id, days.map(zero)]));
  const buckets = db
    .query(`
    SELECT provider, model, CASE WHEN model IS NULL THEN purpose ELSE '' END AS purpose,
      date(at / 1000, 'unixepoch', 'localtime') AS day,
      sum(input) AS input, sum(output) AS output, sum(cache_read) AS cache_read, sum(cache_write) AS cache_write
    FROM model_requests WHERE at >= ? AND at < ?
    GROUP BY provider, model, CASE WHEN model IS NULL THEN purpose ELSE '' END, day
  `)
    .all(start, range.end) as (UsageRow & { day: string })[];
  for (const b of buckets) {
    const index = days.indexOf(b.day);
    if (index >= 0 && daily[modelId(b)])
      daily[modelId(b)][index] = {
        input: b.input ?? 0,
        output: b.output ?? 0,
        cacheRead: b.cache_read ?? 0,
        cacheWrite: b.cache_write ?? 0,
      };
  }
  const toolRows = db
    .query(`
    SELECT json_extract(data, '$.tool') AS tool, count(*) AS calls,
      sum(CASE WHEN json_extract(data, '$.isError') = 1 THEN 1 ELSE 0 END) AS failures
    FROM events WHERE type = 'tool_execution_end' AND at >= ? AND at < ?
      AND json_type(data, '$.isError') IN ('true', 'false')
      AND json_type(data, '$.tool') = 'text'
    GROUP BY tool ORDER BY calls DESC, tool
  `)
    .all(start, range.end) as {
    tool: string;
    calls: number;
    failures: number;
  }[];
  // Outcome from the structured exit code; `isError` stays a separate count.
  const commandRows = db
    .query(`
    SELECT shell, command, count(*) AS calls,
      sum(outcome = 'failure') AS failures, sum(outcome = 'unknown') AS unknown,
      sum(is_error) AS sdkErrors,
      sum(CASE WHEN outcome = 'failure' THEN coalesce(bytes, 0) ELSE 0 END) AS failureBytes
    FROM (
      SELECT shell, command, is_error, bytes, CASE
        WHEN exit_type IS NOT 'integer' THEN 'unknown'
        WHEN exit_code = 0 THEN 'success'
        WHEN command = 'rg' AND exit_code = 1 AND shell = 'bash' THEN 'success'
        WHEN command = 'rg' AND exit_code = 1 THEN 'unknown'
        ELSE 'failure' END AS outcome
      FROM (
        SELECT json_extract(data, '$.tool') AS shell,
          json_extract(data, '$.shellCommandKey') AS command,
          json_type(data, '$.exitCode') AS exit_type,
          json_extract(data, '$.exitCode') AS exit_code,
          coalesce(json_extract(data, '$.isError') = 1, 0) AS is_error,
          json_extract(data, '$.textBytes') AS bytes
        FROM events WHERE type = 'tool_execution_end' AND at >= ? AND at < ?
          AND json_extract(data, '$.tool') IN ('bash', 'powershell')))
    GROUP BY shell, command
  `)
    .all(start, range.end) as (Omit<ShellCommandStatistics, "command"> & {
    command: string | null;
  })[];
  const commands: StatisticsData["commands"] = {
    rows: [],
    unclassified: 0,
    unmeasured: 0,
  };
  for (const { command, ...row } of commandRows) {
    if (command === null) commands.unmeasured += row.calls;
    else if (command === "unclassified") commands.unclassified += row.calls;
    else commands.rows.push({ ...row, command });
  }
  commands.rows.sort(
    (a, b) =>
      b.failures - a.failures ||
      b.failureBytes - a.failureBytes ||
      b.calls - a.calls,
  );
  const contextRow = db
    .query(`
    SELECT data FROM events WHERE type = 'initial_context' AND at >= ? AND at < ? ORDER BY at DESC LIMIT 1
  `)
    .get(start, range.end) as { data: string } | null;
  type Context = {
    parts: { id: string; label: string; tokens: number }[];
    sections: { id: string; tokens: number }[];
    tools: { name: string; tokens: number; source: string | null }[];
    contextWindow: number | null;
  };
  let context: Context | null = null;
  try {
    const parsed = object(contextRow ? JSON.parse(contextRow.data) : null);
    if (Array.isArray(parsed.parts) && Array.isArray(parsed.tools)) {
      const parts: Context["parts"] = [];
      const tools: Context["tools"] = [];
      for (const value of parsed.parts) {
        const part = object(value);
        const tokens = number(part.tokens);
        if (
          typeof part.id === "string" &&
          tokens !== null &&
          [
            "base",
            "toolPrompts",
            "tools",
            "agents",
            "skills",
            "extensions",
            "other",
          ].includes(part.id)
        )
          parts.push({ id: part.id, label: part.id, tokens });
      }
      for (const value of parsed.tools) {
        const tool = object(value);
        const tokens = number(tool.tokens);
        if (typeof tool.name === "string" && tokens !== null)
          tools.push({
            name: tool.name,
            tokens,
            source: typeof tool.source === "string" ? tool.source : null,
          });
      }
      const sections: Context["sections"] = [];
      for (const value of Array.isArray(parsed.sections)
        ? parsed.sections
        : []) {
        const section = object(value);
        const tokens = number(section.tokens);
        if (typeof section.id === "string" && tokens !== null)
          sections.push({ id: section.id, tokens });
      }
      const window = number(parsed.contextWindow);
      context = {
        parts,
        sections,
        tools,
        contextWindow: window && window > 0 ? window : null,
      };
    }
  } catch {
    // A damaged snapshot must not prevent querying the usage ledger.
  }
  const tools = toolRows.map((r) => ({
    ...r,
    definitionTokens:
      context?.tools.find((t) => t.name === r.tool)?.tokens ?? null,
  }));
  for (const t of context?.tools ?? [])
    if (!tools.some((r) => r.tool === t.name))
      tools.push({
        tool: t.name,
        calls: 0,
        failures: 0,
        definitionTokens: t.tokens,
      });
  const sources = new Map<
    string | null,
    StatisticsData["initialContext"]["sources"][number]
  >();
  for (const { name, tokens, source } of context?.tools ?? []) {
    const group = sources.get(source) ?? { id: source, tokens: 0, tools: [] };
    group.tokens += tokens;
    group.tools.push({ name, tokens });
    sources.set(source, group);
  }
  for (const group of sources.values())
    group.tools.sort((a, b) => b.tokens - a.tokens);
  const dropped = db
    .query("SELECT value FROM collection_state WHERE key = 'dropped'")
    .get() as { value: number } | null;
  return {
    collectingSince:
      bounds.first === null ? null : dayKey(new Date(bounds.first)),
    days,
    daily,
    models,
    tools,
    commands,
    initialContext: {
      parts: context?.parts ?? [],
      sections: context?.sections ?? [],
      sources: [...sources.values()].sort((a, b) => b.tokens - a.tokens),
      measuredTotal: null,
      contextWindow: context?.contextWindow ?? null,
    },
    coverage: {
      unknownUsage: rows.reduce((n, r) => n + r.unknown, 0),
      dropped: dropped?.value ?? 0,
      collection: "active",
    },
  };
}
