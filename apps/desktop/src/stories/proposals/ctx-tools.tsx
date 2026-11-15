// biome-ignore-all lint/suspicious/noArrayIndexKey: Output lines keep their order and may repeat.
import {
  ArrowRight,
  BookOpen,
  Check,
  ChevronRight,
  Code2,
  Database,
  FileText,
  Layers,
  Search,
  Terminal,
  X,
} from "lucide-react";
import { useState } from "react";
import { CodeText, TerminalOutput } from "../../mainview/HighlightedCode";
import { languageFromPath } from "../../mainview/syntax-highlighting";
import type { Proposal, Tool, ToolProps } from "./kit";
import { Badge, CardHead, Phased, Row, Spin } from "./lens-kit";
import { args, body, list, str } from "./lens-model";
import "./ctx.css";

/* ---------------- shared parsing ---------------- */

const extension: Record<string, string> = {
  javascript: "js",
  typescript: "ts",
  python: "py",
  shell: "sh",
  powershell: "ps1",
};
const runtime: Record<string, string> = {
  javascript: "node",
  typescript: "bun",
  python: "python",
  shell: "sh",
  powershell: "pwsh",
};
const kb = (bytes: number) =>
  bytes >= 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${bytes} B`;
const utf8 = (text: string) => new TextEncoder().encode(text).length;

/**
 * ctx_execute: optional "exit N · N B" summary first, optional
 * "ctx_search(...)" / "more: ctx_search(...)" handle last, the answer between.
 */
function executeOf(tool: Tool) {
  const a = args(tool);
  const lines = body(tool).split("\n");
  const summary = /^exit (-?\d+) · (\d+) B$/.exec(lines[0] ?? "");
  if (summary) lines.shift();
  const handle = /^(?:more: )?ctx_search\(\{.*source:"(.*?)"\}\)/.exec(
    lines.at(-1) ?? "",
  );
  if (handle) lines.pop();
  const exit = /^exit (-?\d+)$/.exec(lines[0] ?? "");
  if (exit) lines.shift();
  const output = lines.join("\n");
  const language = str(a.language) || "shell";
  return {
    language,
    code: str(a.code),
    intent: str(a.intent),
    file: str(a.file),
    output,
    exitCode: summary ? Number(summary[1]) : exit ? Number(exit[1]) : 0,
    /** Only known when context-mode indexed a large output. */
    fullBytes: summary ? Number(summary[2]) : undefined,
    returnedBytes: utf8(output),
    source: handle?.[1],
    path: `script.${extension[language] ?? "txt"}`,
  };
}
type Execute = ReturnType<typeof executeOf>;
const outcome = (e: Execute) =>
  [
    e.exitCode === 0 ? "exit 0" : `exit ${e.exitCode}`,
    e.fullBytes !== undefined
      ? `${kb(e.fullBytes)} → ${kb(e.returnedBytes)}`
      : `${e.output.split("\n").length} 行`,
  ].join(" · ");

function Source({ code, path }: { code: string; path: string }) {
  return (
    <pre className="lx-log">
      <CodeText text={code} language={languageFromPath(path)} />
    </pre>
  );
}

/* ---------------- ctx_execute ---------------- */

function ExecNotebook(props: ToolProps) {
  const e = executeOf(props.tool);
  return (
    <section className="ctx-notebook" data-ui-surface="card">
      <div className="ctx-cell">
        <span className="ctx-cell-label">In</span>
        <div>
          <p className="ctx-cell-head">
            <Badge tone="info">{e.language}</Badge>
            {e.intent && <Badge tone="accent">探す: {e.intent}</Badge>}
          </p>
          <Source code={e.code} path={e.path} />
        </div>
      </div>
      <div className="ctx-cell">
        <span className="ctx-cell-label">
          {props.phase === "running" ? <Spin /> : "Out"}
        </span>
        <div>
          <Phased {...props}>
            <pre className="lx-log ctx-out">
              <TerminalOutput text={e.output} />
            </pre>
            <small className="ctx-cell-foot">{outcome(e)}</small>
          </Phased>
        </div>
      </div>
    </section>
  );
}

function ExecAnswer(props: ToolProps) {
  const e = executeOf(props.tool);
  const [open, setOpen] = useState(false);
  return (
    <Row
      {...props}
      icon={<Code2 size={14} />}
      verb="サンドボックス"
      target={e.intent || e.code.split("\n")[0]}
      meta={outcome(e)}
    >
      <pre className="lx-log ctx-answer">
        <TerminalOutput text={e.output} />
      </pre>
      <button
        type="button"
        className="ctx-toggle"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <ChevronRight size={12} className={open ? "lx-open" : undefined} />
        {e.language} のコード（{e.code.split("\n").length} 行）
      </button>
      {open && <Source code={e.code} path={e.path} />}
    </Row>
  );
}

function ExecSaved(props: ToolProps) {
  const e = executeOf(props.tool);
  const ratio = e.fullBytes
    ? Math.max(0.02, e.returnedBytes / e.fullBytes)
    : undefined;
  return (
    <Row
      {...props}
      icon={<Code2 size={14} />}
      verb="サンドボックス"
      target={e.intent || e.code.split("\n")[0]}
      meta={
        e.fullBytes !== undefined
          ? `${Math.round((1 - (ratio ?? 0)) * 100)}% 節約`
          : outcome(e)
      }
    >
      {e.fullBytes !== undefined ? (
        <div className="ctx-saved">
          <div className="ctx-saved-bar" aria-hidden="true">
            <i style={{ width: `${(ratio ?? 0) * 100}%` }} />
          </div>
          <p>
            <span>
              実行結果 <strong>{kb(e.fullBytes)}</strong>
            </span>
            <ArrowRight size={12} className="lx-faint" />
            <span>
              会話に戻した量 <strong>{kb(e.returnedBytes)}</strong>
            </span>
            {e.source && (
              <span className="lx-row-meta">
                <Database size={11} />
                残りは索引済み
              </span>
            )}
          </p>
        </div>
      ) : (
        <p className="ctx-note">
          出力は全量を会話に返しました（{kb(e.returnedBytes)}）。
        </p>
      )}
      <pre className="lx-log">
        <TerminalOutput text={e.output} />
      </pre>
    </Row>
  );
}

function ExecTerminal(props: ToolProps) {
  const e = executeOf(props.tool);
  const first = e.code.split("\n")[0];
  const more = e.code.split("\n").length - 1;
  return (
    <div className={`ctx-term ctx-${props.phase}`} data-ui-surface="card">
      <p className="ctx-term-head">
        <span className="ctx-prompt">
          {runtime[e.language] ?? e.language} ›
        </span>
        <code>{first}</code>
        {more > 0 && <small>+{more} 行</small>}
        <span className="lx-row-meta">
          {props.phase === "running" ? (
            <Spin />
          ) : (
            props.phase === "done" && outcome(e)
          )}
        </span>
      </p>
      {props.phase === "done" ? (
        <pre className="lx-log">
          <TerminalOutput text={e.output} />
        </pre>
      ) : (
        <div className="ctx-term-body">
          <Phased {...props} />
        </div>
      )}
    </div>
  );
}

function ExecScript(props: ToolProps) {
  const e = executeOf(props.tool);
  return (
    <section className="lx-card" data-ui-surface="card">
      <CardHead
        icon={<Terminal size={14} />}
        title={e.intent ? `「${e.intent}」を探す` : "サンドボックスで実行"}
        sub={`${e.language}${e.file ? ` · ${e.file}` : ""}`}
        phase={props.phase}
        aside={
          <Badge tone={e.exitCode === 0 ? "ok" : "error"}>
            exit {e.exitCode}
          </Badge>
        }
      />
      <div className="ctx-split">
        <div>
          <small>コード</small>
          <Source code={e.code} path={e.path} />
        </div>
        <div>
          <small>結果</small>
          <Phased {...props}>
            <pre className="lx-log">
              <TerminalOutput text={e.output} />
            </pre>
          </Phased>
        </div>
      </div>
    </section>
  );
}

export const ctxExecuteProposals = {
  Notebook: {
    title: "ノートブックのセル",
    fit: "In（言語とコード）と Out（結果）を Jupyter のように縦に並べる。何を実行して何が返ったかが対になる。",
    View: ExecNotebook,
  },
  Answer: {
    title: "答えを先に",
    fit: "context-mode は「答えだけ印字する」コードを書かせるので、出力を主役にしてコードは畳む。",
    View: ExecAnswer,
  },
  Saved: {
    title: "節約量を見せる",
    fit: "実行結果の大きさと会話に戻した量を帯で比べる。context-mode が何をしたかが一目でわかる。",
    View: ExecSaved,
  },
  Terminal: {
    title: "ランタイムのプロンプト",
    fit: "node › / python › のように実行環境を示すミニターミナル。シェルのツールと同じ感覚で読める。",
    View: ExecTerminal,
  },
  Script: {
    title: "コードと結果の2列",
    fit: "意図（intent）を見出しに、コードと結果を左右に。長めのスクリプトを検証したいとき。",
    View: ExecScript,
  },
} satisfies Record<string, Proposal<ToolProps>>;

/* ---------------- ctx_batch ---------------- */

type Section = { query: string; command?: string; lines: string[] };
function batchOf(tool: Tool) {
  const a = args(tool);
  const sections: Section[] = [];
  let more: string | undefined;
  for (const line of body(tool).split("\n")) {
    if (line.startsWith("## "))
      sections.push({ query: line.slice(3), lines: [] });
    else if (/^more: ctx_search/.test(line)) more = line;
    else if (
      line.startsWith("$ ") &&
      sections.at(-1) &&
      !sections.at(-1)?.command
    )
      (sections.at(-1) as Section).command = line.slice(2);
    else sections.at(-1)?.lines.push(line);
  }
  return {
    commands: list(a.commands),
    queries: list(a.queries),
    sections,
    more,
  };
}
const answerOf = (b: ReturnType<typeof batchOf>, query: string) =>
  b.sections.find((section) => section.query === query);

function BatchColumns(props: ToolProps) {
  const b = batchOf(props.tool);
  return (
    <Row
      {...props}
      icon={<Layers size={14} />}
      verb="一括実行"
      target={`${b.commands.length} コマンド · ${b.queries.length} 質問`}
    >
      <div className="ctx-columns">
        <div>
          <small>実行したコマンド</small>
          <ul>
            {b.commands.map((command) => (
              <li key={command}>
                <code>$ {command}</code>
              </li>
            ))}
          </ul>
        </div>
        <ArrowRight size={14} className="lx-faint" />
        <div>
          <small>質問</small>
          <ul>
            {b.queries.map((query) => (
              <li key={query}>
                <Search size={11} />
                {query}
                <Badge>{answerOf(b, query)?.lines.length ?? 0} 行</Badge>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </Row>
  );
}

function BatchQA(props: ToolProps) {
  const b = batchOf(props.tool);
  return (
    <Row
      {...props}
      icon={<Layers size={14} />}
      verb="一括実行"
      target={b.queries.join(" · ")}
      meta={`${b.commands.length} コマンド`}
    >
      <div className="ctx-qa">
        {b.sections.map((section) => (
          <section key={section.query}>
            <h4>
              <Search size={12} />
              {section.query}
              {section.command && <code>$ {section.command}</code>}
            </h4>
            <pre className="lx-log">
              <TerminalOutput text={section.lines.join("\n")} />
            </pre>
          </section>
        ))}
      </div>
    </Row>
  );
}

function BatchTranscript(props: ToolProps) {
  const b = batchOf(props.tool);
  return (
    <div className={`ctx-term ctx-${props.phase}`} data-ui-surface="card">
      <p className="ctx-term-head">
        <Layers size={12} />
        <code>{b.commands.length} commands</code>
        <span className="lx-row-meta">
          {props.phase === "running" ? <Spin /> : `${b.queries.length} queries`}
        </span>
      </p>
      {props.phase === "done" ? (
        <pre className="lx-log">
          {b.sections.map((section) => (
            <span key={section.query}>
              <span className="ctx-comment"># {section.query}</span>
              {"\n"}
              {section.command && (
                <span className="ctx-prompt">$ {section.command}</span>
              )}
              {"\n"}
              <TerminalOutput text={section.lines.join("\n")} />
              {"\n"}
            </span>
          ))}
        </pre>
      ) : (
        <div className="ctx-term-body">
          <Phased {...props} />
        </div>
      )}
    </div>
  );
}

function BatchChecklist(props: ToolProps) {
  const b = batchOf(props.tool);
  const [open, setOpen] = useState<string>();
  return (
    <Row
      {...props}
      icon={<Layers size={14} />}
      verb="一括実行"
      target={`${b.commands.length} コマンド`}
      meta={`${b.queries.length} 質問`}
    >
      <ul className="ctx-checks">
        {b.commands.map((command) => (
          <li key={command}>
            <Check size={12} className="lx-ok-text" />
            <code>{command}</code>
          </li>
        ))}
      </ul>
      <div className="lx-chips ctx-query-chips">
        {b.queries.map((query) => (
          <button
            key={query}
            type="button"
            className="lx-chip"
            aria-pressed={open === query}
            onClick={() => setOpen(open === query ? undefined : query)}
          >
            <Search size={11} />
            {query}
          </button>
        ))}
      </div>
      {open && (
        <pre className="lx-log">
          <TerminalOutput
            text={answerOf(b, open)?.lines.join("\n") ?? "No hits."}
          />
        </pre>
      )}
    </Row>
  );
}

function BatchSentence(props: ToolProps) {
  const b = batchOf(props.tool);
  return (
    <div className="lx-plain">
      <p className="lx-sentence">
        <Layers size={13} />
        {props.phase === "done" ? (
          <span>
            {b.commands.length} 個のコマンドを実行し、
            {b.queries.map((query) => (
              <code key={query}>{query}</code>
            ))}
            について答えを抜き出しました
            {b.more && <span className="lx-faint">（残りは索引済み）</span>}
          </span>
        ) : props.phase === "running" ? (
          <span className="lx-faint">
            {b.commands.length} 個のコマンドを実行しています
          </span>
        ) : (
          <span>一括実行に失敗しました</span>
        )}
      </p>
      {props.phase === "error" && <Phased {...props} />}
    </div>
  );
}

export const ctxBatchProposals = {
  Columns: {
    title: "コマンドと質問の2列",
    fit: "左に実行したコマンド、右に答えを探した質問。何を調べたかの全体像だけを示す。",
    View: BatchColumns,
  },
  QA: {
    title: "質問ごとの答え",
    fit: "質問を見出しに、その答えを出したコマンドと抜き出したログを並べる。結果を読む用途の本命。",
    View: BatchQA,
  },
  Transcript: {
    title: "ターミナルの記録",
    fit: "# 質問 → $ コマンド → 出力 の順でひと続きのターミナル風に。シェル出力と同じ読み方。",
    View: BatchTranscript,
  },
  Checklist: {
    title: "実行済みの一覧＋質問チップ",
    fit: "コマンドはチェック済みの一覧、答えは質問チップを押したものだけ開く。",
    View: BatchChecklist,
  },
  Sentence: {
    title: "1文の要約",
    fit: "調査の途中経過として頻繁に出る場合の最小表示。",
    View: BatchSentence,
  },
} satisfies Record<string, Proposal<ToolProps>>;

/* ---------------- ctx_search ---------------- */

type Hit = { source: string; chunk: number; text: string };
function searchOf(tool: Tool) {
  const groups: { query: string; hits: Hit[]; same?: string }[] = [];
  const more: string[] = [];
  for (const line of body(tool).split("\n")) {
    const query = /^Query "(.*)":$/.exec(line);
    if (query) groups.push({ query: query[1], hits: [] });
    else if (line.startsWith("Same as above: ")) {
      const group = groups.at(-1);
      if (group) group.same = line.slice(15);
    } else if (line.startsWith("More: ")) more.push(line.slice(6));
    else {
      const hit = /^(.+?) #(\d+): (.*)$/.exec(line);
      if (hit)
        groups
          .at(-1)
          ?.hits.push({ source: hit[1], chunk: Number(hit[2]), text: hit[3] });
      else {
        const last = groups.at(-1)?.hits.at(-1);
        if (last) last.text += `\n${line}`;
      }
    }
  }
  return { queries: list(args(tool).queries), groups, more };
}
/** Sources are files, earlier tool output ("ctx_execute:…") or short handles ("s82"). */
function SourceIcon({ source }: { source: string }) {
  return source.startsWith("ctx_") ? (
    <Terminal size={12} className="ctx-src-run" />
  ) : /^[st]\d+/.test(source) ? (
    <Database size={12} className="lx-faint" />
  ) : (
    <FileText size={12} className="ctx-src-file" />
  );
}
function Marked({ text, query }: { text: string; query: string }) {
  const words = query.split(/\s+/).filter((word) => word.length > 2);
  if (!words.length) return text;
  const re = new RegExp(
    `(${words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`,
    "gi",
  );
  return text
    .split(re)
    .map((part, i) => (i % 2 ? <mark key={i}>{part}</mark> : part));
}

function SearchCards(props: ToolProps) {
  const s = searchOf(props.tool);
  return (
    <Row
      {...props}
      icon={<Search size={14} />}
      verb="索引を検索"
      target={s.queries.join(" · ")}
      meta={`${s.groups.reduce((n, g) => n + g.hits.length, 0)} 件`}
    >
      <div className="ctx-results lx-frame">
        {s.groups.map((group) => (
          <section key={group.query}>
            <h4>{group.query}</h4>
            {group.hits.map((hit, i) => (
              <article key={i}>
                <header>
                  <SourceIcon source={hit.source} />
                  <code>{hit.source}</code>
                  <small>#{hit.chunk}</small>
                </header>
                <p>
                  <Marked text={hit.text} query={group.query} />
                </p>
              </article>
            ))}
            {group.same && (
              <small className="ctx-note">上と同じ: {group.same}</small>
            )}
          </section>
        ))}
      </div>
    </Row>
  );
}

function SearchBySource(props: ToolProps) {
  const s = searchOf(props.tool);
  const sources = new Map<string, { query: string; hit: Hit }[]>();
  for (const group of s.groups)
    for (const hit of group.hits)
      sources.set(hit.source, [
        ...(sources.get(hit.source) ?? []),
        { query: group.query, hit },
      ]);
  return (
    <Row
      {...props}
      icon={<Search size={14} />}
      verb="索引を検索"
      target={s.queries.join(" · ")}
      meta={`${sources.size} ソース`}
    >
      <ul className="ctx-sources">
        {[...sources].map(([source, hits]) => (
          <li key={source}>
            <p>
              <SourceIcon source={source} />
              <code>{source}</code>
              <span className="lx-row-meta">
                {hits.map(({ hit }) => (
                  <Badge key={hit.chunk}>#{hit.chunk}</Badge>
                ))}
              </span>
            </p>
            {hits.map(({ hit, query }) => (
              <blockquote key={hit.chunk}>
                <Marked text={hit.text} query={query} />
              </blockquote>
            ))}
          </li>
        ))}
      </ul>
    </Row>
  );
}

function SearchTable(props: ToolProps) {
  const s = searchOf(props.tool);
  return (
    <Row
      {...props}
      icon={<Search size={14} />}
      verb="索引を検索"
      target={s.queries.join(" · ")}
    >
      <div className="lx-table-wrap">
        <table className="lx-table ctx-table">
          <thead>
            <tr>
              <th>質問</th>
              <th>ソース</th>
              <th className="lx-num">#</th>
              <th>抜粋</th>
            </tr>
          </thead>
          <tbody>
            {s.groups.flatMap((group) =>
              group.hits.map((hit, i) => (
                <tr key={`${group.query}-${i}`}>
                  <td className="lx-faint">{i === 0 ? group.query : ""}</td>
                  <td>
                    <code>{hit.source}</code>
                  </td>
                  <td className="lx-num">{hit.chunk}</td>
                  <td className="ctx-snippet">{hit.text}</td>
                </tr>
              )),
            )}
          </tbody>
        </table>
      </div>
    </Row>
  );
}

function SearchCompact(props: ToolProps) {
  const s = searchOf(props.tool);
  return (
    <Row
      {...props}
      open={false}
      icon={<Search size={14} />}
      verb="索引を検索"
      target=""
      meta={
        <span className="lx-chips">
          {s.groups.map((group) => (
            <Badge
              key={group.query}
              tone={group.hits.length ? "accent" : "neutral"}
            >
              {group.query} · {group.hits.length}
            </Badge>
          ))}
        </span>
      }
    >
      <ul className="lx-list">
        {s.groups.flatMap((group) =>
          group.hits.map((hit, i) => (
            <li key={`${group.query}-${i}`}>
              <SourceIcon source={hit.source} />
              <span className="lx-ellipsis">{hit.text}</span>
            </li>
          )),
        )}
      </ul>
    </Row>
  );
}

function SearchBest(props: ToolProps) {
  const s = searchOf(props.tool);
  return (
    <section className="lx-card" data-ui-surface="card">
      <CardHead
        icon={<Search size={14} />}
        title="索引から見つけた答え"
        sub={`${s.queries.length} 個の質問`}
        phase={props.phase}
        aside={s.more.length > 0 && <Badge>続きあり</Badge>}
      />
      <Phased {...props}>
        {s.groups.map((group) => {
          const [best, ...rest] = group.hits;
          return (
            <div key={group.query} className="ctx-best">
              <small>{group.query}</small>
              {best ? (
                <>
                  <p>
                    <Marked text={best.text} query={group.query} />
                  </p>
                  <span className="ctx-best-src">
                    <SourceIcon source={best.source} />
                    {best.source}
                    {rest.length > 0 && (
                      <span className="lx-faint"> ほか {rest.length} 件</span>
                    )}
                  </span>
                </>
              ) : (
                <p className="lx-faint">見つかりませんでした</p>
              )}
            </div>
          );
        })}
      </Phased>
    </section>
  );
}

export const ctxSearchProposals = {
  Cards: {
    title: "質問別のカード",
    fit: "質問ごとに、ソースとチャンク番号付きの抜粋を並べる。検索語を強調して根拠を読ませる。",
    View: SearchCards,
  },
  BySource: {
    title: "ソース別",
    fit: "ファイル・過去の実行結果・索引ハンドルのどこから来た情報かでまとめる。",
    View: SearchBySource,
  },
  Table: {
    title: "表",
    fit: "質問・ソース・チャンク・抜粋を列で揃える。多数の結果を見比べたいとき。",
    View: SearchTable,
  },
  Compact: {
    title: "閉じた1行",
    fit: "質問ごとの件数を行の右に並べ、既定は閉じる。開くと抜粋を1行ずつ。",
    View: SearchCompact,
  },
  Best: {
    title: "最有力の答え",
    fit: "質問ごとに最上位の抜粋だけを答えとして見せ、残りは件数で。",
    View: SearchBest,
  },
} satisfies Record<string, Proposal<ToolProps>>;

/* ---------------- ctx_index ---------------- */

function indexOf(tool: Tool) {
  const a = args(tool);
  const text = body(tool);
  const found =
    /^Indexed (\d+) source\(s\), (\d+) chunk\(s\) from (\S+?)\.(?: Label: (.+))?$/m.exec(
      text,
    );
  return {
    target: str(a.path) || str(a.url) || str(a.source) || "テキスト",
    kind: a.url ? "url" : a.content ? "text" : "path",
    sources: Number(found?.[1] ?? 0),
    chunks: Number(found?.[2] ?? 0),
    handle: found?.[3] ?? "",
    label: found?.[4] ?? str(a.path),
  };
}

function IndexCard(props: ToolProps) {
  const x = indexOf(props.tool);
  return (
    <section className="lx-card" data-ui-surface="card">
      <CardHead
        icon={<BookOpen size={14} />}
        title={x.label || x.target}
        sub="検索できるように索引しました"
        phase={props.phase}
        aside={x.handle && <Badge tone="accent">{x.handle}</Badge>}
      />
      <Phased {...props}>
        <p className="ctx-index-facts">
          <span>
            <strong>{x.chunks}</strong> チャンク
          </span>
          <span>
            <strong>{x.sources}</strong> ソース
          </span>
          <code>ctx_search({`{queries:[…], source:"${x.handle}"}`})</code>
        </p>
      </Phased>
    </section>
  );
}

function IndexGrid(props: ToolProps) {
  const x = indexOf(props.tool);
  return (
    <Row
      {...props}
      icon={<Database size={14} />}
      verb="索引"
      target={x.target}
      meta={`${x.chunks} チャンク`}
    >
      <div className="ctx-grid" role="img" aria-label={`${x.chunks} 個に分割`}>
        {Array.from({ length: x.chunks }, (_, i) => (
          <i key={i} />
        ))}
      </div>
    </Row>
  );
}

function IndexHeader(props: ToolProps) {
  const x = indexOf(props.tool);
  return (
    <Row
      {...props}
      open={false}
      icon={<Database size={14} />}
      verb="索引"
      target={x.target}
      meta={
        <span className="lx-chips">
          <Badge>{x.chunks} チャンク</Badge>
          {x.handle && <Badge tone="accent">{x.handle}</Badge>}
        </span>
      }
    />
  );
}

function IndexSentence(props: ToolProps) {
  const x = indexOf(props.tool);
  return (
    <div className="lx-plain">
      <p className="lx-sentence">
        <BookOpen size={13} />
        {props.phase === "done" ? (
          <span>
            <code>{x.label || x.target}</code> を {x.chunks}{" "}
            個に分けて索引しました。以後は <code>{x.handle}</code>{" "}
            で検索できます
          </span>
        ) : props.phase === "running" ? (
          <span className="lx-faint">
            <code>{x.target}</code> を読み込んでいます
          </span>
        ) : (
          <span>索引できませんでした</span>
        )}
      </p>
      {props.phase === "error" && <Phased {...props} />}
    </div>
  );
}

function IndexSteps(props: ToolProps) {
  const x = indexOf(props.tool);
  const steps = [
    { label: x.kind === "url" ? "取得" : "読み込み", value: x.target },
    { label: "分割", value: `${x.chunks} チャンク` },
    { label: "索引", value: x.handle },
  ];
  const reached =
    props.phase === "done" ? 3 : props.phase === "running" ? 1 : 0;
  return (
    <Row {...props} icon={<Database size={14} />} verb="索引" target={x.target}>
      <ol className="ctx-steps">
        {steps.map((step, i) => (
          <li
            key={step.label}
            className={i < reached ? "ctx-step-done" : undefined}
          >
            <i>
              {i < reached ? (
                <Check size={10} />
              ) : props.phase === "error" ? (
                <X size={10} />
              ) : (
                i + 1
              )}
            </i>
            <span>
              {step.label}
              <small>{step.value}</small>
            </span>
          </li>
        ))}
      </ol>
    </Row>
  );
}

export const ctxIndexProposals = {
  Card: {
    title: "索引カード",
    fit: "何を・いくつに分けて索引したかと、後で検索するためのハンドルをカードで残す。",
    View: IndexCard,
  },
  Grid: {
    title: "チャンクの格子",
    fit: "分割された数を小さな四角で並べる。文書の大きさが直感的にわかる。",
    View: IndexGrid,
  },
  Header: {
    title: "見出しだけ",
    fit: "本文を持たない1行。チャンク数とハンドルを行の右にバッジで。",
    View: IndexHeader,
  },
  Sentence: {
    title: "1文の報告",
    fit: "以後どう検索できるかまで文で伝える。",
    View: IndexSentence,
  },
  Steps: {
    title: "読み込み→分割→索引",
    fit: "処理の段階を3ステップで示す。URLの取得など時間のかかる索引で進み具合を伝える。",
    View: IndexSteps,
  },
} satisfies Record<string, Proposal<ToolProps>>;
