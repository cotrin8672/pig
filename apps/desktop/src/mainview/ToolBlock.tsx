import type { ToolCall } from "@earendil-works/pi-ai";
import {
  Brain,
  ChevronRight,
  FilePlus,
  FileText,
  Folder,
  Layers,
  LoaderCircle,
  Pencil,
  Plug,
  Search,
} from "lucide-react";
import { memo, type ReactNode } from "react";
import {
  diffStats,
  resultText,
  SHELL_TOOLS,
  shellOutcome,
} from "../shared/tool-view";
import type { Transcript } from "../shared/transcript";
import { useT } from "./i18n";
import { Markdown, MessageContent, ToolResultContent } from "./MessageContent";

type ToolState = Transcript["tools"][string] | undefined;
type Tone = "running" | "done" | "error";

// A call without a final result is still running while the agent is live; afterwards it was interrupted.
const tone = (state: ToolState, live: boolean): Tone =>
  state?.status === "done" || state?.status === "error"
    ? state.status
    : live
      ? "running"
      : "error";
const str = (value: unknown) => (typeof value === "string" ? value : "");
const resultContent = (result: unknown) =>
  result &&
  typeof result === "object" &&
  "content" in result &&
  Array.isArray(result.content)
    ? (result.content as Parameters<typeof MessageContent>[0]["content"])
    : undefined;

const Chevron = () => <ChevronRight size={12} className="tool-chevron" />;

function Output({ state }: { state: ToolState }) {
  const content = resultContent(state?.result);
  return content?.length ? (
    <div className="tool-output">
      <MessageContent content={content} markdown={false} />
    </div>
  ) : null;
}

/** One-line row; expands to its body. */
function Row({
  icon,
  verb,
  target,
  meta,
  state,
  status,
  children,
}: {
  icon: ReactNode;
  verb: string;
  target: string;
  meta?: ReactNode;
  state: ToolState;
  status: Tone;
  children?: ReactNode;
}) {
  const t = useT();
  return (
    <details className={`tool-row ${status}`}>
      <summary>
        {icon}
        <span className="tool-verb">{verb}</span>
        <code className="tool-target" title={target}>
          {target}
        </code>
        <span className="tool-meta">
          {status === "running" ? (
            <LoaderCircle size={12} className="spinner" />
          ) : status === "error" ? (
            <span className="tool-failed">{t.Failed}</span>
          ) : (
            meta
          )}
          <Chevron />
        </span>
      </summary>
      <div className="tool-body">{children ?? <Output state={state} />}</div>
    </details>
  );
}

function Shell({
  command,
  state,
  status,
}: {
  command: string;
  state: ToolState;
  status: Tone;
}) {
  const t = useT();
  const { output, exitCode } = shellOutcome(resultText(state?.result));
  const text = output.trimEnd();
  return (
    <details className={`tool-term ${status}`}>
      <summary>
        <span className="tool-prompt">$</span>
        <code className="tool-cmd" title={command}>
          {command}
        </code>
        <span className="tool-meta">
          {status === "running" ? (
            <LoaderCircle size={12} className="spinner" />
          ) : (
            <span className={`tool-badge ${status}`}>
              {status === "done"
                ? "exit 0"
                : exitCode === undefined
                  ? t.Failed
                  : `exit ${exitCode}`}
            </span>
          )}
          <Chevron />
        </span>
      </summary>
      {text && (
        <pre className="tool-peek">{text.split("\n").slice(-2).join("\n")}</pre>
      )}
      <pre className="tool-term-output">{text || t["No output"]}</pre>
    </details>
  );
}

const ICON = 14;

export const ToolBlock = memo(function ToolBlock({
  call,
  state,
  live,
}: {
  call: ToolCall;
  state: ToolState;
  live: boolean;
}) {
  const t = useT();
  const status = tone(state, live);
  const args = (call.arguments ?? {}) as Record<string, unknown>;
  const path = str(args.path);
  if (SHELL_TOOLS.has(call.name))
    return <Shell command={str(args.command)} state={state} status={status} />;
  switch (call.name) {
    case "read": {
      const offset = Number(args.offset) || 0;
      const limit = Number(args.limit) || 0;
      return (
        <Row
          icon={<FileText size={ICON} />}
          verb={t.Read}
          target={path}
          meta={
            offset || limit
              ? `L${offset || 1}${limit ? `–${(offset || 1) + limit - 1}` : "+"}`
              : undefined
          }
          state={state}
          status={status}
        />
      );
    }
    case "grep":
      return (
        <Row
          icon={<Search size={ICON} />}
          verb={t.Search}
          target={`${str(args.pattern)}${path ? `  ${path}` : ""}${args.glob ? `  ${str(args.glob)}` : ""}`}
          state={state}
          status={status}
        />
      );
    case "find":
      return (
        <Row
          icon={<Search size={ICON} />}
          verb={t["Find files"]}
          target={`${str(args.pattern)}${path ? `  ${path}` : ""}`}
          state={state}
          status={status}
        />
      );
    case "ls":
      return (
        <Row
          icon={<Folder size={ICON} />}
          verb={t.List}
          target={path || "."}
          state={state}
          status={status}
        />
      );
    case "edit": {
      const details = (state?.result as { details?: { diff?: unknown } })
        ?.details;
      const diff = str(details?.diff);
      const { added, removed } = diffStats(diff);
      return (
        <Row
          icon={<Pencil size={ICON} />}
          verb={t.Edit}
          target={path}
          meta={
            diff && (
              <>
                <span className="tool-add">+{added}</span>
                <span className="tool-del">−{removed}</span>
              </>
            )
          }
          state={state}
          status={status}
        >
          {diff && state?.status === "done" ? (
            <pre className="tool-diff">
              {diff.split("\n").map((line, index) => (
                <span
                  // biome-ignore lint/suspicious/noArrayIndexKey: Diff lines are static and ordered.
                  key={index}
                  className={
                    line[0] === "+" ? "add" : line[0] === "-" ? "del" : ""
                  }
                >
                  {line}
                </span>
              ))}
            </pre>
          ) : (
            <Output state={state} />
          )}
        </Row>
      );
    }
    case "write": {
      const content = str(args.content);
      return (
        <Row
          icon={<FilePlus size={ICON} />}
          verb={t.Write}
          target={path}
          meta={<span className="tool-add">+{content.split("\n").length}</span>}
          state={state}
          status={status}
        >
          {state?.status === "error" ? (
            <Output state={state} />
          ) : (
            <pre className="tool-code">{content}</pre>
          )}
        </Row>
      );
    }
    default:
      return (
        <Row
          icon={<Plug size={ICON} />}
          verb={call.name}
          target={JSON.stringify(args)}
          state={state}
          status={status}
        >
          <pre className="tool-code">{JSON.stringify(args, null, 2)}</pre>
          <ToolResultContent result={state?.result} />
        </Row>
      );
  }
});

/** Two or more consecutive read/grep/find/ls calls, collapsed into one row. */
export const ToolGroup = memo(function ToolGroup({
  calls,
  tools,
  live,
}: {
  calls: ToolCall[];
  tools: Transcript["tools"];
  live: boolean;
}) {
  const t = useT();
  const tones = calls.map((call) => tone(tools[call.id], live));
  const running = tones.includes("running");
  const failed = tones.includes("error");
  const count = (...names: string[]) =>
    calls.filter((call) => names.includes(call.name)).length;
  return (
    <details
      className={`tool-row tool-group ${running ? "running" : failed ? "error" : "done"}`}
    >
      <summary>
        <Layers size={ICON} />
        <span className="tool-verb">{t.Explored}</span>
        <span className="tool-target">
          {t.exploreSummary(count("read"), count("grep", "find"), count("ls"))}
        </span>
        <span className="tool-meta">
          {running && <LoaderCircle size={12} className="spinner" />}
          {!running && failed && (
            <span className="tool-failed">{t.Failed}</span>
          )}
          <Chevron />
        </span>
      </summary>
      <div className="tool-group-body">
        {calls.map((call) => (
          <ToolBlock
            key={call.id}
            call={call}
            state={tools[call.id]}
            live={live}
          />
        ))}
      </div>
    </details>
  );
});

export const ThinkingBlock = memo(function ThinkingBlock({
  text,
  label,
  active,
}: {
  text: string;
  label: string;
  active: boolean;
}) {
  const t = useT();
  if (active)
    return (
      <div className="thinking active">
        <Brain size={ICON} />
        <span className="thinking-shimmer">{t["Thinking…"]}</span>
      </div>
    );
  return (
    <details className="thinking">
      <summary>
        <Brain size={ICON} />
        {label}
        {text && <Chevron />}
      </summary>
      {text && (
        <div className="thinking-body">
          <Markdown text={text} />
        </div>
      )}
    </details>
  );
});

/** Folds a finished response's work (thinking, tools, interim text) above its final answer. */
export function WorkToggle({
  open,
  tools,
  onToggle,
}: {
  open: boolean;
  tools: number;
  onToggle: () => void;
}) {
  const t = useT();
  return (
    <button
      type="button"
      className="work-toggle"
      aria-expanded={open}
      onClick={onToggle}
    >
      <Chevron />
      {open ? t["Hide work"] : t["Show work"]}
      {tools > 0 && (
        <span className="work-toggle-meta">{t.toolCalls(tools)}</span>
      )}
    </button>
  );
}
