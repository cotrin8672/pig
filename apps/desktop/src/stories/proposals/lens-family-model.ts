import type { Tool } from "./kit";
import {
  args,
  baseName,
  body,
  details,
  groupBy,
  list,
  num,
  parseAstMatches,
  parseDiagnostics,
  parseLocations,
  parseModuleSymbol,
  parseOutline,
  parseReplacements,
  parseSections,
  parseSymbolRead,
  parseSymbolSearch,
  range,
  str,
} from "./lens-model";

/*
 * One view model for every pi-lens tool. The five family proposals only differ
 * in how they present this model, so the 13 tools stay consistent by construction.
 */

export type Tone = "neutral" | "ok" | "warn" | "error" | "info";
/** Symbol kinds, severities and a few roles; the renderer picks one glyph per key. */
export type Glyph = string;
export type Item = {
  glyph: Glyph;
  /** Plain label: a name, a message, a path. */
  text: string;
  /** Source text worth highlighting (signature, matched code). */
  code?: string;
  /** Faint secondary text. */
  sub?: string;
  /** Position within the group's file, e.g. "13:41" or "L12–16". */
  loc?: string;
  /** Full path when the item names or lives in a file. */
  file?: string;
  tone?: Tone;
  before?: string;
  after?: string;
};
export type Group = {
  title: string;
  /** The title is a file path, so lists can print it as one. */
  isFile?: boolean;
  items: Item[];
};
export type Body =
  | { type: "code"; path: string; start: number; mark?: number; code: string }
  | { type: "list"; groups: Group[]; lang?: string }
  | { type: "facts"; rows: { label: string; value: string; tone?: Tone }[] };
export type Verdict = { tone: Tone; text: string };
export type LensView = {
  /** The human action, never the registered tool name. */
  verb: string;
  /** Breadcrumb: where, then what. */
  path?: string;
  subject?: string;
  kind?: string;
  meta: string[];
  verdict: Verdict[];
  body: Body;
};

export const kindName: Record<string, string> = {
  function: "関数",
  method: "メソッド",
  class: "クラス",
  struct: "型",
  type: "型",
  interface: "型",
  constant: "定数",
  variable: "変数",
  import: "import",
};
const lspVerb: Record<string, string> = {
  references: "参照",
  definition: "定義へ",
  implementation: "実装へ",
  hover: "型情報",
  rename: "名前変更",
  documentSymbol: "構造",
  workspaceSymbol: "シンボル検索",
  incomingCalls: "呼び出し元",
  outgoingCalls: "呼び出し先",
};
const severityName = {
  error: "エラー",
  warning: "警告",
  info: "情報",
  hint: "ヒント",
} as const;
const severityTone = {
  error: "error",
  warning: "warn",
  info: "info",
  hint: "neutral",
} as const;

const join = (...parts: (string | undefined)[]) =>
  parts.filter(Boolean).join("/").replace(/\/+/g, "/");
const firstPath = (tool: Tool) =>
  str(args(tool).path) || list(args(tool).paths)[0];

export function lensView(tool: Tool): LensView {
  const a = args(tool);
  const d = details(tool);
  const text = body(tool);
  switch (tool.call.name) {
    case "read_symbol":
    case "read_enclosing": {
      const s = parseSymbolRead(text);
      const path = str(a.path);
      const start = num(d.startLine) ?? s?.start ?? 1;
      const end = num(d.endLine) ?? s?.end ?? start;
      const kind = s?.kind ?? (str(d.kind) || "symbol");
      const enclosing = tool.call.name === "read_enclosing";
      const line = num(a.line);
      return {
        verb: enclosing ? "囲む範囲" : "定義",
        path,
        subject: s?.name || str(a.symbol) || (line ? `L${line}` : undefined),
        kind,
        meta: [range(start, end)],
        verdict: [
          {
            tone: "neutral",
            text: `${kindName[kind] ?? kind} · ${end - start + 1}行`,
          },
        ],
        body: {
          type: "code",
          path,
          start,
          mark: enclosing ? line : undefined,
          code: s?.code ?? text,
        },
      };
    }
    case "ast_grep_outline": {
      const { file, items } = parseOutline(text);
      const exported = items.filter((item) => item.exported).length;
      return {
        verb: "構造",
        path: firstPath(tool) || file,
        meta: [`${items.length} 宣言`],
        verdict: [
          { tone: "neutral", text: `宣言 ${items.length}` },
          { tone: "info", text: `公開 ${exported}` },
        ],
        body: {
          type: "list",
          lang: file,
          groups: [
            {
              title: file,
              isFile: true,
              items: items.map((item) => ({
                glyph: item.kind,
                text: item.name,
                code: item.signature,
                sub: item.exported ? "export" : undefined,
                loc: range(item.start, item.end),
              })),
            },
          ],
        },
      };
    }
    case "module_report": {
      const { sections } = parseSections(text);
      const path = str(a.path);
      const symbols = (key: string) =>
        (sections.get(key) ?? []).flatMap((row) => {
          const s = parseModuleSymbol(row);
          return s
            ? [
                {
                  glyph: s.kind,
                  text: s.name,
                  code: s.signature,
                  loc: range(s.start, s.end),
                },
              ]
            : [];
        });
      const usedBy = (sections.get("USED BY") ?? []).map((row) => {
        const [name = "", callers = ""] = row.split(/\s*←\s*/);
        const count = callers.split(",").filter(Boolean).length;
        return {
          glyph: "ref",
          text: name.trim(),
          sub: callers.trim(),
          loc: `${count}箇所`,
        };
      });
      const imports = (sections.get("IMPORTS") ?? []).map((row) => {
        const [scope = "", value = ""] = row.split(/:\s*/);
        return { glyph: "import", text: value, sub: scope };
      });
      const recommended = (sections.get("RECOMMENDED") ?? []).map((row) => {
        const found = /^(\d+)-(\d+)\s+(\S+)\s+—\s+(.*)$/.exec(row);
        return found
          ? {
              glyph: "next",
              text: found[3],
              sub: found[4],
              loc: range(Number(found[1]), Number(found[2])),
            }
          : { glyph: "next", text: row };
      });
      const total = num(d.symbols);
      const exported = num(d.exports);
      return {
        verb: "モジュール",
        path,
        meta: [
          total !== undefined ? `${total} シンボル` : "",
          exported !== undefined ? `${exported} 公開` : "",
        ].filter(Boolean),
        verdict: [
          { tone: "neutral", text: `シンボル ${total ?? "?"}` },
          { tone: "info", text: `公開 ${exported ?? "?"}` },
          { tone: "neutral", text: `参照元 ${usedBy.length}` },
        ],
        body: {
          type: "list",
          lang: path,
          groups: [
            { title: "おすすめの読み先", items: recommended },
            { title: "公開API", items: symbols("API") },
            { title: "内部", items: symbols("INTERNAL") },
            { title: "参照元", items: usedBy },
            { title: "import", items: imports },
          ].filter((group) => group.items.length > 0),
        },
      };
    }
    case "project_report": {
      const groups = new Map<string, Item[]>();
      let section = "";
      let coverage = "";
      for (const row of text.split("\n").slice(1)) {
        const header = /^\s*([A-Z][A-Z ]+):\s*(.*)$/.exec(row);
        if (header) {
          section = header[1];
          continue;
        }
        const cover = /coverage: .*\((\d+%)\)/.exec(row);
        if (cover) coverage = cover[1];
        const item = /^\s*- (.*)$/.exec(row)?.[1];
        if (!item) continue;
        const [, path = item, note] = /^(\S+)(?: \((.*)\))?$/.exec(item) ?? [];
        const entry: Item =
          section === "CYCLES"
            ? { glyph: "cycle", text: item, tone: "warn" }
            : {
                glyph: section,
                text: path,
                file: path.includes("/") ? path : undefined,
                sub: note,
                tone: section === "RISK HOTSPOTS" ? "warn" : undefined,
              };
        groups.set(section, [...(groups.get(section) ?? []), entry]);
      }
      const titles: [string, string][] = [
        ["HUBS", "ハブ"],
        ["ENTRY POINTS", "入口"],
        ["DIRECTORIES", "サブシステム"],
        ["CYCLES", "循環依存"],
        ["RISK HOTSPOTS", "リスク候補"],
        ["DEAD WEIGHT", "未使用候補"],
      ];
      const count = (key: string) => groups.get(key)?.length ?? 0;
      return {
        verb: "プロジェクト",
        subject: str(a.focus) || undefined,
        meta: [coverage && `網羅 ${coverage}`, `${count("HUBS")} ハブ`].filter(
          Boolean,
        ),
        verdict: [
          { tone: "neutral", text: `網羅 ${coverage || "?"}` },
          {
            tone: count("CYCLES") ? "warn" : "ok",
            text: `循環 ${count("CYCLES")}`,
          },
          {
            tone: count("RISK HOTSPOTS") ? "warn" : "ok",
            text: `リスク ${count("RISK HOTSPOTS")}`,
          },
        ],
        body: {
          type: "list",
          groups: titles.flatMap(([key, title]) =>
            groups.get(key) ? [{ title, items: groups.get(key) ?? [] }] : [],
          ),
        },
      };
    }
    case "symbol_search": {
      const { hits, coverage } = parseSymbolSearch(text);
      return {
        verb: "シンボル検索",
        subject: str(a.query),
        meta: [`${hits.length} ファイル`],
        verdict: [
          {
            tone: hits.length ? "info" : "neutral",
            text: `候補 ${hits.length}`,
          },
          ...(coverage
            ? [{ tone: "neutral" as const, text: `${coverage} ファイル中` }]
            : []),
        ],
        body: {
          type: "list",
          groups: [
            {
              title: "関連度順",
              items: hits.map((hit) => ({
                glyph: "file",
                text: hit.file,
                file: hit.file,
                loc: hit.line ? `${hit.line}` : undefined,
                sub: [
                  hit.score !== undefined && `score ${hit.score}`,
                  hit.hits !== undefined && `${hit.hits} hit`,
                ]
                  .filter(Boolean)
                  .join(" · "),
              })),
            },
          ],
        },
      };
    }
    case "ast_grep_search": {
      const matches = parseAstMatches(text);
      const files = groupBy(matches, (m) => m.file);
      return {
        verb: "構文検索",
        path: list(a.paths).join(", ") || undefined,
        subject: str(a.pattern),
        meta: [`${matches.length} 件`, `${files.length} ファイル`],
        verdict: [
          {
            tone: matches.length ? "info" : "neutral",
            text: `一致 ${matches.length}`,
          },
          { tone: "neutral", text: `${files.length} ファイル` },
        ],
        body: {
          type: "list",
          lang: matches[0]?.file,
          groups: files.map(([file, rows]) => ({
            title: file,
            isFile: true,
            items: rows.map((m) => ({
              glyph: "match",
              text: m.text,
              code: m.text,
              file,
              loc: `${m.line}:${m.column}`,
              sub: m.captures.map(([k, v]) => `$${k}=${v}`).join(" "),
            })),
          })),
        },
      };
    }
    case "ast_grep_replace": {
      const { mode, items } = parseReplacements(text);
      const files = groupBy(items, (item) => item.file);
      const applied = d.applied === true || mode === "APPLIED";
      return {
        verb: "構文置換",
        path: list(a.paths).join(", ") || undefined,
        subject: `${str(a.pattern)} → ${str(a.rewrite)}`,
        meta: [`${items.length} 件`, applied ? "適用済み" : "プレビュー"],
        verdict: [
          { tone: "info", text: `置換 ${items.length}` },
          applied
            ? { tone: "ok", text: "適用済み" }
            : { tone: "neutral", text: "未適用" },
        ],
        body: {
          type: "list",
          lang: items[0]?.file,
          groups: files.map(([file, rows]) => ({
            title: file,
            isFile: true,
            items: rows.map((r) => ({
              glyph: "change",
              text: `${r.before} → ${r.after}`,
              file,
              loc: `${r.line}:${r.column}`,
              before: r.before,
              after: r.after,
            })),
          })),
        },
      };
    }
    case "lsp_navigation": {
      const op = str(d.operation) || str(a.operation);
      const locations = parseLocations(text);
      const files = groupBy(locations, (l) => l.file);
      const origin = str(a.path);
      const line = num(a.line);
      return {
        verb: lspVerb[op] ?? op,
        path: origin,
        subject: str(a.symbol) || undefined,
        kind: "function",
        meta: [`${locations.length} 件`, `${files.length} ファイル`],
        verdict: [
          { tone: "info", text: `${lspVerb[op] ?? op} ${locations.length}` },
          { tone: "neutral", text: `${files.length} ファイル` },
        ],
        body: {
          type: "list",
          groups: files.map(([file, rows]) => ({
            title: file,
            isFile: true,
            items: rows.map((l) => {
              const self = file === origin && l.line === line;
              return {
                glyph: self ? "origin" : "ref",
                text: self ? "宣言" : "参照",
                file,
                loc: `${l.line}:${l.column}`,
                sub: self ? "起点" : undefined,
              };
            }),
          })),
        },
      };
    }
    case "lens_diagnostics": {
      const root = firstPath(tool);
      const found = parseDiagnostics(d.diagnostics);
      const count = (s: keyof typeof severityName) =>
        found.filter((x) => x.severity === s).length;
      const unconfirmed = num(d.unconfirmedFiles) ?? 0;
      const scanned = num(d.filesScanned);
      return {
        verb: "診断",
        path: root,
        meta: [
          `${count("error")} エラー`,
          `${count("warning")} 警告`,
          scanned !== undefined ? `${scanned} ファイル` : "",
          unconfirmed ? `${unconfirmed} 未確認` : "",
        ].filter(Boolean),
        verdict: [
          ...(["error", "warning", "hint"] as const)
            .filter((s) => count(s) > 0)
            .map((s) => ({
              tone: severityTone[s],
              text: `${severityName[s]} ${count(s)}`,
            })),
          unconfirmed
            ? { tone: "warn" as const, text: `未確認 ${unconfirmed}` }
            : found.length === 0
              ? { tone: "ok" as const, text: "問題なし" }
              : {
                  tone: "neutral" as const,
                  text: `${scanned ?? "?"} ファイル検査`,
                },
        ],
        body: {
          type: "list",
          groups: groupBy(found, (x) => x.file).map(([file, rows]) => ({
            title: join(root, file),
            isFile: true,
            items: rows.map((x) => ({
              glyph: x.severity,
              text: x.message,
              file: join(root, file),
              loc: `${x.line}:${x.column}`,
              sub: [x.source, x.code].filter(Boolean).join(" "),
              tone: severityTone[x.severity],
            })),
          })),
        },
      };
    }
    case "lens_diagnostic_mark": {
      const disposition = str(d.disposition) || str(a.disposition);
      const label =
        { suppress: "抑制", accept: "許容", fix: "修正予定" }[disposition] ??
        disposition;
      return {
        verb: "診断を記録",
        path: str(a.path),
        subject: str(a.rule) || undefined,
        meta: [label, num(a.line) ? `L${num(a.line)}` : ""].filter(Boolean),
        verdict: [{ tone: "neutral", text: label }],
        body: {
          type: "facts",
          rows: [
            {
              label: "対象",
              value: `${str(a.path)}:${num(a.line) ?? "?"}`,
            },
            { label: "指摘", value: `${str(a.tool)} ${str(a.rule)}` },
            { label: "判断", value: label, tone: "info" as const },
            { label: "理由", value: str(a.reason) },
            { label: "アンカー", value: str(d.anchor) },
          ].filter((row) => row.value.trim()),
        },
      };
    }
    case "effective_config": {
      const json = text.slice(text.indexOf("\n") + 1);
      let config: {
        configFiles?: { path: string; scope: string }[];
        file?: {
          language?: string;
          servers?: {
            id: string;
            selected: boolean;
            reason: string;
            role: string;
          }[];
          runners?: { id: string; enabled: boolean; tier: string }[];
        };
      } = {};
      try {
        config = JSON.parse(json);
      } catch {}
      const servers = config.file?.servers ?? [];
      const runners = config.file?.runners ?? [];
      const on = servers.filter((s) => s.selected).length;
      return {
        verb: "設定",
        path: str(a.path) || undefined,
        meta: [
          config.file?.language ?? "",
          `${on} サーバー`,
          `${runners.filter((r) => r.enabled).length} 解析器`,
        ].filter(Boolean),
        verdict: [
          { tone: "info", text: `サーバー ${on}/${servers.length}` },
          {
            tone: "neutral",
            text: `解析器 ${runners.filter((r) => r.enabled).length}/${runners.length}`,
          },
        ],
        body: {
          type: "list",
          groups: [
            {
              title: "言語サーバー",
              items: servers.map((s) => ({
                glyph: s.selected ? "on" : "off",
                text: s.id,
                sub: s.selected ? s.role : s.reason,
                tone: s.selected ? undefined : ("neutral" as const),
              })),
            },
            {
              title: "解析器",
              items: runners.map((r) => ({
                glyph: r.enabled ? "on" : "off",
                text: r.id,
                sub: r.tier,
              })),
            },
            {
              title: "設定ファイル",
              items: (config.configFiles ?? []).map((f) => ({
                glyph: "config",
                text: f.path,
                sub: f.scope,
              })),
            },
          ].filter((group) => group.items.length > 0),
        },
      };
    }
    case "pi_lens_activate_tools": {
      const requested = list(a.tools);
      const added = new Set(list(d.added));
      return {
        verb: "ツール追加",
        subject: `${requested.length} ツール`,
        meta: [`${added.size} 追加`, "次のターンから"],
        verdict: [
          { tone: "ok", text: `追加 ${added.size}` },
          { tone: "neutral", text: "次のターンから" },
        ],
        body: {
          type: "list",
          groups: [
            {
              title: "ツール",
              items: requested.map((name) => ({
                glyph: added.has(name) ? "added" : "on",
                text: name,
                sub: added.has(name) ? "追加" : "有効済み",
              })),
            },
          ],
        },
      };
    }
    default:
      return {
        verb: tool.call.name,
        meta: [],
        verdict: [],
        body: { type: "list", groups: [] },
      };
  }
}

/** "greeting.ts › greeting" — the file name reads first, the symbol last. */
export const crumb = (view: LensView) =>
  [view.path && baseName(view.path), view.subject].filter(Boolean).join(" › ");
