import type { ChatRenderData } from "@pig/chat-renderers";
import { output, toolArgs } from "./model";

/** Pure parsers over pi-lens text output, shared by the proposals. */
type Tool = ChatRenderData["tool"];

/** pi-lens appends a "result ok / usage …" trailer that is not part of the answer. */
export const body = (tool: Tool) =>
  output(tool)
    .replace(/\n*result (ok|error)\nusage [^\n]*\s*$/, "")
    .trimEnd();
export const args = toolArgs;
export const str = (value: unknown) => (typeof value === "string" ? value : "");
export const num = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;
export const list = (value: unknown) =>
  Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
export function details(tool: Tool): Record<string, unknown> {
  const value = (tool.state?.result as { details?: unknown } | undefined)
    ?.details;
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}
export const baseName = (path: string) => path.split(/[\\/]/).at(-1) ?? path;
export const dirName = (path: string) =>
  path.split(/[\\/]/).slice(0, -1).join("/");
export function groupBy<T>(items: T[], key: (item: T) => string) {
  const groups = new Map<string, T[]>();
  for (const item of items)
    groups.set(key(item), [...(groups.get(key(item)) ?? []), item]);
  return [...groups];
}
export const range = (start: number, end: number) =>
  start === end ? `L${start}` : `L${start}–${end}`;

/** read_symbol / read_enclosing: "function greeting  greeting.ts:12-16" then the body. */
export function parseSymbolRead(text: string) {
  const [head = "", ...rest] = text.split("\n");
  const found = /^(\S+)\s+(\S+)\s+(\S+?):(\d+)-(\d+)/.exec(head);
  if (!found) return undefined;
  return {
    kind: found[1],
    name: found[2],
    start: Number(found[4]),
    end: Number(found[5]),
    code: rest.join("\n").replace(/^\n+/, ""),
  };
}

export type OutlineItem = {
  start: number;
  end: number;
  exported: boolean;
  kind: string;
  name: string;
  signature: string;
};
/** ast_grep_outline: "12-16 export function greeting — <signature>". */
export function parseOutline(text: string) {
  const [file = "", ...rows] = text.split("\n");
  const items: OutlineItem[] = [];
  for (const row of rows) {
    const found = /^(\d+)-(\d+) (export )?(\S+)(?: (.+?))? — (.*)$/.exec(row);
    if (found)
      items.push({
        start: Number(found[1]),
        end: Number(found[2]),
        exported: Boolean(found[3]),
        kind: found[4],
        name: found[5] ?? found[4],
        signature: found[6],
      });
  }
  return { file, items };
}

/** Upper-case "SECTION:" blocks used by module_report / project_report. */
export function parseSections(text: string) {
  const sections = new Map<string, string[]>();
  let current: string[] | undefined;
  const [head = "", ...rows] = text.split("\n");
  for (const row of rows) {
    const found = /^([A-Z][A-Z ]+):\s*(.*)$/.exec(row);
    if (found) {
      current = found[2] ? [found[2]] : [];
      sections.set(found[1], current);
    } else if (row.trim()) current?.push(row.trim());
  }
  return { head, sections };
}

export type ModuleSymbol = {
  start: number;
  end: number;
  kind: string;
  name: string;
  signature: string;
};
/** "12-16   function  greeting(locale: Locale, name?: string)" */
export function parseModuleSymbol(row: string): ModuleSymbol | undefined {
  const found = /^(\d+)-(\d+)\s+(\w+)\s+(.+)$/.exec(row);
  if (!found) return undefined;
  const signature = found[4].trim();
  return {
    start: Number(found[1]),
    end: Number(found[2]),
    kind: found[3],
    name: /^[\w$]+/.exec(signature)?.[0] ?? signature,
    signature,
  };
}

export type SearchHit = {
  rank: number;
  file: string;
  line?: number;
  score?: number;
  hits?: number;
  fanIn?: number;
  complexity?: number;
};
/** symbol_search: "  1. src/a.ts 12 (score 8.42, 6 hit(s), fanIn 3, complexity 4)". */
export function parseSymbolSearch(text: string) {
  const hits: SearchHit[] = [];
  let coverage: number | undefined;
  for (const row of text.split("\n")) {
    const cover = /^Index covers (\d+) files/.exec(row);
    if (cover) coverage = Number(cover[1]);
    const found = /^\s*(\d+)\.\s+(\S+)(?:\s+(\d+))?(?:\s+\((.*)\))?$/.exec(row);
    if (!found) continue;
    const meta = found[4] ?? "";
    const pick = (re: RegExp) => {
      const value = re.exec(meta)?.[1];
      return value === undefined ? undefined : Number(value);
    };
    hits.push({
      rank: Number(found[1]),
      file: found[2],
      line: found[3] ? Number(found[3]) : undefined,
      score: pick(/score ([\d.]+)/),
      hits: pick(/(\d+) hit/),
      fanIn: pick(/fanIn (\d+)/),
      complexity: pick(/complexity (\d+)/),
    });
  }
  return { hits, coverage };
}

export type AstMatch = {
  file: string;
  line: number;
  column: number;
  text: string;
  captures: [string, string][];
};
/** ast_grep_search: "file:13:20: text  [TypeScript]" followed by "  $X=value" captures. */
export function parseAstMatches(text: string) {
  const matches: AstMatch[] = [];
  for (const row of text.split("\n")) {
    const capture = /^\s+\$(\w+)=(.*)$/.exec(row);
    if (capture) {
      matches.at(-1)?.captures.push([capture[1], capture[2]]);
      continue;
    }
    const found = /^(.+?):(\d+):(\d+): (.*?)(?:\s{2}\[[\w+#-]+\])?$/.exec(row);
    if (found)
      matches.push({
        file: found[1],
        line: Number(found[2]),
        column: Number(found[3]),
        text: found[4],
        captures: [],
      });
  }
  return matches;
}

export type Replacement = {
  file: string;
  line: number;
  column: number;
  before: string;
  after: string;
};
/** ast_grep_replace: "[DRY-RUN] n replacement(s):" then "loc / - old / + new" triples. */
export function parseReplacements(text: string) {
  const rows = text.split("\n");
  const mode = /^\[(DRY-RUN|APPLIED|NOT APPLIED)\]/.exec(rows[0] ?? "")?.[1];
  const items: Replacement[] = [];
  rows.forEach((row, index) => {
    const loc = /^(.+?):(\d+):(\d+)$/.exec(row);
    const before = /^\s+- (.*)$/.exec(rows[index + 1] ?? "");
    const after = /^\s+\+ (.*)$/.exec(rows[index + 2] ?? "");
    if (loc && before && after)
      items.push({
        file: loc[1],
        line: Number(loc[2]),
        column: Number(loc[3]),
        before: before[1],
        after: after[1],
      });
  });
  return { mode, items };
}

export type Location = { file: string; line: number; column: number };
/** lsp_navigation locations: "path:line:col". */
export function parseLocations(text: string): Location[] {
  return text.split("\n").flatMap((row) => {
    const found = /^(.+?):(\d+):(\d+)$/.exec(row.trim());
    return found
      ? [{ file: found[1], line: Number(found[2]), column: Number(found[3]) }]
      : [];
  });
}

export type Diagnostic = {
  file: string;
  line: number;
  column: number;
  severity: "error" | "warning" | "info" | "hint";
  source?: string;
  code?: string;
  message: string;
};
const SEVERITY = ["error", "error", "warning", "info", "hint"] as const;
/** lens_diagnostics details.diagnostics use LSP numbering: zero-based lines, 1 = error. */
export function parseDiagnostics(value: unknown): Diagnostic[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const d = item as Record<string, unknown>;
    if (typeof d.file !== "string" || typeof d.message !== "string") return [];
    return [
      {
        file: d.file,
        line: Number(d.line ?? 0) + 1,
        column: Number(d.character ?? 0) + 1,
        severity: SEVERITY[Number(d.severity)] ?? "info",
        source: typeof d.source === "string" ? d.source : undefined,
        code: d.code === undefined ? undefined : String(d.code),
        message: d.message,
      },
    ];
  });
}
