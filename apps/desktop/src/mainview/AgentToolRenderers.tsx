// biome-ignore-all lint/suspicious/noArrayIndexKey: Child runs, options and jobs keep their order and may repeat.
import type { ChatRenderer, ChatRendererProps } from "@pig/chat-renderers";
import {
  Bot,
  CalendarClock,
  Check,
  ChevronRight,
  CornerDownRight,
  MessageCircleQuestion,
  Repeat,
} from "lucide-react";
import { useState } from "react";
import { useT } from "./i18n";
import { ToolResultContent } from "./MessageContent";
import { Spinner } from "./primitives/Spinner";
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

const summary = (item: Question) =>
  item.response?.kind === "freeform"
    ? item.response.text
    : (item.response?.selections.join(", ") ?? "");

/** A regular tool row: the question and answer in the summary; every option, and which one won, inside. */
export function AskUserRenderer({ data }: ChatRendererProps<"tool">) {
  const t = useT().agentTools;
  const tone = status(data);
  const questions = questionsOf(data);
  const cancelled = details(data).cancelled === true;
  const single = questions.length === 1 ? questions[0] : undefined;
  return (
    <ToolRow
      defaultOpen={tone === "done" && !cancelled}
      icon={<MessageCircleQuestion size={14} />}
      verb={t.question}
      target={single ? single.question : t.questions(questions.length)}
      meta={
        cancelled
          ? t.cancelled
          : single
            ? summary(single) || t.answered
            : t.answered
      }
      state={data.state}
      status={tone}
    >
      {tone === "error" ? (
        <ToolResultContent result={data.state?.result} />
      ) : (
        questions.map((item, i) => <QuestionBlock key={i} item={item} t={t} />)
      )}
    </ToolRow>
  );
}

/* ---------------- subagent (pi-subagents) ---------------- */

type Lane = {
  agent: string;
  task: string;
  model?: string;
  state: "running" | "done" | "error";
  seconds?: number;
  output: string;
};
function modelRef(model: unknown, provider: unknown) {
  const id = str(model);
  const source = str(provider);
  return id && source && !id.startsWith(`${source}/`)
    ? `${source}/${id}`
    : id || source;
}

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
        model: modelRef(r.model, r.provider),
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
    model: str(obj(entry).model) || str(a.model),
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
              {lane.state === "running" ? <Spinner size={11} /> : <i />}
            </span>
            <span className="agent-name">@{lane.agent}</span>
            <span className="agent-task">{lane.task}</span>
            {lane.model && <span className="agent-model">{lane.model}</span>}
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

/* ---------------- spawn_agent … (pi-codex-subagents) ---------------- */

const CODEX_AGENT_TOOLS = new Set([
  "spawn_agent",
  "wait_agent",
  "wait_all_agents",
  "list_agents",
  "read_agent_response",
  "send_message",
  "interrupt_agent",
]);
function outputJson(tool: Tool): Value {
  try {
    return obj(JSON.parse(outputText(tool)));
  } catch {
    return {}; // Truncated output; the raw text is shown instead.
  }
}
function agentLane(entry: unknown): Lane {
  const e = obj(entry);
  const state = str(e.status) || str(e.agent_status);
  return {
    agent: str(e.task_name) || str(e.agent_name) || str(e.agentName),
    task: "",
    state:
      state === "running" || state === "starting"
        ? "running"
        : state === "failed" || state === "interrupted"
          ? "error"
          : "done",
    output:
      str(e.final_response) ||
      str(e.finalResponse) ||
      str(e.error) ||
      str(e.summary),
  };
}
const mention = (name: unknown) => (str(name) ? `@${str(name)}` : "");
const targets = (value: unknown) =>
  Array.isArray(value) ? value.map(mention).filter(Boolean).join(" · ") : "";

/** Codex-style agent tools: one row each, child results as agent lanes. */
export function CodexAgentRenderer({ data }: ChatRendererProps<"tool">) {
  const t = useT().agentTools;
  const tone = status(data);
  const a = args(data);
  const d = details(data);
  const name = data.call.name;
  const done = tone === "done";
  let target = mention(a.target);
  let meta = "";
  let lanes: Lane[] = [];
  let prompt = "";
  if (name === "spawn_agent") {
    target = [
      mention(a.task_name || d.task_name),
      modelRef(d.modelId, d.provider) || str(a.model),
    ]
      .filter(Boolean)
      .join(" · ");
    meta = [str(a.agent_type), str(d.thinking) || str(a.thinking)]
      .filter(Boolean)
      .join(" · ");
    prompt = str(a.message);
  } else if (name === "send_message") {
    meta = d.delivery === "steer" ? t.steered : d.delivery ? t.newTurn : "";
    prompt = str(a.message);
  } else if (name === "interrupt_agent") {
    meta = t.statuses[str(d.previous_status)] ?? str(d.previous_status);
  } else if (name === "wait_agent") {
    target = targets(a.targets) || t.anyAgent;
    const event = d.run_id ? d : outputJson(data).event;
    if (event) lanes = [agentLane(event)];
    else if (Array.isArray(d.agents)) lanes = d.agents.map(agentLane);
  } else if (name === "wait_all_agents") {
    target = targets(a.targets) || t.allAgents;
    const responses = outputJson(data).responses;
    if (Array.isArray(responses)) lanes = responses.map(agentLane);
  } else if (name === "read_agent_response") {
    const response = outputJson(data);
    if (response.agent_name) lanes = [agentLane(response)];
  } else if (name === "list_agents") {
    const rows = obj(data.state?.result).details;
    if (Array.isArray(rows)) lanes = rows.map(agentLane);
    else if (Array.isArray(d.agents)) lanes = d.agents.map(agentLane);
    if (typeof d.total === "number") meta = t.agents(d.total);
  }
  return (
    <ToolRow
      defaultOpen={done && lanes.length > 0}
      icon={<Bot size={14} />}
      verb={t.agentVerbs[name] ?? name}
      target={target}
      meta={meta}
      state={data.state}
      status={tone}
    >
      {done && lanes.length ? (
        <Lanes lanes={lanes} t={t} />
      ) : done && prompt ? (
        <blockquote className="agent-prompt">{prompt}</blockquote>
      ) : (
        <ToolResultContent result={data.state?.result} />
      )}
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
export const codexAgentRenderer: ChatRenderer<"tool"> = {
  id: "builtin:pi-codex-subagents",
  kind: "tool",
  match: (data) => !data.card && CODEX_AGENT_TOOLS.has(data.call.name),
  component: CodexAgentRenderer,
};
export const schedulePromptRenderer: ChatRenderer<"tool"> = {
  id: "builtin:pi-schedule-prompt",
  kind: "tool",
  match: named("schedule_prompt"),
  component: SchedulePromptRenderer,
};
