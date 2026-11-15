import type { StatisticValue } from "./contracts";

export function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function number(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : null;
}

function signed(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value)
    ? value
    : null;
}

export function usageMetadata(value: unknown): Record<string, StatisticValue> {
  const usage = object(value);
  const cost = object(usage.cost);
  return {
    input: number(usage.input),
    output: number(usage.output),
    cacheRead: number(usage.cacheRead),
    cacheWrite: number(usage.cacheWrite),
    cacheWrite1h: number(usage.cacheWrite1h),
    reasoning: number(usage.reasoning),
    totalTokens: number(usage.totalTokens),
    costInput: number(cost.input),
    costOutput: number(cost.output),
    costCacheRead: number(cost.cacheRead),
    costCacheWrite: number(cost.cacheWrite),
    costTotal: number(cost.total),
    costSource:
      cost.totalFromProvider === true
        ? "provider"
        : Object.keys(cost).length
          ? "catalog"
          : "unknown",
    currency: "USD",
    // SDK adapters may initialize usage to zero before receiving any usage.
    usageEvidence: Object.keys(usage).length ? "sdk-normalized" : "missing",
    reportingCoverage: "provider-report-presence-unknown",
  };
}

/** Only counts text; no image bytes, signatures, arguments or output text escape. */
export function contentMetadata(
  value: unknown,
): Record<string, StatisticValue> {
  if (typeof value === "string")
    return {
      textBytes: Buffer.byteLength(value),
      thinkingBytes: 0,
      blocks: 1,
      images: 0,
    };
  let textBytes = 0;
  let thinkingBytes = 0;
  let images = 0;
  const blocks = Array.isArray(value) ? value : [];
  for (const block of blocks) {
    const item = object(block);
    if (typeof item.text === "string")
      textBytes += Buffer.byteLength(item.text);
    if (typeof item.thinking === "string")
      thinkingBytes += Buffer.byteLength(item.thinking);
    if (item.type === "image") images++;
  }
  return { textBytes, thinkingBytes, blocks: blocks.length, images };
}

/** Extract only documented scalar metadata. Never serialize arbitrary details. */
export function toolMetadata(
  tool: string,
  value: unknown,
): Record<string, StatisticValue> {
  const result = object(value);
  const details = object(result.details);
  const truncation = object(details.truncation);
  const output = object(result.structuredContent);
  const shell = tool === "bash" || tool === "powershell";
  return {
    ...contentMetadata(result.content),
    exitCode: shell ? signed(output.exit_code ?? details.exitCode) : null,
    wallTimeSeconds: shell ? number(output.wall_time_seconds) : null,
    truncated:
      typeof truncation.truncated === "boolean"
        ? truncation.truncated
        : typeof output.truncated === "boolean"
          ? output.truncated
          : null,
    originalBytes: number(truncation.totalBytes),
    retainedBytes: number(truncation.outputBytes),
    originalLines: number(truncation.totalLines),
    retainedLines: number(truncation.outputLines),
    hasFullOutput: typeof details.fullOutputPath === "string",
  };
}
