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
    if (last && explore(block) && last.blocks.every(explore))
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
  let start = 0;
  records.forEach((record, index) => {
    if (role(record) !== "user") return;
    if (index > start) close(start, index - 1);
    start = index + 1;
  });
  if (!running && start < records.length) close(start, records.length - 1);
  return result;
}
