// biome-ignore-all lint/suspicious/noArrayIndexKey: Parsed answers and sources keep their order.
import {
  Clock,
  ExternalLink,
  FolderOpen,
  Globe,
  ImageIcon,
  Link2,
  Search,
  Sparkles,
} from "lucide-react";
import { type ReactNode, useState } from "react";
import type { Proposal, Tool, ToolProps } from "./kit";
import { Badge, CardHead, Phased, Row, Spin } from "./lens-kit";
import { args, details, list, num, str } from "./lens-model";
import "./codex.css";

/* ---------------- codex_search ---------------- */

type Citation = { title?: string; url: string; endIndex?: number };
type Answer = { query: string; text: string; citations: Citation[] };
const domain = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
};
function searchOf(tool: Tool) {
  const d = details(tool);
  const answers = (Array.isArray(d.successes) ? d.successes : []) as Answer[];
  const sources = answers.flatMap((answer) => answer.citations);
  return {
    queries: list(args(tool).queries),
    freshness: str(d.freshness) || str(args(tool).freshness) || "live",
    seconds: (num(d.elapsedMs) ?? 0) / 1000,
    answers,
    sources,
    domains: [...new Set(sources.map((source) => domain(source.url)))],
  };
}
const freshnessLabel: Record<string, string> = {
  live: "最新",
  cached: "キャッシュ",
  indexed: "索引",
};
/** A two-letter monogram stands in for a favicon; nothing is fetched. */
const Monogram = ({ url }: { url: string }) => (
  <span className="cx-mono" aria-hidden="true">
    {domain(url).slice(0, 1).toUpperCase()}
  </span>
);
/** Inline `code` only; answers are short prose. */
function Prose({ text }: { text: string }) {
  return text
    .split(/(`[^`]+`)/)
    .map((part, i) =>
      part.startsWith("`") ? <code key={i}>{part.slice(1, -1)}</code> : part,
    );
}
/** Places numbered citation marks where each source's span ends. */
function Cited({ answer, offset = 0 }: { answer: Answer; offset?: number }) {
  const marks = answer.citations
    .map((citation, index) => ({
      at: citation.endIndex ?? -1,
      n: offset + index + 1,
    }))
    .filter((mark) => mark.at >= 0)
    .sort((a, b) => a.at - b.at);
  const parts: ReactNode[] = [];
  let last = 0;
  for (const mark of marks) {
    parts.push(
      <Prose key={`t${mark.n}`} text={answer.text.slice(last, mark.at)} />,
    );
    parts.push(
      <sup key={`c${mark.n}`} className="cx-cite">
        {mark.n}
      </sup>,
    );
    last = mark.at;
  }
  parts.push(<Prose key="end" text={answer.text.slice(last)} />);
  return parts;
}

function SearchAnswer(props: ToolProps) {
  const s = searchOf(props.tool);
  let offset = 0;
  return (
    <Row
      {...props}
      icon={<Globe size={14} />}
      verb="Web検索"
      target={s.queries.join(" · ")}
      meta={`${s.sources.length} ソース`}
    >
      {props.phase === "done" && (
        <div className="cx-answers">
          {s.answers.map((answer, i) => {
            const start = offset;
            offset += answer.citations.length;
            return (
              <section key={i}>
                {s.answers.length > 1 && <h4>{answer.query}</h4>}
                <p>
                  <Cited answer={answer} offset={start} />
                </p>
                <div className="lx-chips">
                  {answer.citations.map((citation, j) => (
                    <a
                      key={j}
                      className="lx-chip cx-source-chip"
                      href={citation.url}
                      title={citation.title}
                    >
                      <span className="cx-chip-n">{start + j + 1}</span>
                      {domain(citation.url)}
                    </a>
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </Row>
  );
}

function SearchSources(props: ToolProps) {
  const s = searchOf(props.tool);
  const [open, setOpen] = useState(false);
  return (
    <Row
      {...props}
      icon={<Globe size={14} />}
      verb="Web検索"
      target={s.queries.join(" · ")}
      meta={`${s.domains.length} サイト`}
    >
      <ul className="cx-source-cards">
        {s.sources.map((source, i) => (
          <li key={i}>
            <a href={source.url} title={source.url}>
              <Monogram url={source.url} />
              <span>
                <strong>{source.title || source.url}</strong>
                <small>{domain(source.url)}</small>
              </span>
              <ExternalLink size={12} />
            </a>
          </li>
        ))}
      </ul>
      <button type="button" className="lx-link" onClick={() => setOpen(!open)}>
        {open ? "要約を閉じる" : "要約を読む"}
      </button>
      {open &&
        s.answers.map((answer, i) => (
          <p key={i} className="cx-summary">
            <Prose text={answer.text} />
          </p>
        ))}
    </Row>
  );
}

function SearchTabs(props: ToolProps) {
  const s = searchOf(props.tool);
  const [pick, setPick] = useState(0);
  const answer = s.answers[pick];
  return (
    <section className="lx-card" data-ui-surface="card">
      <CardHead
        icon={<Search size={14} />}
        title="Web検索"
        sub={`${freshnessLabel[s.freshness] ?? s.freshness} · ${s.queries.length} クエリ`}
        phase={props.phase}
        aside={<Badge>{s.seconds.toFixed(1)}s</Badge>}
      />
      <div className="cx-tabs">
        {s.queries.map((query, i) => (
          <button
            key={query}
            type="button"
            aria-pressed={pick === i}
            onClick={() => setPick(i)}
          >
            {query}
          </button>
        ))}
      </div>
      <Phased {...props}>
        {answer && (
          <>
            <p className="cx-summary">
              <Cited answer={answer} />
            </p>
            <ol className="cx-footnotes">
              {answer.citations.map((citation, i) => (
                <li key={i}>
                  <a href={citation.url}>{citation.title || citation.url}</a>
                  <small>{domain(citation.url)}</small>
                </li>
              ))}
            </ol>
          </>
        )}
      </Phased>
    </section>
  );
}

function SearchCompact(props: ToolProps) {
  const s = searchOf(props.tool);
  return (
    <Row
      {...props}
      open={false}
      icon={<Globe size={14} />}
      verb="Web検索"
      target={s.queries.join(" · ")}
      meta={
        <span className="cx-domains">
          {s.domains.slice(0, 4).map((name) => (
            <span key={name} className="cx-mono" title={name}>
              {name.slice(0, 1).toUpperCase()}
            </span>
          ))}
          {s.domains.length > 4 && <small>+{s.domains.length - 4}</small>}
        </span>
      }
    >
      <ul className="cx-gist">
        {s.answers.map((answer, i) => (
          <li key={i}>
            <strong>{answer.query}</strong>
            <span>
              <Prose text={answer.text.split(/(?<=\.)\s/)[0]} />
            </span>
          </li>
        ))}
      </ul>
    </Row>
  );
}

function SearchSteps(props: ToolProps) {
  const s = searchOf(props.tool);
  return (
    <div className="lx-plain">
      <p className="cx-steps-head">
        <Globe size={13} />
        Web検索
        <Badge tone="info">
          <Clock size={10} />
          {freshnessLabel[s.freshness] ?? s.freshness}
        </Badge>
        <span className="lx-row-meta">
          {props.phase === "done" && `${s.seconds.toFixed(1)}s`}
        </span>
      </p>
      <ol className="cx-steps">
        {s.queries.map((query, i) => {
          const answer = s.answers.find((item) => item.query === query);
          return (
            <li key={query}>
              <span className="cx-step-dot">
                {props.phase === "running" ? <Spin size={10} /> : i + 1}
              </span>
              <div>
                <strong>{query}</strong>
                {answer ? (
                  <small>
                    <Link2 size={11} />
                    {answer.citations.length} ソース ·{" "}
                    {[
                      ...new Set(answer.citations.map((c) => domain(c.url))),
                    ].join(", ")}
                  </small>
                ) : (
                  <small>
                    {props.phase === "running" ? "検索中…" : "結果なし"}
                  </small>
                )}
              </div>
            </li>
          );
        })}
      </ol>
      {props.phase === "error" && <Phased {...props} />}
    </div>
  );
}

export const codexSearchProposals = {
  Answer: {
    title: "回答と出典番号",
    fit: "要約文の中に出典番号を打ち、下に番号付きのサイトチップを並べる。どの文がどのサイト由来かが追える。",
    View: SearchAnswer,
  },
  Sources: {
    title: "出典カード優先",
    fit: "読んだサイトをタイトル付きのカードで先に見せ、要約は開いて読む。情報の確かさを重視する場面に。",
    View: SearchSources,
  },
  Tabs: {
    title: "クエリのタブ",
    fit: "複数クエリをまとめて投げたとき、クエリごとに回答と脚注を切り替える。",
    View: SearchTabs,
  },
  Compact: {
    title: "閉じた1行",
    fit: "サイトの頭文字を行の右に並べ、既定は閉じる。開くとクエリごとの要点1文だけ。",
    View: SearchCompact,
  },
  Steps: {
    title: "検索の手順",
    fit: "クエリを番号付きの手順として並べ、それぞれの出典数とドメインを添える。実行中は各手順が回る。",
    View: SearchSteps,
  },
} satisfies Record<string, Proposal<ToolProps>>;

/* ---------------- imagegen ---------------- */

function imageOf(tool: Tool) {
  const content = (tool.state?.result as { content?: unknown } | undefined)
    ?.content;
  const image = (Array.isArray(content) ? content : []).find(
    (block): block is { type: "image"; data: string; mimeType: string } =>
      block?.type === "image" && typeof block.data === "string",
  );
  const d = details(tool);
  const size = str(d.size) || str(args(tool).size);
  const [w, h] = size.split("x").map(Number);
  return {
    prompt: str(args(tool).prompt),
    src: image && `data:${image.mimeType};base64,${image.data}`,
    path: str(d.path),
    size,
    // Unknown until the result arrives; the prompt asks for 3:2 in the fixture.
    ratio: w && h ? `${w} / ${h}` : "3 / 2",
    quality: str(d.quality),
    format: str(d.output_format),
    background: str(d.background),
    references: list(args(tool).referenced_image_paths),
  };
}
type Image = ReturnType<typeof imageOf>;
/** While running, a calm shimmer at the expected aspect ratio keeps the layout stable. */
function Canvas({
  image,
  phase,
  className = "",
}: {
  image: Image;
  phase: ToolProps["phase"];
  className?: string;
}) {
  return (
    <div
      className={`cx-canvas ${className}`}
      style={{ aspectRatio: image.ratio }}
    >
      {phase === "done" && image.src ? (
        <img src={image.src} alt={image.prompt} />
      ) : phase === "running" ? (
        <span className="cx-shimmer" role="status" aria-label="生成中" />
      ) : (
        <span className="cx-empty">
          <ImageIcon size={20} />
        </span>
      )}
    </div>
  );
}
const specs = (image: Image) =>
  [
    image.size,
    image.quality,
    image.format?.toUpperCase(),
    image.background === "transparent" && "透過",
  ].filter(Boolean) as string[];

function ImageFrame(props: ToolProps) {
  const image = imageOf(props.tool);
  return (
    <Row
      {...props}
      icon={<ImageIcon size={14} />}
      verb="画像生成"
      target={image.prompt}
      meta={image.size}
    >
      <figure className="cx-frame">
        <Canvas image={image} phase="done" />
        <figcaption>
          {image.prompt}
          <span className="lx-chips">
            {specs(image).map((spec) => (
              <Badge key={spec}>{spec}</Badge>
            ))}
          </span>
        </figcaption>
      </figure>
    </Row>
  );
}

function ImageDialogue(props: ToolProps) {
  const image = imageOf(props.tool);
  return (
    <div className="cx-dialogue">
      <p className="cx-prompt-bubble">
        <Sparkles size={12} />
        {image.prompt}
      </p>
      <div className="cx-dialogue-result">
        <Canvas image={image} phase={props.phase} />
        {props.phase === "error" && <Phased {...props} />}
      </div>
    </div>
  );
}

function ImageThumb(props: ToolProps) {
  const image = imageOf(props.tool);
  return (
    <Row
      {...props}
      icon={<ImageIcon size={14} />}
      verb="画像生成"
      target={image.prompt}
      meta={image.format.toUpperCase()}
    >
      <div className="cx-thumb-row">
        <Canvas image={image} phase="done" className="cx-thumb" />
        <div>
          <code>{image.path}</code>
          <div className="cx-actions">
            <button type="button">
              <FolderOpen size={12} />
              フォルダを開く
            </button>
            <button type="button">
              <ExternalLink size={12} />
              画像を開く
            </button>
          </div>
        </div>
      </div>
    </Row>
  );
}

function ImageSpec(props: ToolProps) {
  const image = imageOf(props.tool);
  const d = details(props.tool);
  const rows: [string, string][] = [
    ["サイズ", image.size || "auto"],
    ["品質", image.quality || "—"],
    ["形式", image.format || "png"],
    ["背景", image.background || "—"],
    ["保存先", image.path],
    ["リクエスト", str(d.imagegen_request_id)],
  ];
  return (
    <section className="lx-card cx-spec" data-ui-surface="card">
      <CardHead
        icon={<ImageIcon size={14} />}
        title="画像生成"
        sub={
          image.references.length
            ? `${image.references.length} 枚を編集`
            : "新規生成"
        }
        phase={props.phase}
        aside={<Badge tone="ok">保存済み</Badge>}
      />
      <div className="cx-spec-body">
        <Canvas image={image} phase={props.phase} />
        <div>
          <p className="cx-spec-prompt">{image.prompt}</p>
          <Phased {...props}>
            <dl className="lx-facts">
              {rows.map(([key, value]) => (
                <div key={key}>
                  <dt>{key}</dt>
                  <dd className="cx-break">{value}</dd>
                </div>
              ))}
            </dl>
          </Phased>
        </div>
      </div>
    </section>
  );
}

function ImageReveal(props: ToolProps) {
  const image = imageOf(props.tool);
  return (
    <div className="lx-plain">
      <p className="cx-steps-head">
        <ImageIcon size={13} />
        {props.phase === "running"
          ? "画像を生成しています"
          : props.phase === "error"
            ? "画像を生成できませんでした"
            : "画像を生成しました"}
        <span className="lx-row-meta">
          {props.phase === "done" && specs(image).join(" · ")}
        </span>
      </p>
      <div className="lx-indent">
        {props.phase === "error" ? (
          <Phased {...props} />
        ) : (
          <Canvas image={image} phase={props.phase} className="cx-reveal" />
        )}
      </div>
    </div>
  );
}

export const imagegenProposals = {
  Frame: {
    title: "額縁とキャプション",
    fit: "画像を主役に、プロンプトをキャプションとして下に。サイズや品質はバッジで添える。",
    View: ImageFrame,
  },
  Dialogue: {
    title: "依頼と作品",
    fit: "プロンプトを吹き出しに、生成中は同じ縦横比のプレースホルダーを置く。完了しても周囲が動かない。",
    View: ImageDialogue,
  },
  Thumb: {
    title: "サムネイルと保存先",
    fit: "小さなサムネイルと保存パス、開く操作だけ。何枚も生成する作業で会話を圧迫しない。",
    View: ImageThumb,
  },
  Spec: {
    title: "仕様カード",
    fit: "画像の横にサイズ・品質・形式・背景・保存先を並べる。生成条件を確認・再現したいとき。",
    View: ImageSpec,
  },
  Reveal: {
    title: "生成中から完成へ",
    fit: "生成中は縦横比を保ったゆっくり光る面、完成すると画像がふわっと現れる。待ち時間を状態として見せる。",
    View: ImageReveal,
  },
} satisfies Record<string, Proposal<ToolProps>>;
