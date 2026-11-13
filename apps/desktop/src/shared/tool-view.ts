import type { TranscriptRecord } from "./transcript";

/** Pure helpers for rendering SDK tool calls in the transcript. */

export const SHELL_TOOLS = new Set(["bash", "powershell"]);
export const EXPLORE_TOOLS = new Set(["read", "grep", "find", "ls"]);

/** Joins the text blocks of a tool result (`{ content: [...] }`). */
export function resultText(result: unknown): string {
  if (!result || typeof result !== "object" || !("content" in result))
    return "";
  const { content } = result;
  if (!Array.isArray(content)) return "";
  return content
    .filter(
      (block): block is { type: "text"; text: string } =>
        block?.type === "text" && typeof block.text === "string",
    )
    .map((block) => block.text)
    .join("\n");
}

const EXIT_LINE = /\n*Command exited with code (\d+)\s*$/;

/** The shell tool appends "Command exited with code N" only on non-zero exits. */
export function shellOutcome(text: string): {
  output: string;
  exitCode?: number;
} {
  const match = EXIT_LINE.exec(text);
  return match
    ? { output: text.slice(0, match.index), exitCode: Number(match[1]) }
    : { output: text };
}

/** Counts lines of the SDK's display diff (`+12 text`, `-12 text`, ` 12 text`). */
export function diffStats(diff: string): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (let start = 0; start < diff.length; ) {
    if (diff[start] === "+") added++;
    else if (diff[start] === "-") removed++;
    const end = diff.indexOf("\n", start);
    if (end < 0) break;
    start = end + 1;
  }
  return { added, removed };
}

/**
 * Splits content blocks into runs; two or more consecutive exploration tool
 * calls form one run, everything else is a run of one.
 */
export function groupBlocks<B extends { type: string; name?: unknown }>(
  blocks: readonly B[],
): { start: number; blocks: B[] }[] {
  const runs: { start: number; blocks: B[] }[] = [];
  const explore = (block: B) =>
    block.type === "toolCall" &&
    typeof block.name === "string" &&
    EXPLORE_TOOLS.has(block.name);
  blocks.forEach((block, index) => {
    const last = runs.at(-1);
    // A run is homogeneous by construction; rescanning its growing prefix
    // makes a long parallel exploration batch quadratic.
    if (last && explore(block) && explore(last.blocks[0]))
      last.blocks.push(block);
    else runs.push({ start: index, blocks: [block] });
  });
  return runs;
}

export interface WorkRange {
  /** Stable id of the response (its first visible record). */
  key: string;
  first: number;
  /** The last assistant message; its text is the final answer. */
  final: number;
  tools: number;
}

const role = (record: TranscriptRecord) =>
  record.kind === "message" ? record.message.role : undefined;

/**
 * Maps every record index of a finished response that has intermediate work
 * (tool calls, thinking, earlier steps) to that response, so the UI can fold
 * the work and show only the final answer. The running response is left open.
 */
export function finishedWork(
  records: readonly TranscriptRecord[],
  running: boolean,
  visible: (record: TranscriptRecord) => boolean,
  from = 0,
): Map<number, WorkRange> {
  const result = new Map<number, WorkRange>();
  const close = (start: number, end: number) => {
    const shown: number[] = [];
    for (let i = start; i <= end; i++)
      if (visible(records[i]) && role(records[i]) !== "toolResult")
        shown.push(i);
    const final = [...shown]
      .reverse()
      .find((i) => role(records[i]) === "assistant");
    if (final === undefined) return;
    const message = records[final];
    if (message.kind !== "message" || message.message.role !== "assistant")
      return;
    const blocks = message.message.content;
    // Without a final answer there is nothing to show instead of the work.
    if (!blocks.some((block) => block.type === "text" && block.text.trim()))
      return;
    if (shown.length < 2 && blocks.every((block) => block.type === "text"))
      return;
    let tools = 0;
    for (const i of shown) {
      const record = records[i];
      if (record.kind === "message" && record.message.role === "assistant")
        for (const block of record.message.content)
          if (block.type === "toolCall") tools++;
    }
    const range = { key: records[shown[0]].id, first: shown[0], final, tools };
    for (let i = start; i <= end; i++) result.set(i, range);
  };
  let start = from;
  for (let index = from; index < records.length; index++) {
    if (role(records[index]) !== "user") continue;
    if (index > start) close(start, index - 1);
    start = index + 1;
  }
  if (!running && start < records.length) close(start, records.length - 1);
  return result;
}

/** Keep completed work ranges; only saved, unchanged records can form a reusable prefix. */
export function createFinishedWorkIndex(
  visible: (record: TranscriptRecord) => boolean,
) {
  const previous: (TranscriptRecord | undefined)[] = [];
  let previousRevision: string | undefined;
  let previousRunning = false;
  let ranges = new Map<number, WorkRange>();
  return (
    records: readonly TranscriptRecord[],
    running: boolean,
    revision?: string,
  ): ReadonlyMap<number, WorkRange> => {
    let shared = 0;
    if (revision !== undefined && revision === previousRevision)
      while (
        shared < records.length &&
        shared < previous.length &&
        !!records[shared].entryId &&
        records[shared] === previous[shared]
      )
        shared++;
    if (
      shared === records.length &&
      shared === previous.length &&
      running === previousRunning
    )
      return ranges;
    // A new user can finish the preceding response; restart at its user boundary.
    let from = shared;
    while (from > 0 && role(records[from - 1]) !== "user") from--;
    const suffix = finishedWork(records, running, visible, from);
    let changed = suffix.size > 0;
    if (!changed)
      for (const index of ranges.keys())
        if (index >= from) {
          changed = true;
          break;
        }
    if (changed)
      ranges = new Map([
        ...[...ranges].filter(([index]) => index < from),
        ...suffix,
      ]);
    // Do not retain mutable live entries, even if a caller later persists one in place.
    previous.length = shared;
    for (let index = shared; index < records.length; index++)
      previous.push(records[index].entryId ? records[index] : undefined);
    previousRevision = revision;
    previousRunning = running;
    return ranges;
  };
}
