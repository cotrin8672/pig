import type { ChatRenderData } from "@pig/chat-renderers";
import { resultText } from "../../shared/tool-view";

/** Pure parsers over the SDK's tool output formats, shared by the proposals. */
type Tool = ChatRenderData["tool"];
export const toolArgs = (tool: Tool) =>
  (tool.call.arguments ?? {}) as Record<string, unknown>;
export const output = (tool: Tool) => resultText(tool.state?.result);

const READ_NOTICE =
  /\n*\[(?:(\d+) more lines in file|Showing lines \d+-\d+ of (\d+))[^\]]*\]\s*$/;

/** read only appends a notice when the file continues; otherwise the file ended inside the range. */
export function readRange(tool: Tool) {
  const text = output(tool);
  const notice = READ_NOTICE.exec(text);
  const body = notice ? text.slice(0, notice.index) : text;
  const lines = body ? body.split("\n") : [];
  const start = Number(toolArgs(tool).offset) || 1;
  const end = start + Math.max(lines.length, 1) - 1;
  const total = notice?.[1]
    ? end + Number(notice[1])
    : notice?.[2]
      ? Number(notice[2])
      : end;
  return { lines, start, end, total };
}

export type GrepLine = { line: number; text: string; match: boolean };
/** grep prints "path:12: text" for matches and "path-12- text" for context lines. */
export function grepFiles(tool: Tool) {
  const files = new Map<string, GrepLine[]>();
  for (const raw of output(tool).split("\n")) {
    const found = /^(.+?)([:-])(\d+)\2 ?(.*)$/.exec(raw);
    if (!found) continue;
    const [, path, sep, line, text] = found;
    const lines = files.get(path) ?? [];
    lines.push({ line: Number(line), text, match: sep === ":" });
    files.set(path, lines);
  }
  return [...files].map(([path, lines]) => ({ path, lines }));
}

/** find and ls print one path per line, then "[...]" notices when limited. */
export const pathLines = (tool: Tool) =>
  output(tool)
    .split("\n")
    .filter((line) => line && !line.startsWith("["));

export type TreeNode = { name: string; file: boolean; children: TreeNode[] };
const foldersFirst = (a: TreeNode, b: TreeNode) =>
  Number(a.file) - Number(b.file);
/** Folders with a single folder child are merged ("apps/cli/src"), like editor explorers. */
export function pathTree(paths: string[]): TreeNode[] {
  const root: TreeNode = { name: "", file: false, children: [] };
  for (const path of paths) {
    let node = root;
    const parts = path.split("/").filter(Boolean);
    parts.forEach((name, index) => {
      let child = node.children.find((item) => item.name === name);
      if (!child) {
        child = { name, file: index === parts.length - 1, children: [] };
        node.children.push(child);
      }
      node = child;
    });
  }
  const compact = (node: TreeNode): TreeNode => {
    let current = node;
    while (
      !current.file &&
      current.children.length === 1 &&
      !current.children[0].file
    ) {
      const [only] = current.children;
      current = { ...only, name: `${current.name}/${only.name}` };
    }
    return {
      ...current,
      children: current.children.map(compact).sort(foldersFirst),
    };
  };
  return root.children.map(compact).sort(foldersFirst);
}

export type DiffRow = {
  kind: "add" | "del" | "ctx" | "gap";
  line: number;
  text: string;
};
/** The edit tool's display diff: "+12 text", "-12 text", " 12 text" and "    ..." gaps. */
export function diffRows(diff: string): DiffRow[] {
  return diff.split("\n").flatMap((raw): DiffRow[] => {
    if (/^\s+\.\.\.$/.test(raw)) return [{ kind: "gap", line: 0, text: "" }];
    const found = /^([ +-])\s*(\d+) (.*)$/.exec(raw);
    if (!found) return [];
    const kind = found[1] === "+" ? "add" : found[1] === "-" ? "del" : "ctx";
    return [{ kind, line: Number(found[2]), text: found[3] }];
  });
}
export function diffHunks(rows: DiffRow[]) {
  const hunks: DiffRow[][] = [[]];
  for (const row of rows)
    if (row.kind === "gap") hunks.push([]);
    else hunks[hunks.length - 1].push(row);
  return hunks.filter((hunk) => hunk.length);
}

/** Splits two lines into shared prefix, changed middles and shared suffix. */
export function changedSpan(before: string, after: string) {
  let head = 0;
  while (
    head < before.length &&
    head < after.length &&
    before[head] === after[head]
  )
    head++;
  let tail = 0;
  while (
    tail < before.length - head &&
    tail < after.length - head &&
    before[before.length - 1 - tail] === after[after.length - 1 - tail]
  )
    tail++;
  return {
    prefix: before.slice(0, head),
    removed: before.slice(head, before.length - tail),
    added: after.slice(head, after.length - tail),
    suffix: before.slice(before.length - tail),
  };
}

export type ChangePair = { del?: DiffRow; add?: DiffRow; ctx?: DiffRow };
/** Pairs each run of removed lines with the added run that follows it. */
export function pairChanges(hunk: DiffRow[]) {
  const pairs: ChangePair[] = [];
  for (let i = 0; i < hunk.length; ) {
    if (hunk[i].kind === "ctx") {
      pairs.push({ ctx: hunk[i++] });
      continue;
    }
    const dels: DiffRow[] = [];
    const adds: DiffRow[] = [];
    while (hunk[i]?.kind === "del") dels.push(hunk[i++]);
    while (hunk[i]?.kind === "add") adds.push(hunk[i++]);
    for (let j = 0; j < Math.max(dels.length, adds.length); j++)
      pairs.push({ del: dels[j], add: adds[j] });
  }
  return pairs;
}

/** Top-level declarations, as an editor outline would list them. */
export function outline(source: string) {
  return source.split("\n").flatMap((text, index) => {
    const found =
      /^(export\s+)?(?:default\s+)?(?:async\s+)?(function|const|let|class|interface|type|enum)\s+([\w$]+)/.exec(
        text,
      );
    return found
      ? [
          {
            line: index + 1,
            kind: found[2],
            name: found[3],
            exported: !!found[1],
          },
        ]
      : [];
  });
}
