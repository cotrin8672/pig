import type { ToolCall } from "@earendil-works/pi-ai";
import type { ChatRenderData, ChatRendererProps } from "@pig/chat-renderers";
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
import {
  createContext,
  memo,
  type ReactNode,
  useContext,
  useLayoutEffect,
  useState,
} from "react";
import type { ToolCard, ToolCardBlock } from "../../../../packages/config/src";
import {
  diffStats,
  resultText,
  SHELL_TOOLS,
  shellOutcome,
} from "../shared/tool-view";
import type { Transcript } from "../shared/transcript";
import { ChatContent } from "./ChatContent";
import {
  CodeText,
  HighlightedDiff as Diff,
  TerminalOutput,
} from "./HighlightedCode";
import { useT } from "./i18n";
import { DisclosureContext, DisclosureScope } from "./LazyDetails";
import { Markdown, MessageContent, ToolResultContent } from "./MessageContent";
import { languageFromPath, terminalText } from "./syntax-highlighting";

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

const ToolCallContext = createContext<string | undefined>(undefined);

/** Keep disclosure state and search identity on the original details node. */
function Details({
  className,
  name = "body",
  defaultOpen = false,
  children,
}: {
  className: string;
  name?: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const toolCallId = useContext(ToolCallContext);
  const { values, scope, reveal } = useContext(DisclosureContext);
  const key = `${scope}/${name}`;
  const [open, setOpen] = useState(
    () => !!reveal || (values?.[key] ?? defaultOpen),
  );
  useLayoutEffect(() => {
    if (reveal) {
      setOpen(true);
      if (values) values[key] = true;
    }
  }, [reveal, key, values]);
  return (
    <details
      className={className}
      data-disclosure={name}
      data-tool-call-id={toolCallId}
      open={open}
      onToggle={(event) => {
        const next = event.currentTarget.open;
        if (values) values[key] = next;
        setOpen(next);
      }}
    >
      {children}
    </details>
  );
}

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
  defaultOpen,
  children,
}: {
  icon: ReactNode;
  verb: string;
  target: string;
  meta?: ReactNode;
  state: ToolState;
  status: Tone;
  defaultOpen?: boolean;
  children?: ReactNode;
}) {
  const t = useT();
  return (
    <Details className={`tool-row ${status}`} defaultOpen={defaultOpen}>
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
    </Details>
  );
}

function Shell({
  command,
  state,
  status,
  language,
}: {
  command: string;
  state: ToolState;
  status: Tone;
  language: string;
}) {
  const t = useT();
  const { output, exitCode } = shellOutcome(resultText(state?.result));
  const text = terminalText(output).trimEnd();
  const lines = text ? text.split("\n") : [];
  return (
    <Details className={`tool-term ${status}`} defaultOpen>
      <summary>
        <span className="tool-prompt">❯</span>
        <code className="tool-cmd" title={command}>
          <CodeText text={command} language={language} />
        </code>
        <span className="tool-meta">
          {status === "running" && (
            <LoaderCircle size={11} className="spinner" />
          )}
          <span className="tool-state">
            {status === "running"
              ? t.Running
              : status === "done"
                ? "exit 0"
                : exitCode === undefined
                  ? t.Failed
                  : `exit ${exitCode}`}
          </span>
          <Chevron />
        </span>
      </summary>
      {text && <pre className="tool-peek">{lines.slice(-2).join("\n")}</pre>}
      <pre className="tool-term-output">
        {lines.length === 0 ? (
          t["No output"]
        ) : (
          <TerminalOutput text={output.trimEnd()} />
        )}
        {status === "running" && <span className="tool-cursor" />}
      </pre>
    </Details>
  );
}

/** Fixed templates for config-provided tool cards; card data never becomes markup. */
function CardBlock({ block }: { block: ToolCardBlock }) {
  switch (block.type) {
    case "text":
      return block.format === "markdown" ? (
        <div className="prose">
          <Markdown text={block.text} />
        </div>
      ) : (
        <pre className="tool-code">{block.text}</pre>
      );
    case "code":
      return <pre className="tool-code">{block.text}</pre>;
    case "terminal":
      return (
        <pre className="tool-code">
          <TerminalOutput text={block.text} />
        </pre>
      );
    case "diff":
      return <Diff text={block.text} />;
    case "facts":
      return (
        <dl className="tool-facts">
          {block.items.map((item, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: Labels may repeat; order is static.
            <div key={index}>
              <dt>{item.label}</dt>
              <dd>{item.value}</dd>
            </div>
          ))}
        </dl>
      );
    case "list":
      return (
        <ul className="tool-list">
          {block.items.map((item, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: Titles may repeat; order is static.
            <li key={index} className={item.state}>
              <span className="tool-list-title">{item.title}</span>
              {item.description && (
                <span className="tool-list-description">
                  {item.description}
                </span>
              )}
            </li>
          ))}
        </ul>
      );
  }
}

const ICON = 14;

export const ToolBlock = memo(function ToolBlock(data: ChatRenderData["tool"]) {
  return (
    <ToolCallContext.Provider value={data.call.id}>
      <DisclosureScope id={`tool:${data.call.id}`}>
        <ChatContent
          kind="tool"
          data={data}
          contentKey={data.call.id}
          builtin={BuiltinTool}
        />
      </DisclosureScope>
    </ToolCallContext.Provider>
  );
});

export function BuiltinTool({
  data: { call, state, live, card },
}: ChatRendererProps<"tool">) {
  const t = useT();
  const status = tone(state, live);
  if (card)
    return (
      <Row
        icon={<Plug size={ICON} />}
        verb={card.title}
        target={card.target ?? ""}
        meta={card.meta}
        state={state}
        status={status}
      >
        {card.body?.map((block, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: Card blocks are ordered data.
          <CardBlock key={index} block={block} />
        ))}
      </Row>
    );
  const args = (call.arguments ?? {}) as Record<string, unknown>;
  const path = str(args.path);
  if (SHELL_TOOLS.has(call.name))
    return (
      <Shell
        command={str(args.command)}
        state={state}
        status={status}
        language={call.name}
      />
    );
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
          defaultOpen
        >
          {diff && state?.status === "done" ? (
            <Diff text={diff} path={path} numbered />
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
            <pre className="tool-code">
              <CodeText text={content} language={languageFromPath(path)} />
            </pre>
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
}

/** Two or more consecutive read/grep/find/ls calls, collapsed into one row. */
export const ToolGroup = memo(function ToolGroup({
  calls,
  tools,
  live,
  cards,
  target,
}: {
  calls: ToolCall[];
  tools: Transcript["tools"];
  live: boolean;
  cards?: Record<string, ToolCard>;
  target?: { toolCallId: string; serial: number };
}) {
  const t = useT();
  const tones = calls.map((call) => tone(tools[call.id], live));
  const running = tones.includes("running");
  const failed = tones.includes("error");
  const count = (...names: string[]) =>
    calls.filter((call) => names.includes(call.name)).length;
  return (
    <Details
      name={`group:${calls[0]?.id}`}
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
          <DisclosureScope
            key={call.id}
            id={`call:${call.id}`}
            reveal={target?.toolCallId === call.id ? target.serial : 0}
          >
            <ToolBlock
              call={call}
              state={tools[call.id]}
              live={live}
              card={cards?.[call.id]}
            />
          </DisclosureScope>
        ))}
      </div>
    </Details>
  );
});

export const ThinkingBlock = memo(function ThinkingBlock(
  data: ChatRenderData["thinking"],
) {
  return <ChatContent kind="thinking" data={data} builtin={BuiltinThinking} />;
});

export function BuiltinThinking({
  data: { text, label, active },
}: ChatRendererProps<"thinking">) {
  const t = useT();
  if (active)
    return (
      <div className="thinking active">
        <Brain size={ICON} />
        <span className="thinking-shimmer">{t["Thinking…"]}</span>
      </div>
    );
  return (
    <Details className="thinking" defaultOpen>
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
    </Details>
  );
}

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

export { Row as ToolRow, tone as toolTone };
