// biome-ignore-all lint/suspicious/noArrayIndexKey: Graph rows, chain steps and line numbers are positional and may repeat.
import type { ChatRenderer, ChatRendererProps } from "@pig/chat-renderers";
import {
  Aperture,
  ArrowRight,
  Box,
  Brackets,
  CircleCheck,
  CircleMinus,
  CirclePlus,
  CircleX,
  CornerDownRight,
  Crosshair,
  FileCog,
  FileText,
  Flame,
  Folder,
  Ghost,
  Hash,
  Import,
  Info,
  Lightbulb,
  LogIn,
  type LucideIcon,
  Network,
  RefreshCw,
  Replace,
  SquareFunction,
  TriangleAlert,
  Type,
  Variable,
} from "lucide-react";
import type { CSSProperties, ReactNode } from "react";
import { CodeText } from "./HighlightedCode";
import { useT } from "./i18n";
import { ToolResultContent } from "./MessageContent";
import {
  baseName,
  type LensBody,
  type LensItem,
  piLensBody,
  piLensSummary,
} from "./pi-lens-view";
import { languageFromPath } from "./syntax-highlighting";
import { ToolRow, toolTone } from "./ToolBlock";
import "./pi-lens.css";

export { piLensSummary };

// Exact registered names from pi-lens 4.4.x, not package-name/prefix guesses.
const tools = new Set([
  "read_symbol",
  "read_enclosing",
  "ast_grep_search",
  "ast_grep_replace",
  "ast_grep_outline",
  "lsp_navigation",
  "lens_diagnostics",
  "lens_diagnostic_mark",
  "symbol_search",
  "module_report",
  "project_report",
  "effective_config",
  "pi_lens_activate_tools",
]);

/** One glyph per symbol kind, severity or role; the class carries its colour. */
const glyphs: Record<string, LucideIcon> = {
  function: SquareFunction,
  method: SquareFunction,
  class: Box,
  struct: Type,
  type: Type,
  interface: Type,
  constant: Variable,
  variable: Variable,
  import: Import,
  error: CircleX,
  warning: TriangleAlert,
  info: Info,
  hint: Lightbulb,
  ref: CornerDownRight,
  origin: Crosshair,
  match: Brackets,
  change: Replace,
  file: FileText,
  next: ArrowRight,
  on: CircleCheck,
  off: CircleMinus,
  added: CirclePlus,
  config: FileCog,
  HUBS: Network,
  "ENTRY POINTS": LogIn,
  DIRECTORIES: Folder,
  cycle: RefreshCw,
  "RISK HOTSPOTS": Flame,
  "DEAD WEIGHT": Ghost,
};
const glyphClass = (item: LensItem) =>
  `lens-glyph lens-g-${item.tone ?? item.glyph.toLowerCase().replace(/\s+/g, "-")}`;
function Glyph({ item }: { item: LensItem }) {
  const Icon = glyphs[item.glyph] ?? Hash;
  return <Icon size={12} className={glyphClass(item)} aria-hidden="true" />;
}

const ROW = 24;
/** CSS custom properties are typed as plain style keys. */
const place = (vars: Record<string, string>) => vars as CSSProperties;
const curve = (x1: number, y1: number, x2: number, y2: number) =>
  `M${x1} ${y1} C${(x1 + x2) / 2} ${y1} ${(x1 + x2) / 2} ${y2} ${x2} ${y2}`;

/** origin → group → result, one result per row. */
function Graph({ body }: { body: Extract<LensBody, { type: "graph" }> }) {
  // A lone group is skipped unless it is a file the origin does not already name.
  const lone = body.groups[0];
  const tiered =
    body.groups.length > 1 ||
    (lone?.isFile === true && !body.root.startsWith(baseName(lone.title)));
  const rows = body.groups.reduce((sum, g) => sum + g.items.length, 0);
  const height = rows * ROW;
  const leafX = tiered ? 58 : 34;
  let row = 0;
  const placed = body.groups.map((group) => {
    const ys = group.items.map(() => row++ * ROW + ROW / 2);
    return { group, ys, y: (ys[0] + ys[ys.length - 1]) / 2 };
  });
  // The root stays within the first ~8 rows, so a graph that scrolls still shows its origin.
  const rootY = Math.min(height / 2, 4 * ROW);
  return (
    <div className="lens-frame">
      <div className="lens-graph" style={place({ "--lens-h": `${height}px` })}>
        <svg
          viewBox={`0 0 100 ${height}`}
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          {placed.flatMap(({ group, ys, y }, g) => [
            tiered && <path key={`g${g}`} d={curve(26, rootY, 32, y)} />,
            ...group.items.map((item, i) => (
              <path
                key={`${g}-${i}`}
                className={glyphClass(item)}
                d={
                  tiered
                    ? curve(54, y, leafX, ys[i])
                    : curve(26, rootY, leafX, ys[i])
                }
              />
            )),
          ])}
        </svg>
        <span
          className="lens-node lens-root"
          style={place({ "--lens-y": `${rootY}px` })}
        >
          <Aperture size={12} aria-hidden="true" />
          <span>{body.root}</span>
        </span>
        {placed.map(({ group, ys, y }, g) => (
          <div key={g}>
            {tiered && (
              <span
                className="lens-node lens-group"
                style={place({ "--lens-y": `${y}px` })}
                aria-description={group.title}
              >
                <span>
                  {group.isFile ? baseName(group.title) : group.title}
                </span>
                <small>{group.items.length}</small>
              </span>
            )}
            {group.items.map((item, i) => (
              <span
                key={i}
                className={`lens-node lens-leaf ${tiered ? "tiered" : ""}`}
                style={place({ "--lens-y": `${ys[i]}px` })}
                aria-description={item.file ?? item.text}
              >
                <Glyph item={item} />
                <span>{item.file ? baseName(item.file) : item.text}</span>
                {item.loc && <small>{item.loc}</small>}
              </span>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function Chain({ steps }: { steps: ReactNode[] }) {
  return (
    <div className="lens-chain">
      {steps.map((step, i) => (
        <span key={i} className="lens-step">
          {i > 0 && <ArrowRight size={12} aria-hidden="true" />}
          <span className="lens-node">{step}</span>
        </span>
      ))}
    </div>
  );
}

function Code({ body }: { body: Extract<LensBody, { type: "code" }> }) {
  const lines = body.code.split("\n");
  return (
    <>
      <Chain
        steps={[
          <code key="path">{body.path}</code>,
          <span key="symbol" className="lens-symbol">
            <Glyph item={{ glyph: body.kind, text: body.name }} />
            {body.name}
          </span>,
          `L${body.start}–${body.end}`,
        ]}
      />
      <pre className="lens-code">
        <span className="lens-gutter" aria-hidden="true">
          {lines.map((_, i) => (
            <span
              key={i}
              className={body.start + i === body.mark ? "marked" : undefined}
            >
              {body.start + i}
            </span>
          ))}
        </span>
        <code>
          <CodeText text={body.code} language={languageFromPath(body.path)} />
        </code>
      </pre>
    </>
  );
}

function Body({ body }: { body: LensBody }) {
  if (body.type === "graph") return <Graph body={body} />;
  if (body.type === "code") return <Code body={body} />;
  return (
    <div className="lens-frame">
      <Chain steps={body.steps} />
      {body.note && <p className="lens-note">{body.note}</p>}
    </div>
  );
}

/** pi-lens: one lens mark for every tool, results drawn as a relation map. */
export function PiLensRenderer({ data }: ChatRendererProps<"tool">) {
  const t = useT().piLens;
  const { verb, target, meta } = piLensSummary(data, t);
  const status =
    (data.state?.result as { isError?: unknown } | undefined)?.isError === true
      ? "error"
      : toolTone(data.state, data.live);
  const body = status === "done" ? piLensBody(data, t) : undefined;
  return (
    <ToolRow
      defaultOpen={body !== undefined}
      icon={<Aperture size={14} className="lens-mark" aria-label="pi-lens" />}
      verb={verb}
      target={target}
      meta={meta}
      state={data.state}
      status={status}
    >
      {body ? (
        <Body body={body} />
      ) : (
        <ToolResultContent result={data.state?.result} />
      )}
    </ToolRow>
  );
}

export const piLensRenderer: ChatRenderer<"tool"> = {
  id: "builtin:pi-lens",
  kind: "tool",
  match: (data) => !data.card && tools.has(data.call.name),
  component: PiLensRenderer,
};
