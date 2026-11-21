// biome-ignore-all lint/suspicious/noArrayIndexKey: Child runs, options and jobs keep their order and may repeat.
import type { ChatRenderer, ChatRendererProps } from "@pig/chat-renderers";
import {
  Bot,
  CalendarClock,
  Check,
  ChevronRight,
  CornerDownRight,
  LoaderCircle,
  MessageCircleQuestion,
  Repeat,
} from "lucide-react";
import { useState } from "react";
import { useT } from "./i18n";
import { ToolResultContent } from "./MessageContent";
import { ToolRow, toolTone } from "./ToolBlock";
import "./agent-tools.css";

type Tool = ChatRendererProps<"tool">["data"];
type Dict = ReturnType<typeof useT>["agentTools"];
type Value = Record<string, unknown>;
const str = (value: unknown) => (typeof value === "string" ? value : "");
const obj = (value: unknown): Value =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Value)
    : {};
const args = (tool: Tool) => obj(tool.call.arguments);
const details = (tool: Tool) => obj(obj(tool.state?.result).details);
function outputText(tool: Tool): string {
  const content = obj(tool.state?.result).content;
  return Array.isArray(content)
    ? content
        .map((part) => (obj(part).type === "text" ? str(obj(part).text) : ""))
        .join("\n")
    : "";
}
function status(tool: Tool) {
  return obj(tool.state?.result).isError === true
    ? "error"
    : toolTone(tool.state, tool.live);
}

/* ---------------- ask_user (pi-ask-user) ---------------- */

type Option = { title: string; description?: string };
type Response =
  | { kind: "selection"; selections: string[]; comment?: string }
  | { kind: "freeform"; text: string };
type Question = {
  question: string;
  context: string;
  options: Option[];
  response: Response | null;
  skipped: boolean;
};
const options = (value: unknown): Option[] =>
  Array.isArray(value)
    ? value.flatMap((option) =>
        typeof option === "string"
          ? [{ title: option }]
          : str(obj(option).title)
            ? [
                {
                  title: str(obj(option).title),
                  description: str(obj(option).description) || undefined,
                },
              ]
            : [],
      )
    : [];
const response = (value: unknown): Response | null => {
  const r = obj(value);
  if (r.kind === "freeform") return { kind: "freeform", text: str(r.text) };
  if (r.kind === "selection" && Array.isArray(r.selections))
    return {
      kind: "selection",
      selections: r.selections.filter(
        (s): s is string => typeof s === "string",
      ),
      comment: str(r.comment) || undefined,
    };
  return null;
};
/** Single questions keep AskToolDetails; `questions` batches answer by index. */
function questionsOf(tool: Tool): Question[] {
  const a = args(tool);
  const d = details(tool);
  if (Array.isArray(a.questions)) {
    const answers = Array.isArray(d.answers) ? d.answers : [];
    return a.questions.map((entry, i) => {
      const answer = obj(answers[i]);
      return {
        question: str(obj(entry).question),
        context: str(obj(entry).context),
        options: options(obj(entry).options),
        response:
          answer.status === "answered" ? response(answer.response) : null,
        skipped: answer.status === "skipped",
      };
    });
  }
  return [
    {
      question: str(a.question) || str(d.question),
      context: str(a.context) || str(d.context),
      options: options(a.options ?? d.options),
      response: response(d.response),
      skipped: false,
    },
  ];
}

function QuestionBlock({ item, t }: { item: Question; t: Dict }) {
  const chosen =
    item.response?.kind === "selection" ? item.response.selections : [];
  const reply =
    item.response?.kind === "freeform"
      ? item.response.text
      : item.response?.comment;
  return (
    <section className="agent-question">
      <h4>{item.question}</h4>
      {item.context && <p className="agent-context">{item.context}</p>}
      {item.options.length > 0 && (
        <ul className="agent-options">
          {item.options.map((option, i) => {
            const picked = chosen.includes(option.title);
            return (
              <li key={i} data-picked={picked}>
                <span className="agent-key" aria-hidden="true">
                  {picked ? <Check size={12} /> : i + 1}
                </span>
                <span>
                  <strong>{option.title}</strong>
                  {option.description && <small>{option.description}</small>}
                </span>
              </li>
            );
          })}
        </ul>
      )}
      {reply && (
        <p className="agent-reply">
          <CornerDownRight size={13} aria-hidden="true" />
          {reply}
        </p>
      )}
      {item.skipped && <p className="agent-context">{t.skipped}</p>}
    </section>
  );
}

/** The question stays readable afterwards: every option, and which one won. */
export function AskUserRenderer({ data }: ChatRendererProps<"tool">) {
  const t = useT().agentTools;
  const tone = status(data);
  const questions = questionsOf(data);
  const cancelled = details(data).cancelled === true;
  const waiting = tone === "running";
  return (
    <article
      className="agent-card agent-ask"
      data-ui-surface="card"
      data-waiting={waiting}
      aria-label={t.question}
    >
      <header className="agent-card-head">
        <span className="agent-card-icon">
          <MessageCircleQuestion size={14} aria-hidden="true" />
        </span>
        <strong>{t.question}</strong>
        <span
          className="agent-badge"
          data-tone={
            waiting ? "waiting" : tone === "error" || cancelled ? "muted" : "ok"
          }
        >
          {waiting
            ? t.waiting
            : tone === "error" || cancelled
              ? t.cancelled
              : t.answered}
        </span>
      </header>
      {questions.map((item, i) => (
        <QuestionBlock key={i} item={item} t={t} />
      ))}
      {tone === "error" && !cancelled && (
        <p className="agent-error">{outputText(data)}</p>
      )}
    </article>
  );
}

/* ---------------- subagent (pi-subagents) ---------------- */

type Lane = {
  agent: string;
  task: string;
  state: "running" | "done" | "error";
  seconds?: number;
  output: string;
};
function lastAssistantText(messages: unknown): string {
  if (!Array.isArray(messages)) return "";
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = obj(messages[i]);
    if (message.role !== "assistant" || !Array.isArray(message.content))
      continue;
    const text = message.content
      .map((part) => (obj(part).type === "text" ? str(obj(part).text) : ""))
      .join("")
      .trim();
    if (text) return text;
  }
  return "";
}
function lanesOf(tool: Tool, tone: string): Lane[] {
  const results = details(tool).results;
  if (Array.isArray(results) && results.length)
    return results.map((entry) => {
      const r = obj(entry);
      const progress = obj(r.progressSummary ?? r.progress);
      const running =
        obj(r.progress).status === "running" ||
        obj(r.progress).status === "pending" ||
        (r.exitCode === undefined && tone === "running");
      const failed =
        (typeof r.exitCode === "number" && r.exitCode !== 0) ||
        r.stopped === true ||
        r.interrupted === true;
      const ms = progress.durationMs;
      return {
        agent: str(r.agent),
        task: str(r.task),
        state: running ? "running" : failed ? "error" : "done",
        seconds: typeof ms === "number" ? Math.round(ms / 1000) : undefined,
        output: str(r.finalOutput) || lastAssistantText(r.messages),
      };
    });
  const a = args(tool);
  const tasks = Array.isArray(a.tasks)
    ? a.tasks
    : Array.isArray(a.chain)
      ? a.chain
      : [a];
  return tasks.map((entry) => ({
    agent: str(obj(entry).agent) || "?",
    task: str(obj(entry).task),
    state: tone === "running" ? "running" : tone === "error" ? "error" : "done",
    output: tone === "running" ? "" : outputText(tool),
  }));
}
const duration = (seconds: number) =>
  seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m${seconds % 60}s`;

function Lanes({ lanes, t }: { lanes: Lane[]; t: Dict }) {
  const [open, setOpen] = useState<number | null>(null);
  return (
    <ol className="agent-lanes">
      {lanes.map((lane, i) => (
        <li key={i} data-state={lane.state}>
          <button
            type="button"
            aria-expanded={open === i}
            disabled={!lane.output}
            onClick={() => setOpen(open === i ? null : i)}
          >
            <span className="agent-state" aria-hidden="true">
              {lane.state === "running" ? (
                <LoaderCircle size={11} className="spinner" />
              ) : (
                <i />
              )}
            </span>
            <span className="agent-name">@{lane.agent}</span>
            <span className="agent-task">{lane.task}</span>
            <span className="agent-meta">
              {lane.state === "running"
                ? t.running
                : lane.state === "error"
                  ? t.failed
                  : lane.seconds !== undefined
                    ? duration(lane.seconds)
                    : ""}
            </span>
            <ChevronRight
              size={13}
              className="agent-chevron"
              aria-hidden="true"
            />
          </button>
          {open === i && lane.output && (
            // biome-ignore lint/a11y/noNoninteractiveTabindex: Keyboard users need to scroll long child output.
            <pre className="agent-output" tabIndex={0}>
              {lane.output}
            </pre>
          )}
        </li>
      ))}
    </ol>
  );
}

/** One row per child run: state dot, agent, task and time; output on demand. */
export function SubagentRenderer({ data }: ChatRendererProps<"tool">) {
  const t = useT().agentTools;
  const tone = status(data);
  const a = args(data);
  // Management calls (status, stop, …) have no child runs to show.
  if (str(a.action))
    return (
      <ToolRow
        icon={<Bot size={14} />}
        verb={t.subagent}
        target={[str(a.action), str(a.agent)].filter(Boolean).join(" ")}
        state={data.state}
        status={tone}
      >
        <ToolResultContent result={data.state?.result} />
      </ToolRow>
    );
  const lanes = lanesOf(data, tone);
  const failed = lanes.filter((lane) => lane.state === "error").length;
  return (
    <ToolRow
      defaultOpen
      icon={<Bot size={14} />}
      verb={t.subagent}
      target={lanes.map((lane) => `@${lane.agent}`).join(" · ")}
      meta={
        failed
          ? t.succeeded(lanes.length - failed, lanes.length)
          : t.allDone(lanes.length)
      }
      state={data.state}
      status={tone}
    >
      <Lanes lanes={lanes} t={t} />
    </ToolRow>
  );
}

/* ---------------- schedule_prompt (pi-schedule-prompt) ---------------- */

/** Common cron shapes in plain words; anything else stays the expression. */
export function cadence(type: string, schedule: string, t: Dict): string {
  if (!schedule) return "";
  if (type === "interval") return t.every(schedule);
  if (type === "once") return t.once(schedule);
  const daily = /^(?:0 )?(\d{1,2}) (\d{1,2}) \* \* \*$/.exec(schedule);
  if (daily) return t.daily(`${daily[2]}:${String(daily[1]).padStart(2, "0")}`);
  return schedule;
}

type Job = {
  enabled: boolean;
  name: string;
  id: string;
  type: string;
  schedule: string;
  prompt: string;
  next?: string;
  status: string;
};
/** Parses the `list` action text of pi-schedule-prompt 0.5. */
export function parseJobs(output: string): Job[] {
  const jobs: Job[] = [];
  for (const line of output.split("\n")) {
    const head = /^(\S) (.+) \(([\w-]+)\)$/.exec(line);
    if (head && !line.startsWith(" ")) {
      jobs.push({
        enabled: head[1] === "✓",
        name: head[2] ?? "",
        id: head[3] ?? "",
        type: "",
        schedule: "",
        prompt: "",
        status: "pending",
      });
      continue;
    }
    const job = jobs.at(-1);
    const field = line.trim();
    if (!job) continue;
    const typed = /^Type: (\S+) \| Schedule: (.+)$/.exec(field);
    if (typed) {
      job.type = typed[1] ?? "";
      job.schedule = typed[2] ?? "";
    } else if (field.startsWith("Prompt: ")) job.prompt = field.slice(8);
    else if (/^(Last|Never)/.test(field))
      job.next = /Next: (.+)$/.exec(field)?.[1]?.trim();
    else {
      const runs = /^Runs: \d+ \| Status: (\w+)/.exec(field);
      if (runs) job.status = runs[1] ?? "pending";
    }
  }
  return jobs;
}

function JobList({ jobs, t }: { jobs: Job[]; t: Dict }) {
  return (
    <ul className="agent-jobs">
      {jobs.map((job) => (
        <li key={job.id} data-enabled={job.enabled} data-status={job.status}>
          {job.type === "interval" ? (
            <Repeat size={13} aria-hidden="true" />
          ) : (
            <CalendarClock size={13} aria-hidden="true" />
          )}
          <span className="agent-job-name">{job.name}</span>
          <code className="agent-cadence">
            {cadence(job.type, job.schedule, t)}
          </code>
          <span className="agent-meta">
            {!job.enabled
              ? t.paused
              : job.status === "error"
                ? t.failed
                : job.next
                  ? t.next(job.next)
                  : ""}
          </span>
          <small className="agent-job-prompt">{job.prompt}</small>
        </li>
      ))}
    </ul>
  );
}

/** A regular tool row: the action and cadence in the summary, prompt inside. */
export function SchedulePromptRenderer({ data }: ChatRendererProps<"tool">) {
  const t = useT().agentTools;
  const tone = status(data);
  const a = args(data);
  const action = str(a.action) || "add";
  const jobs = action === "list" ? parseJobs(outputText(data)) : [];
  const prompt = str(a.prompt);
  return (
    <ToolRow
      defaultOpen={tone === "done" && (jobs.length > 0 || !!prompt)}
      icon={<CalendarClock size={14} />}
      verb={t.actions[action] ?? action}
      target={action === "list" ? "" : str(a.name) || str(a.jobId)}
      meta={
        action === "list"
          ? t.jobs(jobs.length)
          : cadence(str(a.type) || "cron", str(a.schedule), t)
      }
      state={data.state}
      status={tone}
    >
      {tone !== "done" ? (
        <ToolResultContent result={data.state?.result} />
      ) : action === "list" && jobs.length ? (
        <JobList jobs={jobs} t={t} />
      ) : prompt ? (
        <blockquote className="agent-prompt">{prompt}</blockquote>
      ) : (
        <ToolResultContent result={data.state?.result} />
      )}
    </ToolRow>
  );
}

const named =
  (name: string) =>
  (data: Tool): boolean =>
    !data.card && data.call.name === name;
export const askUserRenderer: ChatRenderer<"tool"> = {
  id: "builtin:pi-ask-user",
  kind: "tool",
  match: named("ask_user"),
  component: AskUserRenderer,
};
export const subagentRenderer: ChatRenderer<"tool"> = {
  id: "builtin:pi-subagents",
  kind: "tool",
  match: named("subagent"),
  component: SubagentRenderer,
};
export const schedulePromptRenderer: ChatRenderer<"tool"> = {
  id: "builtin:pi-schedule-prompt",
  kind: "tool",
  match: named("schedule_prompt"),
  component: SchedulePromptRenderer,
};
