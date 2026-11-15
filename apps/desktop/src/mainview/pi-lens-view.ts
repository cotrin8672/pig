import type { ChatRenderData } from "@pig/chat-renderers";
import { en } from "../shared/i18n";
import { resultText } from "../shared/tool-view";

/*
 * pi-lens results as one relation map: origin → group → result.
 * Parsers follow what pi-lens 4.4.x returns. Anything they cannot read
 * yields no body, so the renderer falls back to the literal output.
 */

type Tool = ChatRenderData["tool"];
export type PiLensText = typeof en.piLens;
export type Tone = "error" | "warn" | "info" | "ok" | "neutral";
export type LensItem = {
  /** A symbol kind, a severity or a role; the renderer picks one glyph per key. */
  glyph: string;
  text: string;
  loc?: string;
  /** Set when the text itself is a path, so only its base name is shown. */
  file?: string;
  tone?: Tone;
};
export type LensGroup = { title: string; isFile?: boolean; items: LensItem[] };
export type LensBody =
  | {
      type: "code";
      path: string;
      start: number;
      end: number;
      mark?: number;
      code: string;
      kind: string;
      name: string;
    }
  | { type: "graph"; root: string; groups: LensGroup[] }
  | { type: "chain"; steps: string[]; note?: string };

const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const text = (value: unknown) => (typeof value === "string" ? value : "");
const strings = (value: unknown) =>
  Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
const count = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : undefined;
export const baseName = (path: string) => path.split(/[\\/]/).at(-1) ?? path;
const range = (start: number, end: number) =>
  start === end ? `L${start}` : `L${start}–${end}`;
function groupBy<T>(items: T[], key: (item: T) => string) {
  const groups = new Map<string, T[]>();
  for (const item of items)
    groups.set(key(item), [...(groups.get(key(item)) ?? []), item]);
  return [...groups];
}
const argsOf = (data: Tool) => object(data.call.arguments);
const detailsOf = (data: Tool) => object(object(data.state?.result).details);
/** pi-lens appends a "result ok / usage …" trailer that is not part of the answer. */
const answer = (data: Tool) =>
  resultText(data.state?.result)
    .replace(/\n*result (ok|error)\nusage [^\n]*\s*$/, "")
    .trimEnd();
const pathOf = (args: Record<string, unknown>) =>
  text(args.path) ||
  text(args.file) ||
  text(args.filePath) ||
  strings(args.paths).join(", ");

/** Header: a human verb, "file › subject", and counts only from real metadata. */
export function piLensSummary(data: Tool, t: PiLensText = en.piLens) {
  const args = argsOf(data);
  const details = detailsOf(data);
  const name = data.call.name;
  const operation = text(details.operation) || text(args.operation);
  const verb =
    name === "lsp_navigation" && operation
      ? (t.operations[operation] ?? operation)
      : (t.verbs[name] ?? name);
  const path = pathOf(args);
  const line = count(args.line);
  const subject =
    name === "ast_grep_replace" && text(args.pattern) && text(args.rewrite)
      ? `${text(args.pattern)} → ${text(args.rewrite)}`
      : text(args.symbol) ||
        text(args.query) ||
        text(args.pattern) ||
        text(args.rule) ||
        text(args.focus) ||
        (name === "read_enclosing" && line ? `L${line}` : "");
  // A single path reads by its file name; several stay as given.
  const where = path.includes(", ") ? path : path && baseName(path);
  const target = [where, subject].filter(Boolean).join(" › ");

  const meta: string[] = [];
  const start = count(details.startLine);
  const end = count(details.endLine);
  if (start && end !== undefined && end >= start) meta.push(range(start, end));
  const fields: Record<string, readonly (keyof PiLensText["counts"])[]> = {
    ast_grep_search: ["results"],
    ast_grep_replace: ["results"],
    lsp_navigation: ["results"],
    symbol_search: ["files"],
    module_report: ["symbols", "exports"],
    project_report: ["hubs", "entryPoints"],
    lens_diagnostics: [
      "diagnostics",
      "errors",
      "warnings",
      "actionable",
      "quality",
      "project",
      "unconfirmed",
      "unchecked",
    ],
  };
  const keys: Record<keyof PiLensText["counts"], string> = {
    results: name === "lsp_navigation" ? "resultCount" : "matchCount",
    files: "count",
    symbols: "symbols",
    exports: "exports",
    hubs: "hubs",
    entryPoints: "entryPoints",
    diagnostics: "totalDiagnostics",
    errors: "totalErrors",
    warnings: "totalWarnings",
    actionable: "actionableWarnings",
    quality: "qualityIssues",
    project: "projectDiagnostics",
    unconfirmed: "unconfirmedFiles",
    unchecked: "uncheckedFileCount",
  };
  for (const key of fields[name] ?? []) {
    const value = count(details[keys[key]]);
    if (value !== undefined) meta.push(`${value} ${t.counts[key]}`);
  }
  // Zero cached findings is not evidence of a successful/complete LSP check.
  if (
    details.unconfirmed === true ||
    details.timedOut === true ||
    (count(details.incompleteFiles) ?? 0) > 0
  )
    meta.push(t.flags.unconfirmed);
  if (details.available === false || details.supported === false)
    meta.push(t.flags.unavailable);
  if (details.found === false) meta.push(t.flags.notFound);
  if (details.stalePreview === true) meta.push(t.flags.stalePreview);
  if (name === "ast_grep_replace" && typeof details.applied === "boolean")
    meta.push(details.applied ? t.flags.applied : t.flags.preview);
  if (details.validateOnly === true && typeof details.valid === "boolean")
    meta.push(details.valid ? t.flags.valid : t.flags.invalid);
  const validation = text(details.validationStatus);
  if (validation) meta.push(validation);
  return { verb, target, meta: meta.join(" · ") };
}

/* ---------------- bodies ---------------- */

function readBody(data: Tool): LensBody | undefined {
  const [head = "", ...rest] = answer(data).split("\n");
  const found = /^(\S+)\s+(\S+)\s+(\S+?):(\d+)-(\d+)/.exec(head);
  const code = rest.join("\n").replace(/^\n+/, "");
  if (!found || !code) return undefined;
  const details = detailsOf(data);
  const start = count(details.startLine) || Number(found[4]);
  const lines = code.split("\n").length;
  return {
    type: "code",
    path: text(argsOf(data).path) || found[3],
    start,
    end: count(details.endLine) || start + lines - 1,
    mark:
      data.call.name === "read_enclosing"
        ? count(argsOf(data).line)
        : undefined,
    code,
    kind: found[1],
    name: found[2],
  };
}

function outlineGroups(output: string): LensGroup[] {
  const [file = "", ...rows] = output.split("\n");
  const items = rows.flatMap((row): LensItem[] => {
    const found = /^(\d+)-(\d+) (?:export )?(\S+)(?: (.+?))? — /.exec(row);
    return found
      ? [
          {
            glyph: found[3],
            text: found[4] ?? found[3],
            loc: range(Number(found[1]), Number(found[2])),
          },
        ]
      : [];
  });
  return [{ title: file, isFile: true, items }];
}

/** Upper-case "SECTION:" blocks of module_report / project_report; nested headers included. */
function sections(output: string) {
  const map = new Map<string, string[]>();
  let current: string[] | undefined;
  for (const row of output.split("\n").slice(1)) {
    const found = /^\s*([A-Z][A-Z ]+):\s*(.*)$/.exec(row);
    if (found) {
      current = found[2] ? [found[2]] : [];
      map.set(found[1], current);
    } else if (row.trim()) current?.push(row.trim());
  }
  return map;
}

function moduleGroups(output: string, t: PiLensText): LensGroup[] {
  const map = sections(output);
  const symbols = (key: string) =>
    (map.get(key) ?? []).flatMap((row): LensItem[] => {
      const found = /^(\d+)-(\d+)\s+(\w+)\s+([\w$]+)/.exec(row);
      return found
        ? [
            {
              glyph: found[3],
              text: found[4],
              loc: range(Number(found[1]), Number(found[2])),
            },
          ]
        : [];
    });
  const usedBy = (map.get("USED BY") ?? []).map((row): LensItem => {
    const [name = "", callers = ""] = row.split(/\s*←\s*/);
    return {
      glyph: "ref",
      text: name.trim(),
      loc: String(callers.split(",").filter((c) => c.trim()).length),
    };
  });
  const imports = (map.get("IMPORTS") ?? []).map(
    (row): LensItem => ({
      glyph: "import",
      text: row.replace(/^\w+:\s*/, ""),
    }),
  );
  const recommended = (map.get("RECOMMENDED") ?? []).map((row): LensItem => {
    const found = /^(\d+)-(\d+)\s+(\S+)/.exec(row);
    return found
      ? {
          glyph: "next",
          text: found[3],
          loc: range(Number(found[1]), Number(found[2])),
        }
      : { glyph: "next", text: row };
  });
  return [
    { title: t.groups.recommended, items: recommended },
    { title: t.groups.api, items: symbols("API") },
    { title: t.groups.internal, items: symbols("INTERNAL") },
    { title: t.groups.usedBy, items: usedBy },
    { title: t.groups.imports, items: imports },
  ];
}

function projectGroups(output: string, t: PiLensText): LensGroup[] {
  const map = sections(output);
  const titles: [string, string][] = [
    ["HUBS", t.groups.hubs],
    ["ENTRY POINTS", t.groups.entryPoints],
    ["DIRECTORIES", t.groups.subsystems],
    ["CYCLES", t.groups.cycles],
    ["RISK HOTSPOTS", t.groups.risks],
    ["DEAD WEIGHT", t.groups.dead],
  ];
  return titles.map(([key, title]) => ({
    title,
    items: (map.get(key) ?? []).flatMap((row): LensItem[] => {
      const item = /^- (.*)$/.exec(row)?.[1];
      if (!item) return [];
      if (key === "CYCLES")
        return [{ glyph: "cycle", text: item, tone: "warn" }];
      const path = /^\S+/.exec(item)?.[0] ?? item;
      return [
        {
          glyph: key,
          text: path,
          file: path.includes("/") ? path : undefined,
          tone: key === "RISK HOTSPOTS" ? "warn" : undefined,
        },
      ];
    }),
  }));
}

function searchGroups(output: string, t: PiLensText): LensGroup[] {
  const items = output.split("\n").flatMap((row): LensItem[] => {
    const found = /^\s*\d+\.\s+(\S+)(?:\s+(\d+))?(?:\s+\(.*\))?$/.exec(row);
    return found
      ? [{ glyph: "file", text: found[1], file: found[1], loc: found[2] }]
      : [];
  });
  return [{ title: t.groups.ranked, items }];
}

function matchGroups(output: string): LensGroup[] {
  const matches = output.split("\n").flatMap((row) => {
    const found = /^(.+?):(\d+):(\d+): (.*?)(?:\s{2}\[[\w+#-]+\])?$/.exec(row);
    return found
      ? [{ file: found[1], loc: `${found[2]}:${found[3]}`, text: found[4] }]
      : [];
  });
  return groupBy(matches, (m) => m.file).map(([file, rows]) => ({
    title: file,
    isFile: true,
    items: rows.map((m) => ({ glyph: "match", text: m.text, loc: m.loc })),
  }));
}

function replaceGroups(output: string): LensGroup[] {
  const rows = output.split("\n");
  const changes = rows.flatMap((row, index) => {
    const loc = /^(.+?):(\d+):(\d+)$/.exec(row);
    const before = /^\s+- (.*)$/.exec(rows[index + 1] ?? "");
    const after = /^\s+\+ (.*)$/.exec(rows[index + 2] ?? "");
    return loc && before && after
      ? [
          {
            file: loc[1],
            loc: `${loc[2]}:${loc[3]}`,
            text: `${before[1]} → ${after[1]}`,
          },
        ]
      : [];
  });
  return groupBy(changes, (c) => c.file).map(([file, items]) => ({
    title: file,
    isFile: true,
    items: items.map((c) => ({ glyph: "change", text: c.text, loc: c.loc })),
  }));
}

function locationGroups(data: Tool, t: PiLensText): LensGroup[] {
  const args = argsOf(data);
  const origin = text(args.path);
  const line = count(args.line);
  const operation = text(detailsOf(data).operation) || text(args.operation);
  const locations = answer(data)
    .split("\n")
    .flatMap((row) => {
      const found = /^(.+?):(\d+):(\d+)$/.exec(row.trim());
      return found
        ? [{ file: found[1], line: Number(found[2]), column: found[3] }]
        : [];
    });
  return groupBy(locations, (l) => l.file).map(([file, rows]) => ({
    title: file,
    isFile: true,
    items: rows.map((l): LensItem => {
      const self = file === origin && l.line === line;
      return {
        glyph: self ? "origin" : "ref",
        text: self
          ? t.declaration
          : operation === "references"
            ? t.reference
            : t.location,
        loc: `${l.line}:${l.column}`,
      };
    }),
  }));
}

const SEVERITY = ["error", "error", "warning", "info", "hint"] as const;
const severityTone = {
  error: "error",
  warning: "warn",
  info: "info",
  hint: "neutral",
} as const;
/** details.diagnostics use LSP numbering: zero-based lines, severity 1 = error. */
function diagnosticGroups(data: Tool): LensGroup[] {
  const root = strings(argsOf(data).paths)[0] ?? text(argsOf(data).path);
  const list = detailsOf(data).diagnostics;
  if (!Array.isArray(list)) return [];
  const found = list.flatMap((value) => {
    const d = object(value);
    if (!text(d.file) || !text(d.message)) return [];
    const severity = SEVERITY[Number(d.severity)] ?? "info";
    const file = text(d.file);
    return [
      {
        file:
          root && !file.startsWith(root) && !/^([A-Za-z]:)?[\\/]/.test(file)
            ? `${root.replace(/[\\/]+$/, "")}/${file}`
            : file,
        severity,
        loc: `${Number(d.line ?? 0) + 1}:${Number(d.character ?? 0) + 1}`,
        message: text(d.message),
      },
    ];
  });
  return groupBy(found, (d) => d.file).map(([file, rows]) => ({
    title: file,
    isFile: true,
    items: rows.map((d) => ({
      glyph: d.severity,
      text: d.message,
      loc: d.loc,
      tone: severityTone[d.severity],
    })),
  }));
}

function configGroups(output: string, t: PiLensText): LensGroup[] {
  let config: Record<string, unknown> = {};
  try {
    config = object(JSON.parse(output.slice(output.indexOf("\n") + 1)));
  } catch {
    return [];
  }
  const file = object(config.file);
  const rows = (value: unknown) =>
    Array.isArray(value) ? value.map(object) : [];
  return [
    {
      title: t.groups.servers,
      items: rows(file.servers).map((s) => ({
        glyph: s.selected === true ? "on" : "off",
        text: text(s.id),
      })),
    },
    {
      title: t.groups.runners,
      items: rows(file.runners).map((r) => ({
        glyph: r.enabled === true ? "on" : "off",
        text: text(r.id),
      })),
    },
    {
      title: t.groups.configFiles,
      items: rows(config.configFiles).map((f) => ({
        glyph: "config",
        text: text(f.path),
      })),
    },
  ];
}

function activateGroups(data: Tool, t: PiLensText): LensGroup[] {
  const added = new Set(strings(detailsOf(data).added));
  return [
    {
      title: t.groups.tools,
      items: strings(argsOf(data).tools).map((name) => ({
        glyph: added.has(name) ? "added" : "on",
        text: name,
        loc: added.has(name) ? t.added : t.active,
      })),
    },
  ];
}

function markBody(data: Tool): LensBody | undefined {
  const args = argsOf(data);
  const details = detailsOf(data);
  const path = text(args.path);
  if (!path) return undefined;
  const line = count(args.line);
  return {
    type: "chain",
    steps: [
      line ? `${path}:${line}` : path,
      [text(args.tool), text(args.rule)].filter(Boolean).join(" "),
      text(details.disposition) || text(args.disposition),
      text(details.anchor),
    ].filter(Boolean),
    note: text(args.reason) || undefined,
  };
}

/** The relation map for a finished result, or undefined to keep the literal output. */
export function piLensBody(
  data: Tool,
  t: PiLensText = en.piLens,
): LensBody | undefined {
  const output = answer(data);
  const name = data.call.name;
  if (name === "read_symbol" || name === "read_enclosing")
    return readBody(data);
  if (name === "lens_diagnostic_mark") return markBody(data);
  const groups: Record<string, () => LensGroup[]> = {
    ast_grep_outline: () => outlineGroups(output),
    module_report: () => moduleGroups(output, t),
    project_report: () => projectGroups(output, t),
    symbol_search: () => searchGroups(output, t),
    ast_grep_search: () => matchGroups(output),
    ast_grep_replace: () => replaceGroups(output),
    lsp_navigation: () => locationGroups(data, t),
    lens_diagnostics: () => diagnosticGroups(data),
    effective_config: () => configGroups(output, t),
    pi_lens_activate_tools: () => activateGroups(data, t),
  };
  const found = (groups[name]?.() ?? []).filter((g) => g.items.length > 0);
  if (found.length === 0) return undefined;
  const { verb, target } = piLensSummary(data, t);
  return { type: "graph", root: target || verb, groups: found };
}
