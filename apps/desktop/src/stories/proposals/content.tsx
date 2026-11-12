// biome-ignore-all lint/suspicious/noArrayIndexKey: Fixture steps and paragraphs keep their order and may repeat.
import type { ToolCall } from "@earendil-works/pi-ai";
import {
  Brain,
  Check,
  ChevronRight,
  Copy,
  FilePen,
  FilePlus,
  GitBranch,
  MessageSquare,
  RotateCcw,
  Search,
  SquareTerminal,
} from "lucide-react";
import { useState } from "react";
import { AnnotationCard } from "../../mainview/AnnotationCards";
import { CustomRecord } from "../../mainview/CustomRecord";
import { ImageGallery } from "../../mainview/ImageGallery";
import { Markdown, UserMessage } from "../../mainview/MessageContent";
import { ResponseFooter } from "../../mainview/ResponseFooter";
import { ThinkingBlock, ToolGroup, WorkToggle } from "../../mainview/ToolBlock";
import {
  annotations,
  answer,
  exploreSteps,
  images,
  reasoning,
  record,
  request,
  shortRequest,
  stats,
  workSteps,
} from "./data";
import type { Proposal } from "./kit";
import { exploreProposals } from "./tools";

type Content = Record<string, Proposal<object>>;
/** Splits markdown at "### " headings; the text before the first heading is the lead. */
function sections(text: string) {
  const [lead, ...rest] = text.split(/^### /m);
  return {
    lead: lead.trim(),
    parts: rest.map((part) => {
      const [title, ...body] = part.split("\n");
      return { title: title.trim(), body: body.join("\n").trim() };
    }),
  };
}
const Prose = ({ text }: { text: string }) => (
  <div className="prose">
    <Markdown text={text} />
  </div>
);

/* ---------------- assistant answer ---------------- */

function AnswerLead() {
  const { lead, parts } = sections(answer);
  const [open, setOpen] = useState<string[]>([]);
  return (
    <div className="pp-answer-lead">
      <Prose text={lead} />
      {parts.map((part) => (
        <details
          key={part.title}
          open={open.includes(part.title)}
          onToggle={(event) => {
            const next = event.currentTarget.open;
            setOpen((list) =>
              next
                ? [...list, part.title]
                : list.filter((t) => t !== part.title),
            );
          }}
        >
          <summary>
            <ChevronRight size={12} />
            {part.title}
          </summary>
          <Prose text={part.body} />
        </details>
      ))}
    </div>
  );
}

function AnswerOutline() {
  const { lead, parts } = sections(answer);
  const [active, setActive] = useState(0);
  return (
    <div className="pp-answer-outline">
      <Prose text={lead} />
      <div>
        <nav aria-label="回答の見出し">
          {parts.map((part, i) => (
            <button
              key={part.title}
              type="button"
              aria-pressed={active === i}
              onClick={() => setActive(i)}
            >
              {part.title}
            </button>
          ))}
        </nav>
        <Prose text={parts[active].body} />
      </div>
    </div>
  );
}

const ASK = /残って|確認|決めて|質問/;
function AnswerAsk() {
  const { lead, parts } = sections(answer);
  const ask = parts.filter((part) => ASK.test(part.title + part.body));
  const rest = parts.filter((part) => !ask.includes(part));
  return (
    <div className="pp-answer-ask">
      <Prose text={lead} />
      {ask.map((part) => (
        <aside key={part.title} className="pp-callout">
          <MessageSquare size={14} />
          <div>
            <strong>あなたの判断が必要です</strong>
            <Prose text={part.body} />
          </div>
        </aside>
      ))}
      <Prose
        text={rest
          .map((part) => `### ${part.title}\n\n${part.body}`)
          .join("\n\n")}
      />
    </div>
  );
}

export const assistantProposals = {
  Lead: {
    title: "結論と折りたたみ",
    fit: "長い回答。最初の段落（結論）だけを常に見せ、見出しごとの詳細は必要な所だけ開く。",
    View: AnswerLead,
  },
  Outline: {
    title: "見出しで切り替え",
    fit: "変更点・使い方・検証のように並列な節がある回答。縦に長くせず、節を選んで読む。",
    View: AnswerOutline,
  },
  Ask: {
    title: "質問を目立たせる",
    fit: "回答の最後に確認事項が埋もれがちな場面。ユーザーの返事が必要な部分を抜き出して先に示す。",
    View: AnswerAsk,
  },
} satisfies Content;
export const AnswerDefault = () => <Prose text={answer} />;

/* ---------------- user request ---------------- */

function RequestChecklist() {
  // Casual requests chain asks with 「して、」 as often as with 「。」.
  const items = request.split(/(?<=[。？！]|して、)/).filter((s) => s.trim());
  return (
    <div className="pp-request-checklist">
      <p>{items[0]}</p>
      <ol>
        {items.slice(1).map((item, i) => (
          <li key={i}>{item.replace(/、$/, "")}</li>
        ))}
      </ol>
    </div>
  );
}

function RequestClamp() {
  const [open, setOpen] = useState(false);
  return (
    <div className="pp-request-clamp">
      <div className="pp-bubble">{shortRequest}</div>
      <div className="pp-bubble">
        <p className={open ? undefined : "pp-clamp"}>{request}</p>
        <button
          type="button"
          className="pp-link"
          onClick={() => setOpen(!open)}
        >
          {open ? "折りたたむ" : "全文"}
        </button>
      </div>
    </div>
  );
}

function RequestHeading() {
  return (
    <div className="pp-request-heading">
      <small>
        <time dateTime={new Date(stats.timestamp).toISOString()}>12:23</time> ·
        あなた
      </small>
      <h3>{request.split("。")[0]}。</h3>
      <p>{request.split("。").slice(1).join("。")}</p>
    </div>
  );
}

export const userProposals = {
  Checklist: {
    title: "要件の箇条書き",
    fit: "要件をいくつも含む依頼。文ごとに分け、回答がどれに応えたか後から照らし合わせられる。",
    View: RequestChecklist,
  },
  Clamp: {
    title: "長さで変わる吹き出し",
    fit: "短い質問と長い依頼が混在する会話。短文は吹き出しのまま、長文は 3 行で畳む。",
    View: RequestClamp,
  },
  Heading: {
    title: "ターンの見出し",
    fit: "1 回の依頼で長い作業が続く使い方。依頼の一文目を章見出しにし、会話を文書として読めるようにする。",
    View: RequestHeading,
  },
} satisfies Content;
export const UserDefault = () => (
  <UserMessage
    message={{ role: "user", timestamp: stats.timestamp, content: request }}
    sessionId="preview"
    disabled={false}
    entryId="example"
  />
);

/* ---------------- thinking ---------------- */

/** Models title each reasoning step with a bold line; the paragraph after it is the step. */
function thoughtSteps(text: string) {
  return text
    .split(/^\*\*(.+)\*\*$/m)
    .slice(1)
    .flatMap((part, i, list) =>
      i % 2 === 0 ? [{ title: part, body: (list[i + 1] ?? "").trim() }] : [],
    );
}

function ThinkingSteps() {
  const steps = thoughtSteps(reasoning);
  const [open, setOpen] = useState<number>();
  return (
    <ol className="pp-thinking-steps">
      {steps.map((step, i) => (
        <li key={i}>
          <button
            type="button"
            aria-expanded={open === i}
            onClick={() => setOpen(open === i ? undefined : i)}
          >
            <span>{i + 1}</span>
            {step.title}
          </button>
          {open === i && <p>{step.body}</p>}
        </li>
      ))}
    </ol>
  );
}

function ThinkingTicker() {
  const steps = thoughtSteps(reasoning);
  const [live, setLive] = useState(true);
  const [open, setOpen] = useState(false);
  return (
    <div className="pp-ticker">
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)}>
        <Brain size={13} className={live ? "pp-pulse" : undefined} />
        <span>
          {live ? steps.at(-1)?.title : `${steps.length} 段階で考えた`}
        </span>
        <ChevronRight size={12} className={open ? "pp-open" : undefined} />
      </button>
      <label className="pp-faint">
        <input type="checkbox" checked={live} onChange={() => setLive(!live)} />{" "}
        思考中
      </label>
      {open && <Prose text={reasoning} />}
    </div>
  );
}

function ThinkingAside() {
  return (
    <aside className="pp-thinking-aside">
      <Prose text={reasoning} />
    </aside>
  );
}

export const thinkingProposals = {
  Steps: {
    title: "段階の見出し",
    fit: "思考が段階に分かれている場合。見出しだけ並べると考えの道筋が一目で分かり、本文は選んだ段階だけ読む。",
    View: ThinkingSteps,
  },
  Ticker: {
    title: "いま考えていること",
    fit: "ストリーミング中。最新の段階の見出しを 1 行で流し、終わったら段階数だけ残す（チェックで切替）。",
    View: ThinkingTicker,
  },
  Aside: {
    title: "余白の注記",
    fit: "思考を常に読みたい人向け。畳まずに、本文と区別できる薄い傍注として置く。",
    View: ThinkingAside,
  },
} satisfies Content;
export const ThinkingDefault = () => (
  <ThinkingBlock active={false} label="Thinking" text={reasoning} />
);

/* ---------------- images ---------------- */

function Mosaic({ sources }: { sources: string[] }) {
  return (
    <div className={`pp-mosaic pp-mosaic-${Math.min(sources.length, 3)}`}>
      {sources.slice(0, 4).map((src, i) => (
        <figure key={i}>
          <img src={src} alt={`画像 ${i + 1}`} />
          {i === 3 && sources.length > 4 && <span>+{sources.length - 4}</span>}
        </figure>
      ))}
    </div>
  );
}
function ImagesMosaic() {
  return (
    <div className="pp-stack-y">
      {(["one", "two", "many"] as const).map((key) => (
        <div key={key}>
          <small>{images[key].length} 枚</small>
          <Mosaic sources={images[key]} />
        </div>
      ))}
    </div>
  );
}

function ImagesDeck() {
  const [open, setOpen] = useState(false);
  return (
    <button
      type="button"
      className={`pp-deck${open ? " pp-deck-open" : ""}`}
      aria-expanded={open}
      onClick={() => setOpen(!open)}
    >
      {images.many.map((src, i) => (
        <img
          key={i}
          src={src}
          alt={`画像 ${i + 1}`}
          style={{ ["--i" as string]: i }}
        />
      ))}
      {!open && <span>{images.many.length} 枚</span>}
    </button>
  );
}

function ImagesFiles() {
  return (
    <ul className="pp-image-files">
      {images.many.map((src, i) => (
        <li key={i}>
          <img src={src} alt="" />
          <span>
            {i % 2 ? "icon.svg" : "icon.png"}
            <small>{i % 2 ? "SVG" : "PNG · 512×512"}</small>
          </span>
        </li>
      ))}
    </ul>
  );
}

export const imagesProposals = {
  Mosaic: {
    title: "枚数で変わる配置",
    fit: "スクリーンショットなど中身を見たい画像。1 枚は大きく、2 枚は並べ、多い時は 4 枠目に残り枚数を出す。",
    View: ImagesMosaic,
  },
  Deck: {
    title: "重ねた束",
    fit: "参考資料として何枚も添付された画像。普段は場所を取らず、押すと広げて並べる。",
    View: ImagesDeck,
  },
  Files: {
    title: "添付ファイル",
    fit: "画像がデータとして扱われる場面（アイコン素材など）。ファイル名と形式が見た目と同じくらい大事。",
    View: ImagesFiles,
  },
} satisfies Content;
export const ImagesDefault = () => (
  <ImageGallery sources={images.many} alt="添付画像" />
);

/* ---------------- sent annotations ---------------- */

function AnnotationThreads() {
  return (
    <div className="pp-threads">
      {annotations.map((item, i) => (
        <article key={i}>
          <blockquote>{item.quote}</blockquote>
          {item.comment ? (
            <p>
              <MessageSquare size={12} />
              {item.comment}
            </p>
          ) : (
            <small className="pp-faint">コメントなしで引用</small>
          )}
        </article>
      ))}
      <p className="pp-thread-body">ありがとう、この 2 点だけ直して。</p>
    </div>
  );
}

function AnnotationBadge() {
  const [open, setOpen] = useState(false);
  return (
    <div className="pp-annotation-badge">
      <p>ありがとう、この 2 点だけ直して。</p>
      <button
        type="button"
        className="pp-chip"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <MessageSquare size={12} />
        {annotations.length} 件の注釈
      </button>
      {open && (
        <ol>
          {annotations.map((item, i) => (
            <li key={i}>
              <q>{item.quote}</q>
              {item.comment && <span>{item.comment}</span>}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function AnnotationFootnotes() {
  return (
    <div className="pp-footnotes">
      <p>
        ありがとう、この 2 点だけ直して。
        {annotations.map((_, i) => (
          <sup key={i}>{i + 1}</sup>
        ))}
      </p>
      <ol>
        {annotations.map((item, i) => (
          <li key={i}>
            <span className="pp-faint">「{item.quote.slice(0, 28)}…」</span>
            {item.comment || "（引用のみ）"}
          </li>
        ))}
      </ol>
    </div>
  );
}

export const annotationProposals = {
  Threads: {
    title: "引用ごとのスレッド",
    fit: "注釈そのものが依頼の本体になっている場面。コードレビューのように引用とコメントを組で読む。",
    View: AnnotationThreads,
  },
  Badge: {
    title: "件数バッジ",
    fit: "本文が主で注釈は補足の場面。送信後は件数だけ示し、会話の見た目を軽く保つ。",
    View: AnnotationBadge,
  },
  Footnotes: {
    title: "脚注",
    fit: "注釈が多く引用が長い場合。引用は短く切り、コメントを脚注として本文の下に並べる。",
    View: AnnotationFootnotes,
  },
} satisfies Content;
export const AnnotationsDefault = () => (
  <ul className="user-annotations">
    {annotations.map(({ quote, comment }) => (
      <AnnotationCard key={quote} quote={quote} comment={comment} />
    ))}
  </ul>
);

/* ---------------- response footer ---------------- */

const seconds = `${Math.round(stats.durationMs / 1000)}s`;
const clock = new Date(stats.endedAt).toLocaleTimeString("ja-JP", {
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Asia/Tokyo",
});
function FooterLine() {
  return (
    <p
      className="pp-footer-line"
      title={`${stats.totalTokens} tokens · ${stats.tokensPerSecond} tok/s`}
    >
      <Check size={12} />
      {seconds} · ツール {stats.tools} 回 · {stats.model}
    </p>
  );
}
function FooterHover() {
  return (
    <div className="pp-footer-hover">
      <span className="pp-faint">カーソルを合わせると操作が出ます</span>
      <div>
        <button type="button" aria-label="コピー">
          <Copy size={13} />
        </button>
        <button type="button" aria-label="分岐">
          <GitBranch size={13} />
        </button>
        <button type="button" aria-label="再生成">
          <RotateCcw size={13} />
        </button>
        <small>
          {seconds} · {stats.tokensPerSecond} tok/s
        </small>
      </div>
    </div>
  );
}
function FooterTime() {
  return (
    <p className="pp-footer-time">
      <time dateTime={new Date(stats.endedAt).toISOString()}>{clock}</time>
      <span>
        {seconds}かかりました · {(stats.totalTokens / 1000).toFixed(1)}k tokens
      </span>
    </p>
  );
}
export const footerProposals = {
  Line: {
    title: "1 行の脚注",
    fit: "毎回の応答に出るので目立たせない。数値は一行に並べ、トークン数はホバーで出す。",
    View: FooterLine,
  },
  Hover: {
    title: "ホバーで操作",
    fit: "操作（コピー・分岐・再生成）が主目的の場面。普段は消しておき、応答に触れた時だけ出す。",
    View: FooterHover,
  },
  Time: {
    title: "時刻",
    fit: "あとから会話を見返す使い方。いつ終わったかが一番の手がかりで、所要時間は添える程度。",
    View: FooterTime,
  },
} satisfies Content;
export const FooterDefault = () => (
  <ResponseFooter sessionId="preview" canRegenerate={false} stats={stats} />
);

/* ---------------- folded work ---------------- */

const workIcon = {
  thinking: Brain,
  explore: Search,
  edit: FilePen,
  write: FilePlus,
  shell: SquareTerminal,
};
type Step = (typeof workSteps)[number];
const failed = (step: Step) => "detail" in step && step.detail === "exit 1";

function WorkStrip() {
  const [open, setOpen] = useState(false);
  return (
    <div className="pp-work-strip">
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)}>
        {workSteps.map((step, i) => {
          const Icon = workIcon[step.kind];
          return (
            <Icon
              key={i}
              size={13}
              className={failed(step) ? "pp-error-text" : undefined}
            />
          );
        })}
        <span>
          {workSteps.length} ステップ · {seconds}
        </span>
      </button>
      {open && (
        <ol>
          {workSteps.map((step, i) => (
            <li key={i}>
              {step.label}
              {"detail" in step && <small>{step.detail}</small>}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function WorkChapters() {
  const chapters: { title: string; steps: Step[] }[] = [];
  for (const step of workSteps)
    if (step.kind === "thinking")
      chapters.push({ title: step.label, steps: [] });
    else chapters.at(-1)?.steps.push(step);
  return (
    <ol className="pp-work-chapters">
      {chapters.map((chapter, i) => (
        <li key={i}>
          <strong>{chapter.title}</strong>
          <ul>
            {chapter.steps.map((step, j) => {
              const Icon = workIcon[step.kind];
              return (
                <li
                  key={j}
                  className={failed(step) ? "pp-error-text" : undefined}
                >
                  <Icon size={12} />
                  <code>{step.label}</code>
                  {"detail" in step && <small>{step.detail}</small>}
                </li>
              );
            })}
          </ul>
        </li>
      ))}
    </ol>
  );
}

function WorkOutcome() {
  const changed = workSteps.filter(
    (step) => step.kind === "edit" || step.kind === "write",
  );
  const shells = workSteps.filter((step) => step.kind === "shell");
  return (
    <div className="pp-work-outcome">
      <ul>
        {changed.map((step, i) => {
          const Icon = workIcon[step.kind];
          return (
            <li key={i}>
              <Icon size={13} />
              <code>{step.label}</code>
              {"detail" in step && <small>{step.detail}</small>}
            </li>
          );
        })}
      </ul>
      <p className="pp-faint">
        テスト {shells.length} 回（{shells.filter(failed).length}{" "}
        回失敗して修正）· 他 {workSteps.length - changed.length - shells.length}{" "}
        ステップ
      </p>
    </div>
  );
}

export const workProposals = {
  Strip: {
    title: "アイコンの列",
    fit: "作業の中身より量と流れを見たい場面。各ステップを 1 つのアイコンにし、失敗だけ色を変える。",
    View: WorkStrip,
  },
  Chapters: {
    title: "考えごとに章立て",
    fit: "なぜその操作をしたかを追いたい場面。思考の見出しを章にし、その下に操作をぶら下げる。",
    View: WorkChapters,
  },
  Outcome: {
    title: "結果として変わったもの",
    fit: "途中経過に興味がなく、何が変わったかだけ知りたい場面。変更ファイルを主役にし、残りは件数にまとめる。",
    View: WorkOutcome,
  },
} satisfies Content;
export function WorkDefault() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <WorkToggle
        open={open}
        tools={stats.tools}
        onToggle={() => setOpen(!open)}
      />
      {open && <ThinkingDefault />}
    </>
  );
}

/* ---------------- explore group ---------------- */

const withSteps = ({
  title,
  fit,
  View,
}: (typeof exploreProposals)[keyof typeof exploreProposals]) => ({
  title,
  fit,
  View: () => <View steps={exploreSteps} />,
});
export const exploreContent = {
  Trail: withSteps(exploreProposals.Trail),
  Files: withSteps(exploreProposals.Files),
  Sentence: withSteps(exploreProposals.Sentence),
} satisfies Content;
export const ExploreDefault = () => (
  <ToolGroup
    calls={exploreSteps.map(
      (step) => ({ type: "toolCall", ...step.call }) as ToolCall,
    )}
    tools={Object.fromEntries(
      exploreSteps.flatMap((step) =>
        step.state ? [[step.call.id, step.state]] : [],
      ),
    )}
    live={false}
  />
);

/* ---------------- custom record ---------------- */

function Field({ value }: { value: unknown }) {
  if (Array.isArray(value))
    return (
      <span className="pp-chips">
        {value.map((item, i) => (
          <code key={i} className="pp-chip">
            {String(item)}
          </code>
        ))}
      </span>
    );
  if (value && typeof value === "object")
    return (
      <dl className="pp-nested">
        {Object.entries(value).map(([key, item]) => (
          <div key={key}>
            <dt>{key}</dt>
            <dd>{String(item)}</dd>
          </div>
        ))}
      </dl>
    );
  return <>{String(value)}</>;
}
function RecordFields() {
  return (
    <div className="pp-record-fields">
      <header>
        <code>{record.customType}</code>
      </header>
      <dl>
        {Object.entries(record.data).map(([key, value]) => (
          <div key={key}>
            <dt>{key}</dt>
            <dd>
              {key === "status" ? (
                <span className="pp-tag pp-tag-add">{String(value)}</span>
              ) : (
                <Field value={value} />
              )}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
function RecordEvent() {
  return (
    <p className="pp-record-event">
      <span className="pp-rule" />
      <Check size={12} className="pp-ok-text" />
      {record.data.reviewer} が {record.data.files.length} ファイルを{" "}
      {record.data.status}
      <small>— {record.data.note}</small>
      <span className="pp-rule" />
    </p>
  );
}
function JsonNode({
  name,
  value,
  depth,
}: {
  name?: string;
  value: unknown;
  depth: number;
}) {
  const [open, setOpen] = useState(depth < 1);
  const nested = value !== null && typeof value === "object";
  const label = name !== undefined && (
    <span className="pp-json-key">{name}: </span>
  );
  if (!nested)
    return (
      <li>
        {label}
        <span className={`pp-json-${typeof value}`}>
          {JSON.stringify(value)}
        </span>
      </li>
    );
  const entries = Object.entries(value);
  return (
    <li>
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)}>
        <ChevronRight size={11} className={open ? "pp-open" : undefined} />
        {label}
        <span className="pp-faint">
          {Array.isArray(value) ? `[${entries.length}]` : `{${entries.length}}`}
        </span>
      </button>
      {open && (
        <ul>
          {entries.map(([key, item]) => (
            <JsonNode
              key={key}
              name={Array.isArray(value) ? undefined : key}
              value={item}
              depth={depth + 1}
            />
          ))}
        </ul>
      )}
    </li>
  );
}
function RecordTree() {
  return (
    <ul className="pp-json-tree">
      <JsonNode name={record.customType} value={record.data} depth={0} />
    </ul>
  );
}
export const recordProposals = {
  Fields: {
    title: "型に合わせた項目",
    fit: "拡張が任意の形のデータを残す場面。配列はチップ、入れ子は小さな表、状態はバッジと値に合わせて描く。",
    View: RecordFields,
  },
  Event: {
    title: "会話中の出来事",
    fit: "チェックポイントや承認のような記録。データの表ではなく、会話の区切りとなる一文として残す。",
    View: RecordEvent,
  },
  Tree: {
    title: "折りたためるツリー",
    fit: "拡張を開発中で中身を確かめたい場面。生のデータを一段ずつ開いて見る。",
    View: RecordTree,
  },
} satisfies Content;
export const RecordDefault = () => (
  <CustomRecord
    record={{
      id: "example",
      branchId: "main",
      parentId: null,
      order: 0,
      kind: "custom-entry",
      customType: record.customType,
      data: record.data,
    }}
  />
);
