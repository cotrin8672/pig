// biome-ignore-all lint/suspicious/noArrayIndexKey: Static fixture lines retain their order.
import {
  Brain,
  Check,
  ChevronRight,
  FileCode,
  Image,
  MessageSquare,
  User,
} from "lucide-react";
import { useState } from "react";
import { ImageGallery } from "../mainview/ImageGallery";
import { Markdown } from "../mainview/MessageContent";
import { designData as data } from "./design-data";
import type { ProposalVariant } from "./ToolDesigns";

export type ContentKind =
  | "assistant"
  | "user"
  | "thinking"
  | "images"
  | "annotations"
  | "footer"
  | "work"
  | "record"
  | "explore";
export const contentDesignNames: Record<ContentKind, [string, string, string]> =
  {
    assistant: ["Answer spread", "Evidence board", "Tabbed answer"],
    user: ["Request ticket", "Speech bubble", "Prompt document"],
    thinking: ["Thought flow", "Margin note", "Reasoning journal"],
    images: ["Contact sheet", "Filmstrip viewer", "Attachment browser"],
    annotations: ["Review matrix", "Inline review", "Comment inspector"],
    footer: ["Metric dashboard", "Run receipt", "Compact telemetry"],
    work: ["Work timeline", "Work summary", "Activity console"],
    explore: ["Exploration timeline", "File workspace", "Operation matrix"],
    record: ["Property inspector", "Event timeline", "JSON document"],
  };
const answerBlocks = data.answer.split("\n\n");
function AnswerDesign({ variant }: { variant: ProposalVariant }) {
  const [tab, setTab] = useState(0);
  const intro = answerBlocks.slice(0, 2).join("\n\n");
  const code = answerBlocks[2];
  const checks = answerBlocks.slice(3).join("\n\n");
  if (variant === 0)
    return (
      <div className="ux-answer-spread">
        <aside>
          <span>ANSWER</span>
          <strong>01</strong>
          <small>Findings</small>
        </aside>
        <article className="prose">
          <Markdown text={data.answer} />
        </article>
      </div>
    );
  if (variant === 1)
    return (
      <div className="ux-answer-board">
        <div className="prose ux-board-intro">
          <Markdown text={intro} />
        </div>
        <section className="ux-board-code">
          <header>
            <FileCode size={14} />
            SOURCE
          </header>
          <div className="prose">
            <Markdown text={code} />
          </div>
        </section>
        <section className="ux-board-checks">
          <header>
            <Check size={14} />
            VERIFICATION
          </header>
          <div className="prose">
            <Markdown text={checks} />
          </div>
        </section>
      </div>
    );
  return (
    <div className="ux-answer-tabs">
      <div className="prose">
        <Markdown text={intro} />
      </div>
      <fieldset aria-label="回答の内容">
        {["すべて", "コード", "検証"].map((label, i) => (
          <button
            key={label}
            type="button"
            aria-pressed={tab === i}
            onClick={() => setTab(i)}
          >
            {label}
          </button>
        ))}
      </fieldset>
      <div className="prose">
        <Markdown
          text={tab === 0 ? `${code}\n\n${checks}` : tab === 1 ? code : checks}
        />
      </div>
    </div>
  );
}
function RequestDesign({ variant }: { variant: ProposalVariant }) {
  if (variant === 0)
    return (
      <div className="ux-request-ticket">
        <aside>
          <User size={18} />
          <span>REQUEST</span>
        </aside>
        <div>
          <small>あなた</small>
          <p>{data.request}</p>
        </div>
      </div>
    );
  if (variant === 1)
    return (
      <div className="ux-request-speech">
        <div>
          <p>{data.request}</p>
          <small>あなた</small>
        </div>
        <span className="ux-avatar">
          <User size={16} />
        </span>
      </div>
    );
  return (
    <div className="ux-prompt-document">
      <div>
        <span>USER INPUT</span>
        <MessageSquare size={14} />
      </div>
      <p>
        <span aria-hidden="true">01</span>
        {data.request}
      </p>
      <div className="ux-prompt-rule" />
    </div>
  );
}
function ReasoningDesign({ variant }: { variant: ProposalVariant }) {
  if (variant === 0)
    return (
      <div className="ux-thought-flow">
        <div>
          <Brain size={18} />
          <span>Thinking</span>
        </div>
        <span className="ux-flow-connector" />
        <div className="prose">
          <Markdown text={data.reasoning} />
        </div>
      </div>
    );
  if (variant === 1)
    return (
      <div className="ux-margin-note">
        <div className="prose">
          <Markdown text={data.reasoning} />
        </div>
        <aside>
          <Brain size={14} />
          <span>Thinking</span>
          <span className="ux-note-rule" />
        </aside>
      </div>
    );
  return (
    <div className="ux-reasoning-journal">
      <header>
        <span>THINKING</span>
        <span>01 NOTE</span>
      </header>
      <div>
        <code>01</code>
        <div className="prose">
          <Markdown text={data.reasoning} />
        </div>
      </div>
    </div>
  );
}
function ImagesDesign({ variant }: { variant: ProposalVariant }) {
  const [selected, setSelected] = useState(0);
  if (variant === 0)
    return (
      <div className="ux-contact-sheet">
        {data.images.map((src, i) => (
          <figure key={src}>
            <ImageGallery sources={[src]} alt={`pig artwork ${i + 1}`} />
            <figcaption>
              <span>{String(i + 1).padStart(2, "0")}</span>
              {i === 0 ? "icon.png" : "icon.svg"}
            </figcaption>
          </figure>
        ))}
      </div>
    );
  if (variant === 1)
    return (
      <div className="ux-filmstrip">
        <div className="ux-filmstage">
          <ImageGallery
            sources={[data.images[selected]]}
            alt="Selected pig artwork"
          />
        </div>
        <div className="ux-thumbnail-strip">
          {data.images.map((src, i) => (
            <button
              type="button"
              key={src}
              aria-label={`画像 ${i + 1}`}
              aria-pressed={selected === i}
              onClick={() => setSelected(i)}
            >
              <img src={src} alt="" />
            </button>
          ))}
          <span>
            {selected + 1} / {data.images.length}
          </span>
        </div>
      </div>
    );
  return (
    <div className="ux-attachment-browser">
      <nav aria-label="添付ファイル">
        <h4>
          <Image size={14} />
          Attachments · {data.images.length}
        </h4>
        {data.images.map((src, i) => (
          <button
            type="button"
            key={src}
            aria-pressed={selected === i}
            onClick={() => setSelected(i)}
          >
            <img src={src} alt="" />
            <span>
              {i === 0 ? "icon.png" : "icon.svg"}
              <small>{i === 0 ? "PNG image" : "Vector image"}</small>
            </span>
            <ChevronRight size={12} />
          </button>
        ))}
      </nav>
      <section>
        <ImageGallery
          sources={[data.images[selected]]}
          alt="Selected attachment"
        />
      </section>
    </div>
  );
}
function AnnotationsDesign({ variant }: { variant: ProposalVariant }) {
  const [selected, setSelected] = useState(0);
  if (variant === 0)
    return (
      <div className="ux-review-matrix">
        <header>
          <span>引用</span>
          <span>コメント</span>
        </header>
        {data.annotations.map((item, i) => (
          <article key={item.quote}>
            <blockquote>
              <small>{String(i + 1).padStart(2, "0")}</small>
              {item.quote}
            </blockquote>
            <p>
              {item.comment || <span className="ux-note">コメントなし</span>}
            </p>
          </article>
        ))}
      </div>
    );
  if (variant === 1)
    return (
      <div className="ux-inline-review">
        {data.annotations.map((item, i) => (
          <article key={item.quote}>
            <div>
              <span>{i + 1}</span>
              <blockquote>{item.quote}</blockquote>
            </div>
            <p>
              <MessageSquare size={13} />
              {item.comment || "コメントなし"}
            </p>
          </article>
        ))}
      </div>
    );
  return (
    <div className="ux-comment-inspector">
      <nav aria-label="レビュー対象">
        {data.annotations.map((item, i) => (
          <button
            key={item.quote}
            type="button"
            aria-pressed={selected === i}
            onClick={() => setSelected(i)}
          >
            <span>{String(i + 1).padStart(2, "0")}</span>
            <span>{item.quote}</span>
          </button>
        ))}
      </nav>
      <section>
        <small>
          PASSAGE {selected + 1} / {data.annotations.length}
        </small>
        <blockquote>{data.annotations[selected].quote}</blockquote>
        <div>
          <MessageSquare size={14} />
          <p>{data.annotations[selected].comment || "コメントなし"}</p>
        </div>
      </section>
    </div>
  );
}
const metrics = [
  { label: "Duration", value: `${data.stats.durationMs / 1000}`, unit: "s" },
  { label: "Tools", value: `${data.stats.tools}`, unit: "calls" },
  { label: "Tokens", value: `${data.stats.totalTokens}`, unit: "total" },
  { label: "Speed", value: `${data.stats.tokensPerSecond}`, unit: "tok/s" },
];
function FooterDesign({ variant }: { variant: ProposalVariant }) {
  const date = new Date(data.stats.endedAt).toISOString();
  if (variant === 0)
    return (
      <div className="ux-run-dashboard">
        <header>
          <Check size={14} />
          <span>Completed</span>
          <code>{data.stats.model}</code>
        </header>
        <div>
          {metrics.map((item) => (
            <section key={item.label}>
              <small>{item.label}</small>
              <strong>
                {item.value}
                <span>{item.unit}</span>
              </strong>
            </section>
          ))}
        </div>
        <footer>
          <span>{data.stats.text}</span>
          <time dateTime={date}>{date}</time>
        </footer>
      </div>
    );
  if (variant === 1)
    return (
      <div className="ux-run-receipt">
        <aside>
          <Check size={24} />
          <strong>完了</strong>
          <small>{data.stats.stopReason}</small>
        </aside>
        <section>
          <h4>{data.stats.model}</h4>
          <dl>
            {metrics.map((item) => (
              <div key={item.label}>
                <dt>{item.label}</dt>
                <dd>
                  {item.value} {item.unit}
                </dd>
              </div>
            ))}
          </dl>
          <p>{data.stats.text}</p>
          <time dateTime={date}>{date}</time>
        </section>
      </div>
    );
  return (
    <div className="ux-telemetry">
      <div>
        <Check size={13} />
        <code>{data.stats.model}</code>
        {metrics.map((item) => (
          <span key={item.label} title={item.label}>
            <strong>{item.value}</strong> {item.unit}
          </span>
        ))}
      </div>
      <details>
        <summary>実行情報</summary>
        <p>{data.stats.text}</p>
        <dl>
          <dt>Stop reason</dt>
          <dd>{data.stats.stopReason}</dd>
          <dt>Completed</dt>
          <dd>
            <time dateTime={date}>{date}</time>
          </dd>
        </dl>
      </details>
    </div>
  );
}
function WorkDesign({
  variant,
  explore,
}: {
  variant: ProposalVariant;
  explore: boolean;
}) {
  const [selected, setSelected] = useState(0);
  const tasks = explore
    ? [
        { name: "ls", target: "src", output: "greeting.ts" },
        {
          name: "read",
          target: "src/greeting.ts",
          output: 'export const greeting = "Hello, world!";',
        },
      ]
    : [{ name: "Thinking", target: "Reasoning", output: data.reasoning }];
  const count = explore ? 2 : 1;
  if (variant === 0)
    return (
      <ol className="ux-work-timeline">
        {tasks.map((task, i) => (
          <li key={task.name}>
            <span className="ux-step-index">
              {String(i + 1).padStart(2, "0")}
            </span>
            <section>
              <header>
                <strong>{task.name}</strong>
                <code>{task.target}</code>
              </header>
              {explore ? (
                <pre>{task.output}</pre>
              ) : (
                <Markdown text={task.output} />
              )}
            </section>
          </li>
        ))}
        <li className="ux-work-total">
          <span />
          <small>
            {count} tool {count === 1 ? "call" : "calls"}
          </small>
        </li>
      </ol>
    );
  if (variant === 1)
    return (
      <div className="ux-workspace">
        <nav aria-label="作業内容">
          <div>
            <strong>{count}</strong>
            <small>TOOL CALLS</small>
          </div>
          {tasks.map((task, i) => (
            <button
              type="button"
              key={task.name}
              aria-pressed={selected === i}
              onClick={() => setSelected(i)}
            >
              <FileCode size={13} />
              {task.name}
              <span>{task.target}</span>
            </button>
          ))}
        </nav>
        <section>
          <h4>{tasks[selected].target}</h4>
          {explore ? (
            <pre>{tasks[selected].output}</pre>
          ) : (
            <div className="prose">
              <Markdown text={tasks[selected].output} />
            </div>
          )}
        </section>
      </div>
    );
  return (
    <div className="ux-operation-matrix">
      <header>
        <span>Operation</span>
        <span>Target / Result</span>
      </header>
      {tasks.map((task) => (
        <div key={task.name}>
          <code>{task.name}</code>
          <section>
            <small>{task.target}</small>
            {explore ? (
              <pre>{task.output}</pre>
            ) : (
              <Markdown text={task.output} />
            )}
          </section>
        </div>
      ))}
      <footer>
        {count} tool {count === 1 ? "call" : "calls"}
      </footer>
    </div>
  );
}
function RecordDesign({ variant }: { variant: ProposalVariant }) {
  const values = Object.entries(data.record);
  if (variant === 0)
    return (
      <div className="ux-property-inspector">
        <header>
          <span>CUSTOM ENTRY</span>
          <code>review.checkpoint</code>
        </header>
        <dl>
          {values.map(([key, value]) => (
            <div key={key}>
              <dt>{key}</dt>
              <dd>{value}</dd>
              <span>string</span>
            </div>
          ))}
        </dl>
      </div>
    );
  if (variant === 1)
    return (
      <div className="ux-record-event">
        <aside>
          <span />
          <small>EVENT</small>
        </aside>
        <section>
          <h4>review.checkpoint</h4>
          <div className="ux-event-object">
            {values.map(([key, value]) => (
              <div key={key}>
                <small>{key}</small>
                <strong>{value}</strong>
              </div>
            ))}
          </div>
        </section>
      </div>
    );
  return (
    <div className="ux-json-document">
      <header>
        <code>review.checkpoint.json</code>
        <small>CUSTOM ENTRY</small>
      </header>
      <pre>
        {JSON.stringify(data.record, null, 2)
          .split("\n")
          .map((line, i) => (
            <span key={`json-${i}`}>
              <small aria-hidden="true">{i + 1}</small>
              {line}
              {"\n"}
            </span>
          ))}
      </pre>
    </div>
  );
}
export function ContentDesign({
  kind,
  variant,
}: {
  kind: ContentKind;
  variant: ProposalVariant;
}) {
  switch (kind) {
    case "assistant":
      return <AnswerDesign variant={variant} />;
    case "user":
      return <RequestDesign variant={variant} />;
    case "thinking":
      return <ReasoningDesign variant={variant} />;
    case "images":
      return <ImagesDesign variant={variant} />;
    case "annotations":
      return <AnnotationsDesign variant={variant} />;
    case "footer":
      return <FooterDesign variant={variant} />;
    case "work":
      return <WorkDesign variant={variant} explore={false} />;
    case "explore":
      return <WorkDesign variant={variant} explore />;
    case "record":
      return <RecordDesign variant={variant} />;
  }
}
