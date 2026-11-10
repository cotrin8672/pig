import type {
  ChatRenderData,
  ChatRenderer,
  ChatRendererProps,
} from "@pig/chat-renderers";
import {
  FileText,
  ListTree,
  Pencil,
  Search,
  Settings2,
  ShieldCheck,
} from "lucide-react";
import { ToolResultContent } from "./MessageContent";
import { ToolRow, toolTone } from "./ToolBlock";

// Exact registered names from pi-lens 4.4.11, not package-name/prefix guesses.
const tools = {
  read_symbol: FileText,
  read_enclosing: FileText,
  ast_grep_search: Search,
  ast_grep_replace: Pencil,
  ast_grep_outline: ListTree,
  lsp_navigation: Search,
  lens_diagnostics: ShieldCheck,
  lens_diagnostic_mark: ShieldCheck,
  symbol_search: Search,
  module_report: ListTree,
  project_report: ListTree,
  effective_config: Settings2,
  pi_lens_activate_tools: Settings2,
} as const;
const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const text = (value: unknown) => (typeof value === "string" ? value : "");

export function piLensSummary(data: ChatRenderData["tool"]) {
  const args = object(data.call.arguments);
  const details = object(object(data.state?.result).details);
  const path =
    text(args.path) ||
    text(args.file) ||
    text(args.filePath) ||
    (Array.isArray(args.paths)
      ? args.paths
          .filter((value): value is string => typeof value === "string")
          .join(", ")
      : "");
  const operation =
    data.call.name === "lsp_navigation"
      ? text(details.operation) || text(args.operation) || data.call.name
      : data.call.name;
  const subject =
    text(args.symbol) ||
    text(args.query) ||
    text(args.pattern) ||
    text(args.rule);
  const target = [path, subject].filter(Boolean).join(" · ");
  const meta: string[] = [];
  if (
    Number.isInteger(details.startLine) &&
    Number.isInteger(details.endLine) &&
    Number(details.startLine) > 0 &&
    Number(details.endLine) >= Number(details.startLine)
  )
    meta.push(`L${details.startLine}–${details.endLine}`);
  const fields: Record<string, readonly (readonly [string, string])[]> = {
    ast_grep_search: [["matchCount", "matches"]],
    ast_grep_replace: [["matchCount", "matches"]],
    lsp_navigation: [["resultCount", "results"]],
    symbol_search: [["count", "files"]],
    module_report: [
      ["symbols", "symbols"],
      ["exports", "exports"],
    ],
    project_report: [
      ["hubs", "hubs"],
      ["entryPoints", "entry points"],
    ],
    lens_diagnostics: [
      ["totalDiagnostics", "diagnostics"],
      ["totalErrors", "errors"],
      ["totalWarnings", "warnings"],
      ["actionableWarnings", "actionable"],
      ["qualityIssues", "quality"],
      ["projectDiagnostics", "project"],
      ["unconfirmedFiles", "unconfirmed"],
      ["uncheckedFileCount", "unchecked"],
    ],
  };
  for (const [key, label] of fields[data.call.name] ?? []) {
    const value = details[key];
    if (typeof value === "number" && Number.isFinite(value) && value >= 0)
      meta.push(`${value} ${label}`);
  }
  // Zero cached findings is not evidence of a successful/complete LSP check.
  if (
    details.unconfirmed === true ||
    details.timedOut === true ||
    (typeof details.incompleteFiles === "number" && details.incompleteFiles > 0)
  )
    meta.push("unconfirmed");
  if (details.available === false || details.supported === false)
    meta.push("unavailable");
  if (details.found === false) meta.push("not found");
  if (details.stalePreview === true) meta.push("stale preview");
  if (
    data.call.name === "ast_grep_replace" &&
    typeof details.applied === "boolean"
  )
    meta.push(details.applied ? "applied" : "preview");
  if (details.validateOnly === true && typeof details.valid === "boolean")
    meta.push(details.valid ? "valid" : "invalid");
  const validation = text(details.validationStatus);
  if (validation) meta.push(validation);
  return { operation, target, meta: meta.join(" · ") };
}

export function PiLensRenderer({ data }: ChatRendererProps<"tool">) {
  const { operation, target, meta } = piLensSummary(data);
  const Icon = tools[data.call.name as keyof typeof tools];
  const status =
    object(data.state?.result).isError === true
      ? "error"
      : toolTone(data.state, data.live);
  return (
    <ToolRow
      icon={<Icon size={14} />}
      verb={`pi-lens · ${operation}`}
      target={target}
      meta={meta}
      state={data.state}
      status={status}
    >
      <ToolResultContent result={data.state?.result} />
    </ToolRow>
  );
}

export const piLensRenderer: ChatRenderer<"tool"> = {
  id: "builtin:pi-lens",
  kind: "tool",
  match: (data) => !data.card && Object.hasOwn(tools, data.call.name),
  component: PiLensRenderer,
};
