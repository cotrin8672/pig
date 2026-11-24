// biome-ignore-all lint/suspicious/noArrayIndexKey: Source lines keep their order and may repeat.
import {
  Box,
  Hash,
  Import,
  SquareFunction,
  TriangleAlert,
  Type,
  Variable,
} from "lucide-react";
import type { ComponentType, ReactNode } from "react";
import { CodeText } from "../../mainview/HighlightedCode";
import { PiLensRenderer } from "../../mainview/PiLensRenderer";
import { DisclosureScope } from "../../mainview/patterns/LazyDetails";
import { languageFromPath } from "../../mainview/syntax-highlighting";
import { ToolBlock, ToolRow } from "../../mainview/ToolBlock";
import {
  atPhase,
  type Phase,
  type Proposal,
  stories,
  type Tool,
  type ToolFixture,
  type ToolProps,
} from "./kit";
import { baseName, body, dirName } from "./lens-model";
import "./lens.css";
import { Spinner } from "../../mainview/primitives/Spinner";

/** Default is the shipped pi-lens renderer, so each proposal is compared with today. */
const Shipped = ({ tool }: ToolProps) => (
  <DisclosureScope id={`story:${tool.call.id}`}>
    <PiLensRenderer data={tool} DefaultRenderer={() => null} />
  </DisclosureScope>
);
/** Tools without a dedicated renderer fall back to the generic built-in row. */
export const Builtin = ({ tool }: ToolProps) => <ToolBlock {...tool} />;
export function lensStories<K extends string>(
  fixture: ToolFixture,
  proposals: Record<K, Proposal<ToolProps>>,
  Default: ComponentType<ToolProps> = Shipped,
) {
  return stories(
    proposals,
    Default,
    ({ phase = "done" }: { phase?: Phase }) => ({
      tool: atPhase(fixture, phase),
      phase,
    }),
    fixture,
  );
}

export const Spin = ({ size = 12 }: { size?: number }) => (
  <Spinner size={size} label="実行中" />
);

/** The built-in collapsible tool row, so proposals share the transcript's rhythm. */
export function Row({
  tool,
  phase,
  icon,
  verb,
  target,
  meta,
  open = true,
  children,
}: ToolProps & {
  icon: ReactNode;
  verb: string;
  target: string;
  meta?: ReactNode;
  open?: boolean;
  children?: ReactNode;
}) {
  return (
    <DisclosureScope id={`story:${tool.call.id}:${verb}`}>
      <ToolRow
        icon={icon}
        verb={verb}
        target={target}
        meta={meta}
        state={tool.state}
        status={phase}
        defaultOpen={open}
      >
        <Phased tool={tool} phase={phase}>
          {children}
        </Phased>
      </ToolRow>
    </DisclosureScope>
  );
}

/** Running shows a quiet placeholder, errors show the tool's own message. */
export function Phased({
  tool,
  phase,
  children,
}: ToolProps & { children?: ReactNode }) {
  if (phase === "running")
    return (
      <div className="lx-waiting" role="status" aria-label="結果を待っています">
        <span />
        <span />
        <span />
      </div>
    );
  if (phase === "error") return <Fail tool={tool} />;
  return children;
}
export function Fail({ tool }: { tool: Tool }) {
  return (
    <p className="lx-fail">
      <TriangleAlert size={13} />
      <span>{body(tool) || "結果を受け取る前に中断されました。"}</span>
    </p>
  );
}

/** Numbered, highlighted source with the shared 8-line preview height. */
export function Code({
  text,
  path,
  start = 1,
  mark,
  className = "",
}: {
  text: string;
  path: string;
  start?: number;
  mark?: number;
  className?: string;
}) {
  return (
    <pre className={`lx-code ${className}`}>
      <span className="lx-gutter" aria-hidden="true">
        {text.split("\n").map((_, i) => (
          <span key={i} className={start + i === mark ? "lx-marked" : ""}>
            {start + i}
          </span>
        ))}
      </span>
      <code>
        <CodeText text={text} language={languageFromPath(path)} />
      </code>
    </pre>
  );
}

/** A path whose directory recedes, so the file name reads first. */
export const Path = ({ path, line }: { path: string; line?: number }) => (
  <code className="lx-path" title={path}>
    {dirName(path) && <span>{dirName(path)}/</span>}
    {baseName(path)}
    {line !== undefined && <small>:{line}</small>}
  </code>
);

export type Tone = "neutral" | "accent" | "ok" | "warn" | "error" | "info";
export const Badge = ({
  tone = "neutral",
  children,
}: {
  tone?: Tone;
  children: ReactNode;
}) => <span className={`lx-badge lx-${tone}`}>{children}</span>;

/** Card header for proposals that leave the tool row. */
export function CardHead({
  icon,
  title,
  sub,
  phase,
  aside,
}: {
  icon: ReactNode;
  title: ReactNode;
  sub?: ReactNode;
  phase: Phase;
  aside?: ReactNode;
}) {
  return (
    <header className="lx-card-head">
      <span className="lx-card-icon">{icon}</span>
      <span className="lx-card-title">
        <strong>{title}</strong>
        {sub && <small>{sub}</small>}
      </span>
      <span className="lx-card-aside">
        {phase === "running" ? (
          <Spin />
        ) : phase === "error" ? (
          <Badge tone="error">失敗</Badge>
        ) : (
          aside
        )}
      </span>
    </header>
  );
}

/** One glyph per symbol kind, so lists of symbols scan like an editor outline. */
export function KindIcon({ kind, size = 13 }: { kind: string; size?: number }) {
  const Icon =
    kind === "function" || kind === "method"
      ? SquareFunction
      : kind === "class"
        ? Box
        : kind === "struct" || kind === "type" || kind === "interface"
          ? Type
          : kind === "constant" || kind === "variable"
            ? Variable
            : kind === "import"
              ? Import
              : Hash;
  return (
    <Icon size={size} className={`lx-kind lx-kind-${kind}`} aria-label={kind} />
  );
}
export const kindLabel: Record<string, string> = {
  function: "関数",
  class: "クラス",
  struct: "型",
  type: "型",
  constant: "定数",
  import: "import",
};
