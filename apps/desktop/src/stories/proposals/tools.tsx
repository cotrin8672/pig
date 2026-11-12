// biome-ignore-all lint/suspicious/noArrayIndexKey: Fixture lines and steps keep their order and may repeat.
import {
  ArrowRight,
  Check,
  ChevronRight,
  Copy,
  FileCode,
  FilePlus,
  FileText,
  Folder,
  LoaderCircle,
  Search,
  TriangleAlert,
  X,
} from "lucide-react";
import { type ReactNode, useState } from "react";
import type { ToolCardBlock } from "../../../../../packages/config/src";
import {
  CodeText,
  HighlightedDiff,
  TerminalOutput,
} from "../../mainview/HighlightedCode";
import { Markdown } from "../../mainview/MessageContent";
import {
  languageFromPath,
  terminalText,
} from "../../mainview/syntax-highlighting";
import { shellOutcome } from "../../shared/tool-view";
import {
  type Phase,
  type Proposal,
  phaseOf,
  type Tool,
  type ToolProps,
} from "./kit";
import {
  type ChangePair,
  changedSpan,
  diffHunks,
  diffRows,
  grepFiles,
  outline,
  output,
  pairChanges,
  pathLines,
  pathTree,
  readRange,
  type TreeNode,
  toolArgs,
} from "./model";

const baseName = (path: string) =>
  path.split("/").filter(Boolean).at(-1) ?? path;
/** Map.groupBy needs lib es2024, which the app does not target. */
function groupBy(items: string[], key: (item: string) => string) {
  const groups = new Map<string, string[]>();
  for (const item of items)
    groups.set(key(item), [...(groups.get(key(item)) ?? []), item]);
  return groups;
}
const dirName = (path: string) => path.split("/").slice(0, -1).join("/");
const str = (value: unknown) => (typeof value === "string" ? value : "");
const Spinner = ({ size = 12 }: { size?: number }) => (
  <LoaderCircle size={size} className="spinner" aria-label="実行中" />
);
function FileIcon({ path, size = 14 }: { path: string; size?: number }) {
  if (path.endsWith("/"))
    return <Folder size={size} className="pp-icon-folder" />;
  return /\.(tsx?|jsx?|mjs|css|json)$/.test(path) ? (
    <FileCode size={size} className="pp-icon-code" />
  ) : (
    <FileText size={size} className="pp-icon-text" />
  );
}
function Code({
  text,
  path,
  start = 1,
}: {
  text: string;
  path: string;
  start?: number;
}) {
  return (
    <pre className="pp-code">
      <span className="pp-gutter" aria-hidden="true">
        {text.split("\n").map((_, i) => (
          <span key={i}>{start + i}</span>
        ))}
      </span>
      <code>
        <CodeText text={text} language={languageFromPath(path)} />
      </code>
    </pre>
  );
}
/** Highlights the grep pattern the same way the search engine would match it. */
function Highlight({ text, tool }: { text: string; tool: Tool }) {
  const args = toolArgs(tool);
  const pattern = str(args.pattern);
  let regex: RegExp;
  try {
    regex = new RegExp(
      args.literal ? pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") : pattern,
      args.ignoreCase ? "gi" : "g",
    );
  } catch {
    return text;
  }
  const parts: ReactNode[] = [];
  let last = 0;
  for (const found of text.matchAll(regex)) {
    if (!found[0]) break;
    parts.push(
      text.slice(last, found.index),
      <mark key={found.index}>{found[0]}</mark>,
    );
    last = (found.index ?? 0) + found[0].length;
  }
  parts.push(text.slice(last));
  return parts;
}
function Failure({ tool }: { tool: Tool }) {
  return (
    <p className="pp-failure">
      <TriangleAlert size={13} />
      {terminalText(output(tool)) || "結果を受け取る前に中断されました。"}
    </p>
  );
}

/* ---------------- read ---------------- */

function ReadRangeMap({ tool, phase }: ToolProps) {
  const path = str(toolArgs(tool).path);
  const { lines, start, end, total } = readRange(tool);
  const [open, setOpen] = useState(false);
  return (
    <div className={`pp-rangemap pp-${phase}`}>
      <div className="pp-rangemap-head">
        <FileIcon path={path} />
        <strong>{baseName(path)}</strong>
        <small>{dirName(path)}</small>
        <span>
          {phase === "running" ? (
            <Spinner />
          ) : phase === "done" ? (
            <>
              L{start}–{end} <small>/ {total} 行</small>
            </>
          ) : (
            "読めませんでした"
          )}
        </span>
      </div>
      <div className="pp-rangemap-track" aria-hidden="true">
        {phase === "done" && (
          <span
            style={{
              left: `${((start - 1) / total) * 100}%`,
              width: `${((end - start + 1) / total) * 100}%`,
            }}
          />
        )}
      </div>
      {phase === "error" && <Failure tool={tool} />}
      {phase === "done" && (
        <>
          <button
            type="button"
            className="pp-link"
            onClick={() => setOpen(!open)}
          >
            <ChevronRight size={12} className={open ? "pp-open" : undefined} />
            {open ? "コードを隠す" : `${lines.length} 行のコードを表示`}
          </button>
          {open && <Code text={lines.join("\n")} path={path} start={start} />}
        </>
      )}
    </div>
  );
}

function ReadCitation({ tool, phase }: ToolProps) {
  const path = str(toolArgs(tool).path);
  const { lines, start, end } = readRange(tool);
  const [open, setOpen] = useState(false);
  return (
    <div className="pp-citation">
      <span className="pp-faint">参照</span>
      <button
        type="button"
        className={`pp-chip pp-${phase}`}
        aria-expanded={open}
        disabled={phase !== "done"}
        title={phase === "error" ? terminalText(output(tool)) : path}
        onClick={() => setOpen(!open)}
      >
        {phase === "running" ? <Spinner /> : <FileIcon path={path} size={12} />}
        <code>
          {baseName(path)}
          {phase === "done" && `:${start}–${end}`}
        </code>
      </button>
      {phase === "error" && (
        <small className="pp-error-text">読めませんでした</small>
      )}
      {open && (
        <div className="pp-peek-popover">
          <header>
            <code>{path}</code>
            <button
              type="button"
              aria-label="閉じる"
              onClick={() => setOpen(false)}
            >
              <X size={12} />
            </button>
          </header>
          <Code text={lines.slice(0, 8).join("\n")} path={path} start={start} />
        </div>
      )}
    </div>
  );
}

function ReadPeek({ tool, phase }: ToolProps) {
  const path = str(toolArgs(tool).path);
  const { lines, start, end, total } = readRange(tool);
  const [open, setOpen] = useState(false);
  const shown = open ? lines : lines.slice(0, 5);
  return (
    <div className="pp-peek">
      <header>
        <FileIcon path={path} />
        <code>{path}</code>
        <span>
          {phase === "running" ? (
            <Spinner />
          ) : (
            phase === "done" && `L${start}–${end}`
          )}
        </span>
      </header>
      {phase === "error" ? (
        <Failure tool={tool} />
      ) : phase === "running" ? (
        <div className="pp-skeleton" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
      ) : (
        <>
          <div className={open ? undefined : "pp-fade"}>
            <Code text={shown.join("\n")} path={path} start={start} />
          </div>
          <footer>
            {lines.length > 5 && (
              <button
                type="button"
                className="pp-link"
                onClick={() => setOpen(!open)}
              >
                {open ? "折りたたむ" : `残り ${lines.length - 5} 行を表示`}
              </button>
            )}
            {total > end && (
              <small>ファイルはさらに {total - end} 行続く</small>
            )}
          </footer>
        </>
      )}
    </div>
  );
}

export const readProposals = {
  RangeMap: {
    title: "ファイル内の位置",
    fit: "大きなファイルを分割して読む場面。読んだ範囲がファイル全体のどこかを帯で示し、コードは必要な時だけ開く。",
    View: ReadRangeMap,
  },
  Citation: {
    title: "参照チップ",
    fit: "読み取りは回数が多く、中身はエージェント向け。会話の流れを止めない小さな参照にし、気になった時だけ覗ける。",
    View: ReadCitation,
  },
  Peek: {
    title: "冒頭プレビュー",
    fit: "読んだ内容が回答の根拠になる場面。冒頭数行を常に見せ、残りの行数とファイルの続きを示す。",
    View: ReadPeek,
  },
} satisfies Record<string, Proposal<ToolProps>>;

/* ---------------- edit ---------------- */

const diffOf = (tool: Tool) =>
  str(
    (tool.state?.result as { details?: { diff?: unknown } } | undefined)
      ?.details?.diff,
  );
type PlannedEdit = { oldText: string; newText: string };
const plannedEdits = (tool: Tool) =>
  (toolArgs(tool).edits as PlannedEdit[] | undefined) ?? [];

function WordLine({ pair }: { pair: ChangePair }) {
  if (pair.ctx)
    return (
      <div className="pp-wd-row">
        <span>{pair.ctx.line}</span>
        <code>{pair.ctx.text || " "}</code>
      </div>
    );
  const span =
    pair.del && pair.add
      ? changedSpan(pair.del.text, pair.add.text)
      : undefined;
  return (
    <>
      {pair.del && (
        <div className="pp-wd-row pp-wd-del">
          <span>{pair.del.line}</span>
          <code>
            {span ? (
              <>
                {span.prefix}
                <del>{span.removed}</del>
                {span.suffix}
              </>
            ) : (
              pair.del.text
            )}
          </code>
        </div>
      )}
      {pair.add && (
        <div className="pp-wd-row pp-wd-add">
          <span>{pair.add.line}</span>
          <code>
            {span ? (
              <>
                {span.prefix}
                <ins>{span.added}</ins>
                {span.suffix}
              </>
            ) : (
              pair.add.text
            )}
          </code>
        </div>
      )}
    </>
  );
}

function EditHeader({
  tool,
  phase,
  children,
}: ToolProps & { children?: ReactNode }) {
  const path = str(toolArgs(tool).path);
  return (
    <header className="pp-edit-head">
      <FileIcon path={path} />
      <strong>{baseName(path)}</strong>
      <small>{dirName(path)}</small>
      <span>{phase === "running" ? <Spinner /> : children}</span>
    </header>
  );
}

function EditWordDiff(props: ToolProps) {
  const { tool, phase } = props;
  const hunks = diffHunks(diffRows(diffOf(tool)));
  return (
    <div className="pp-worddiff">
      <EditHeader {...props} />
      {phase === "error" && <Failure tool={tool} />}
      {phase === "running" && <p className="pp-faint pp-pad">差分を作成中…</p>}
      {hunks.map((hunk, index) => (
        <div key={index}>
          {index > 0 && (
            <div className="pp-wd-gap">
              ⋯ {hunk[0].line - (hunks[index - 1].at(-1)?.line ?? 0) - 1} 行省略
            </div>
          )}
          {pairChanges(hunk).map((pair, i) => (
            <WordLine key={i} pair={pair} />
          ))}
        </div>
      ))}
    </div>
  );
}

const clip = (text: string, size = 48) =>
  text.trim().length > size ? `${text.trim().slice(0, size)}…` : text.trim();
function EditSummary(props: ToolProps) {
  const { tool, phase } = props;
  const [open, setOpen] = useState(false);
  const diff = diffOf(tool);
  const pairs = diffHunks(diffRows(diff))
    .flatMap(pairChanges)
    .filter((pair) => !pair.ctx);
  const planned = plannedEdits(tool);
  return (
    <div className="pp-edit-summary">
      <EditHeader {...props}>
        {phase === "done"
          ? `${pairs.length} 箇所を変更`
          : "適用できませんでした"}
      </EditHeader>
      <ul>
        {phase === "done"
          ? pairs.map((pair, i) => {
              const line = (pair.add ?? pair.del)?.line;
              const span =
                pair.del && pair.add
                  ? changedSpan(pair.del.text, pair.add.text)
                  : undefined;
              return (
                <li key={i}>
                  <span className="pp-lineno">L{line}</span>
                  {span ? (
                    <>
                      <del>{clip(span.removed) || "（空）"}</del>
                      <ArrowRight size={12} />
                      <ins>{clip(span.added) || "（空）"}</ins>
                    </>
                  ) : pair.add ? (
                    <>
                      <span className="pp-tag pp-tag-add">追加</span>
                      <code>{clip(pair.add.text)}</code>
                    </>
                  ) : (
                    <>
                      <span className="pp-tag pp-tag-del">削除</span>
                      <code>{clip(pair.del?.text ?? "")}</code>
                    </>
                  )}
                </li>
              );
            })
          : planned.map((edit, i) => (
              <li
                key={i}
                className={phase === "running" ? "pp-planned" : undefined}
              >
                <span className="pp-lineno">{i + 1}</span>
                <del>{clip(edit.oldText)}</del>
                <ArrowRight size={12} />
                <ins>{clip(edit.newText)}</ins>
              </li>
            ))}
      </ul>
      {phase === "error" && <Failure tool={tool} />}
      {phase === "done" && (
        <>
          <button
            type="button"
            className="pp-link pp-pad"
            onClick={() => setOpen(!open)}
          >
            <ChevronRight size={12} className={open ? "pp-open" : undefined} />
            差分全体
          </button>
          {open && (
            <HighlightedDiff
              text={diff}
              path={str(toolArgs(tool).path)}
              numbered
            />
          )}
        </>
      )}
    </div>
  );
}

function StatBlocks({ added, removed }: { added: number; removed: number }) {
  const total = added + removed || 1;
  const green = Math.round((added / total) * 5);
  return (
    <span className="pp-statblocks" title={`+${added} −${removed}`}>
      <ins>+{added}</ins>
      <del>−{removed}</del>
      {[0, 1, 2, 3, 4].map((i) => (
        <i key={i} className={i < green ? "pp-add" : "pp-del"} />
      ))}
    </span>
  );
}
function EditHunks(props: ToolProps) {
  const { tool, phase } = props;
  const rows = diffRows(diffOf(tool));
  const hunks = diffHunks(rows);
  const [open, setOpen] = useState(0);
  return (
    <div className="pp-hunks">
      <EditHeader {...props}>
        {phase === "done" && (
          <StatBlocks
            added={rows.filter((row) => row.kind === "add").length}
            removed={rows.filter((row) => row.kind === "del").length}
          />
        )}
      </EditHeader>
      {phase === "error" && <Failure tool={tool} />}
      {hunks.map((hunk, index) => {
        const add = hunk.filter((row) => row.kind === "add").length;
        const del = hunk.filter((row) => row.kind === "del").length;
        return (
          <section key={index}>
            <button
              type="button"
              aria-expanded={open === index}
              onClick={() => setOpen(open === index ? -1 : index)}
            >
              <ChevronRight
                size={12}
                className={open === index ? "pp-open" : undefined}
              />
              <code>
                L{hunk[0].line}–{hunk.at(-1)?.line}
              </code>
              <span className="pp-hunk-context">
                {hunk.find((row) => row.kind === "ctx")?.text.trim()}
              </span>
              <ins>+{add}</ins>
              <del>−{del}</del>
            </button>
            {open === index && (
              <div className="pp-hunk-body">
                {pairChanges(hunk).map((pair, i) => (
                  <WordLine key={i} pair={pair} />
                ))}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}

export const editProposals = {
  WordDiff: {
    title: "語単位の差分",
    fit: "行の一部だけを書き換える編集。変わった文字だけを強調し、省略した行数も示す。",
    View: EditWordDiff,
  },
  Summary: {
    title: "変更点の箇条書き",
    fit: "数箇所の書き換え。差分を読まなくても「何を何に変えたか」が分かる。実行中も引数から予定を示せる。",
    View: EditSummary,
  },
  Hunks: {
    title: "変更ブロックごとに開閉",
    fit: "大きなファイルへの広い範囲の編集。変更の塊を見出しとして並べ、一つずつ開いて確認する。",
    View: EditHunks,
  },
} satisfies Record<string, Proposal<ToolProps>>;

/* ---------------- write ---------------- */

const bytes = (text: string) => new TextEncoder().encode(text).length;
function WritePlacement({ tool, phase }: ToolProps) {
  const path = str(toolArgs(tool).path);
  const content = str(toolArgs(tool).content);
  const [open, setOpen] = useState(false);
  const folders = dirName(path).split("/").filter(Boolean);
  return (
    <div className="pp-placement">
      <ul className="pp-tree">
        {folders.map((name, depth) => (
          <li key={depth} style={{ paddingLeft: depth * 14 }}>
            <Folder size={13} className="pp-icon-folder" />
            {name}
          </li>
        ))}
        <li
          style={{ paddingLeft: folders.length * 14 }}
          className={`pp-new pp-${phase}`}
        >
          <FilePlus size={13} />
          <strong>{baseName(path)}</strong>
          <span className="pp-tag pp-tag-add">
            {phase === "done" ? "NEW" : phase === "running" ? "作成中" : "失敗"}
          </span>
          <small>
            {content.split("\n").length} 行 · {bytes(content)} B
          </small>
        </li>
      </ul>
      {phase === "error" ? (
        <Failure tool={tool} />
      ) : (
        <>
          <button
            type="button"
            className="pp-link"
            onClick={() => setOpen(!open)}
          >
            <ChevronRight size={12} className={open ? "pp-open" : undefined} />
            内容
          </button>
          {open && <Code text={content} path={path} />}
        </>
      )}
    </div>
  );
}

function WriteOutline({ tool, phase }: ToolProps) {
  const path = str(toolArgs(tool).path);
  const content = str(toolArgs(tool).content);
  const symbols = outline(content);
  const [line, setLine] = useState<number>();
  const lines = content.split("\n");
  return (
    <div className="pp-outline">
      <header>
        <FilePlus size={14} />
        <code>{path}</code>
        <span>
          {phase === "running" ? (
            <Spinner />
          ) : phase === "done" ? (
            "作成"
          ) : (
            "失敗"
          )}
        </span>
      </header>
      {phase === "error" && <Failure tool={tool} />}
      <ul>
        {symbols.map((symbol) => (
          <li key={symbol.line}>
            <button
              type="button"
              aria-pressed={line === symbol.line}
              onClick={() =>
                setLine(line === symbol.line ? undefined : symbol.line)
              }
            >
              <span className={`pp-kind pp-kind-${symbol.kind}`}>
                {symbol.kind}
              </span>
              <code>{symbol.name}</code>
              {symbol.exported && <small>export</small>}
              <span className="pp-lineno">L{symbol.line}</span>
            </button>
            {line === symbol.line && (
              <Code
                text={lines.slice(symbol.line - 1, symbol.line + 3).join("\n")}
                path={path}
                start={symbol.line}
              />
            )}
          </li>
        ))}
      </ul>
      <small className="pp-pad">
        {symbols.length} 個の宣言 · {lines.length} 行
      </small>
    </div>
  );
}

function WriteArtifact({ tool, phase }: ToolProps) {
  const path = str(toolArgs(tool).path);
  const content = str(toolArgs(tool).content);
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const extension = baseName(path).split(".").at(-1)?.toUpperCase();
  return (
    <div className={`pp-artifact pp-${phase}`}>
      <div className="pp-artifact-card">
        <span className="pp-artifact-badge">{extension}</span>
        <div>
          <strong>{baseName(path)}</strong>
          <small>
            {dirName(path)} · {content.split("\n").length} 行 · {bytes(content)}{" "}
            B
          </small>
        </div>
        {phase === "running" ? (
          <Spinner size={14} />
        ) : phase === "done" ? (
          <span className="pp-actions">
            <button
              type="button"
              onClick={() =>
                void navigator.clipboard
                  .writeText(content)
                  .then(() => setCopied(true))
              }
            >
              {copied ? <Check size={13} /> : <Copy size={13} />}
              {copied ? "コピー済み" : "コピー"}
            </button>
            <button
              type="button"
              aria-expanded={open}
              onClick={() => setOpen(!open)}
            >
              {open ? "閉じる" : "全文"}
            </button>
          </span>
        ) : null}
      </div>
      {phase === "error" && <Failure tool={tool} />}
      {phase !== "error" && (
        <div className={open ? undefined : "pp-fade"}>
          <Code
            text={open ? content : content.split("\n").slice(0, 4).join("\n")}
            path={path}
          />
        </div>
      )}
    </div>
  );
}

export const writeProposals = {
  Placement: {
    title: "ツリー上の位置",
    fit: "新しいファイルがプロジェクトのどこに置かれたかが大事な場面。構成の変化として見せる。",
    View: WritePlacement,
  },
  Outline: {
    title: "宣言アウトライン",
    fit: "コードの新規作成。全文よりも、何を定義・公開したかが要点になる。",
    View: WriteOutline,
  },
  Artifact: {
    title: "成果物カード",
    fit: "設定ファイルや文書など、ユーザーが受け取って使うファイル。添付ファイルのように扱いコピーできる。",
    View: WriteArtifact,
  },
} satisfies Record<string, Proposal<ToolProps>>;

/* ---------------- grep ---------------- */

function SearchHead({
  tool,
  phase,
  children,
}: ToolProps & { children?: ReactNode }) {
  const args = toolArgs(tool);
  return (
    <header className="pp-search-head">
      <Search size={13} />
      <code>{str(args.pattern)}</code>
      <small>
        {str(args.path) || "."}
        {args.glob ? ` · ${str(args.glob)}` : ""}
      </small>
      <span>{phase === "running" ? <Spinner /> : children}</span>
    </header>
  );
}
const matchCount = (files: ReturnType<typeof grepFiles>) =>
  files.reduce(
    (sum, file) => sum + file.lines.filter((line) => line.match).length,
    0,
  );

function GrepGroups(props: ToolProps) {
  const { tool, phase } = props;
  const files = grepFiles(tool);
  return (
    <div className="pp-grep-groups">
      <SearchHead {...props}>
        {phase === "done" &&
          `${files.length} ファイル · ${matchCount(files)} 件`}
      </SearchHead>
      {phase === "error" && <Failure tool={tool} />}
      {files.map((file) => (
        <section key={file.path}>
          <h4>
            <FileIcon path={file.path} size={13} />
            {baseName(file.path)}
            <small>{dirName(file.path)}</small>
            <span className="pp-count">{file.lines.length}</span>
          </h4>
          {file.lines.map((line) => (
            <div
              key={line.line}
              className={line.match ? "pp-match" : "pp-context"}
            >
              <span>{line.line}</span>
              <code>
                <Highlight text={line.text.trim()} tool={tool} />
              </code>
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}

function GrepDistribution(props: ToolProps) {
  const { tool, phase } = props;
  const files = grepFiles(tool).sort((a, b) => b.lines.length - a.lines.length);
  const max = files[0]?.lines.length ?? 1;
  const [selected, setSelected] = useState<string>();
  const active = files.find((file) => file.path === selected);
  return (
    <div className="pp-distribution">
      <SearchHead {...props}>
        {phase === "done" && `${matchCount(files)} 件`}
      </SearchHead>
      {phase === "error" && <Failure tool={tool} />}
      <ul>
        {files.map((file) => (
          <li key={file.path}>
            <button
              type="button"
              aria-pressed={selected === file.path}
              onClick={() =>
                setSelected(selected === file.path ? undefined : file.path)
              }
            >
              <code title={file.path}>{file.path}</code>
              <span className="pp-bar">
                <span
                  style={{ width: `${(file.lines.length / max) * 100}%` }}
                />
              </span>
              <strong>{file.lines.length}</strong>
            </button>
          </li>
        ))}
      </ul>
      {active && (
        <div className="pp-distribution-lines">
          {active.lines.map((line) => (
            <div key={line.line}>
              <span>L{line.line}</span>
              <code>
                <Highlight text={line.text.trim()} tool={tool} />
              </code>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function GrepSentence({ tool, phase }: ToolProps) {
  const files = grepFiles(tool);
  const [open, setOpen] = useState(false);
  const pattern = (
    <code className="pp-inline-code">{str(toolArgs(tool).pattern)}</code>
  );
  return (
    <div className="pp-sentence">
      <p>
        <Search size={13} />
        {phase === "running" ? (
          <>
            {pattern} を検索しています <Spinner />
          </>
        ) : phase === "error" ? (
          <>
            {pattern} を検索できませんでした
            <small className="pp-error-text"> — {output(tool)}</small>
          </>
        ) : (
          <>
            {pattern} が <strong>{files.length} ファイル</strong>で{" "}
            <strong>{matchCount(files)} 件</strong>
            <button
              type="button"
              className="pp-link"
              onClick={() => setOpen(!open)}
            >
              {open ? "隠す" : "場所"}
            </button>
          </>
        )}
      </p>
      {open && (
        <div className="pp-chips">
          {files.map((file) => (
            <span key={file.path} className="pp-chip" title={file.path}>
              <FileIcon path={file.path} size={12} />
              {baseName(file.path)}
              <small>{file.lines.map((line) => line.line).join(", ")}</small>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

export const grepProposals = {
  Groups: {
    title: "ファイル別の一致行",
    fit: "一致した行そのものを読んで判断する場面。エディタの検索パネルと同じ読み方ができる。",
    View: GrepGroups,
  },
  Distribution: {
    title: "一致の分布",
    fit: "一致が多く、どこに集中しているかを知りたい場面（影響範囲の見積もり）。棒を選ぶとその行が出る。",
    View: GrepDistribution,
  },
  Sentence: {
    title: "一文の結果",
    fit: "検索が調査の途中経過にすぎない場面。件数だけ伝えて場所を取らず、行番号は必要な時に出す。",
    View: GrepSentence,
  },
} satisfies Record<string, Proposal<ToolProps>>;

/* ---------------- find ---------------- */

function Tree({ nodes, depth = 0 }: { nodes: TreeNode[]; depth?: number }) {
  return nodes.map((node) => (
    <li key={node.name}>
      <span style={{ paddingLeft: depth * 16 }}>
        <FileIcon path={node.file ? node.name : `${node.name}/`} size={13} />
        {node.name}
        {!node.file && <small>{countFiles(node)}</small>}
      </span>
      {node.children.length > 0 && (
        <ul>
          <Tree nodes={node.children} depth={depth + 1} />
        </ul>
      )}
    </li>
  ));
}
const countFiles = (node: TreeNode): number =>
  node.file
    ? 1
    : node.children.reduce((sum, child) => sum + countFiles(child), 0);

function FindTree(props: ToolProps) {
  const { tool, phase } = props;
  const paths = pathLines(tool);
  return (
    <div className="pp-find-tree">
      <SearchHead {...props}>
        {phase === "done" && `${paths.length} ファイル`}
      </SearchHead>
      {phase === "error" && <Failure tool={tool} />}
      <ul className="pp-tree">
        <Tree nodes={pathTree(paths)} />
      </ul>
    </div>
  );
}

/** The literal tail of the glob ("*.test.ts" → ".test.ts") is what every result shares. */
function FindMatched(props: ToolProps) {
  const { tool, phase } = props;
  const tail = str(toolArgs(tool).pattern).split("*").at(-1) ?? "";
  return (
    <div className="pp-find-matched">
      <SearchHead {...props}>
        {phase === "done" && `${pathLines(tool).length} 件`}
      </SearchHead>
      {phase === "error" && <Failure tool={tool} />}
      <ul>
        {pathLines(tool).map((path) => {
          const name = baseName(path);
          const cut =
            tail && name.endsWith(tail)
              ? name.length - tail.length
              : name.length;
          return (
            <li key={path}>
              <span className="pp-faint">{dirName(path)}/</span>
              <strong>{name.slice(0, cut)}</strong>
              <mark>{name.slice(cut)}</mark>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function FindFacets(props: ToolProps) {
  const { tool, phase } = props;
  const paths = pathLines(tool);
  const [open, setOpen] = useState<string>();
  const groups = groupBy(paths, (path) =>
    path.split("/").slice(0, 2).join("/"),
  );
  return (
    <div className="pp-facets">
      <SearchHead {...props}>
        {phase === "done" && `${paths.length} ファイル`}
      </SearchHead>
      {phase === "error" && <Failure tool={tool} />}
      <div className="pp-facet-bar" aria-hidden="true">
        {[...groups].map(([name, items]) => (
          <span key={name} style={{ flex: items.length }} />
        ))}
      </div>
      <div className="pp-chips">
        {[...groups].map(([name, items]) => (
          <button
            key={name}
            type="button"
            className="pp-chip"
            aria-pressed={open === name}
            onClick={() => setOpen(open === name ? undefined : name)}
          >
            <Folder size={12} className="pp-icon-folder" />
            {name}
            <strong>{items.length}</strong>
          </button>
        ))}
      </div>
      {open && (
        <ul className="pp-facet-list">
          {groups.get(open)?.map((path) => (
            <li key={path}>
              <code>{path.slice(open.length + 1)}</code>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export const findProposals = {
  Tree: {
    title: "フォルダツリー",
    fit: "結果が複数のフォルダにまたがる場面。共通の親をまとめ、構造ごとに把握できる。",
    View: FindTree,
  },
  Matched: {
    title: "一致部分の強調",
    fit: "パターンが意図どおりに当たったか確かめる場面。フォルダを薄く、名前と一致した部分を強く示す。",
    View: FindMatched,
  },
  Facets: {
    title: "フォルダ別の内訳",
    fit: "結果が多い検索。まずどこに何件あるかを示し、一覧は選んだフォルダだけ開く。",
    View: FindFacets,
  },
} satisfies Record<string, Proposal<ToolProps>>;

/* ---------------- ls ---------------- */

function Entries({ tool }: { tool: Tool }) {
  const entries = pathLines(tool);
  return {
    folders: entries.filter((entry) => entry.endsWith("/")),
    files: entries.filter((entry) => !entry.endsWith("/")),
  };
}
function LsHead({ tool, phase }: ToolProps) {
  return (
    <header className="pp-ls-head">
      <Folder size={14} className="pp-icon-folder" />
      <code>{str(toolArgs(tool).path) || "."}</code>
      {phase === "running" && <Spinner />}
    </header>
  );
}

function LsIcons(props: ToolProps) {
  const { tool, phase } = props;
  const { folders, files } = Entries({ tool });
  return (
    <div className="pp-ls-icons">
      <LsHead {...props} />
      {phase === "error" && <Failure tool={tool} />}
      <div>
        {[...folders, ...files].map((entry) => (
          <span
            key={entry}
            className={entry.startsWith(".") ? "pp-dotfile" : undefined}
          >
            <FileIcon path={entry} size={26} />
            <small>{entry.replace(/\/$/, "")}</small>
          </span>
        ))}
      </div>
    </div>
  );
}

function LsSummary(props: ToolProps) {
  const { tool, phase } = props;
  const { folders, files } = Entries({ tool });
  const kinds = groupBy(files, (file) =>
    file.startsWith(".")
      ? "dotfile"
      : (file.match(/(\.[^.]+)$/)?.[1] ?? "その他"),
  );
  return (
    <div className="pp-ls-summary">
      <LsHead {...props} />
      {phase === "error" && <Failure tool={tool} />}
      {phase === "done" && (
        <dl>
          <dt>フォルダ {folders.length}</dt>
          <dd>
            {folders.map((folder) => (
              <span key={folder} className="pp-chip">
                <Folder size={12} className="pp-icon-folder" />
                {folder.replace(/\/$/, "")}
              </span>
            ))}
          </dd>
          <dt>ファイル {files.length}</dt>
          <dd>
            {[...kinds].map(([kind, items]) => (
              <span key={kind} className="pp-chip" title={items.join("\n")}>
                {kind}
                <strong>{items.length}</strong>
              </span>
            ))}
          </dd>
        </dl>
      )}
    </div>
  );
}

function LsColumns(props: ToolProps) {
  const { tool, phase } = props;
  const { folders, files } = Entries({ tool });
  const crumbs = [
    ".",
    ...(str(toolArgs(tool).path) || "").split("/").filter(Boolean),
  ];
  return (
    <div className="pp-ls-columns">
      <nav aria-label="場所" className="pp-crumbs">
        {crumbs.map((crumb, i) => (
          <span key={i}>
            {i > 0 && <ChevronRight size={11} />}
            {crumb}
          </span>
        ))}
        {phase === "running" && <Spinner />}
      </nav>
      {phase === "error" && <Failure tool={tool} />}
      {phase === "done" && (
        <div>
          <ul>
            {folders.map((folder) => (
              <li key={folder}>
                <Folder size={13} className="pp-icon-folder" />
                {folder.replace(/\/$/, "")}
                <ChevronRight size={11} className="pp-faint" />
              </li>
            ))}
          </ul>
          <ul>
            {files.map((file) => (
              <li key={file}>
                <FileIcon path={file} size={13} />
                {file}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export const lsProposals = {
  Icons: {
    title: "アイコン一覧",
    fit: "フォルダの中身を見渡す場面。フォルダ・コード・設定ファイルの違いが形で分かる。",
    View: LsIcons,
  },
  Summary: {
    title: "構成の要約",
    fit: "構成をつかむための ls。名前の羅列より、フォルダ名と拡張子ごとの数が役に立つ。",
    View: LsSummary,
  },
  Columns: {
    title: "パンくずと二段組",
    fit: "フォルダを辿りながら探す流れ。現在地と、下に進めるフォルダ・ファイルを分けて示す。",
    View: LsColumns,
  },
} satisfies Record<string, Proposal<ToolProps>>;

/* ---------------- bash / powershell ---------------- */

function shell(tool: Tool) {
  const { output: raw, exitCode } = shellOutcome(output(tool));
  const plain = terminalText(raw).trimEnd();
  const seconds = (
    tool.state?.result as { structuredContent?: { wall_time_seconds?: number } }
  )?.structuredContent?.wall_time_seconds;
  return {
    raw: raw.trimEnd(),
    lines: plain ? plain.split("\n") : [],
    exitCode: phaseOf(tool) === "done" ? 0 : exitCode,
    seconds,
    command: str(toolArgs(tool).command),
  };
}

function ShellTerminal({ tool, phase }: ToolProps) {
  const { raw, exitCode, seconds, command } = shell(tool);
  return (
    <div className="pp-terminal">
      <div className="pp-terminal-bar">
        <i />
        <i />
        <i />
        <span>{tool.call.name}</span>
      </div>
      <pre>
        <span className="pp-prompt">
          {tool.call.name === "powershell" ? "PS>" : "$"}{" "}
        </span>
        <CodeText text={command} language={tool.call.name} />
        {"\n"}
        {raw && <TerminalOutput text={raw} />}
        {phase === "running" && <span className="pp-cursor" />}
      </pre>
      {phase !== "running" && (
        <footer className={exitCode ? "pp-error-text" : undefined}>
          <span>exit {exitCode ?? "?"}</span>
          {seconds !== undefined && <span>{seconds}s</span>}
        </footer>
      )}
    </div>
  );
}

const PROBLEM = /error|fail|×|✗|assert|cannot|not found|denied/i;
const WARNING = /warn|\(!\)|deprecat|missing/i;
function ShellVerdict({ tool, phase }: ToolProps) {
  const { raw, lines, exitCode, seconds, command } = shell(tool);
  const [open, setOpen] = useState(false);
  const meaningful = lines.filter((line) => line.trim());
  const headline =
    phase === "error"
      ? (meaningful.find((line) => PROBLEM.test(line)) ?? meaningful.at(-1))
      : ([...meaningful]
          .reverse()
          .find((line) => /pass|success|\bok\b|done/i.test(line)) ??
        meaningful.at(-1));
  const flagged = meaningful.filter((line) =>
    phase === "error"
      ? PROBLEM.test(line) && line !== headline
      : WARNING.test(line),
  );
  return (
    <div className={`pp-verdict pp-${phase}`}>
      <div className="pp-verdict-head">
        {phase === "running" ? (
          <Spinner size={16} />
        ) : phase === "done" ? (
          <Check size={16} />
        ) : (
          <X size={16} />
        )}
        <strong>
          {phase === "running"
            ? "実行中"
            : phase === "done"
              ? "成功"
              : exitCode !== undefined
                ? `失敗 (exit ${exitCode})`
                : "中断"}
        </strong>
        {headline && <code>{headline.trim()}</code>}
        {seconds !== undefined && phase === "done" && <small>{seconds}s</small>}
      </div>
      <code className="pp-verdict-command">
        {tool.call.name === "powershell" ? "PS> " : "$ "}
        {command}
      </code>
      {flagged.length > 0 && (
        <ul className="pp-flagged">
          {flagged.map((line, i) => (
            <li key={i}>
              <TriangleAlert size={12} />
              {line.trim()}
            </li>
          ))}
        </ul>
      )}
      {raw && (
        <>
          <button
            type="button"
            className="pp-link"
            onClick={() => setOpen(!open)}
          >
            <ChevronRight size={12} className={open ? "pp-open" : undefined} />
            出力 {lines.length} 行
          </button>
          {open && (
            <pre className="pp-log">
              <TerminalOutput text={raw} />
            </pre>
          )}
        </>
      )}
    </div>
  );
}

function ShellHeadTail({ tool, phase }: ToolProps) {
  const { raw, lines, exitCode, command } = shell(tool);
  const [open, setOpen] = useState(false);
  const rawLines = raw.split("\n");
  const folded = !open && lines.length > 7;
  return (
    <div className="pp-headtail">
      <header>
        <code>
          {tool.call.name === "powershell" ? "PS> " : "$ "}
          {command}
        </code>
        <span className={exitCode ? "pp-error-text" : "pp-ok-text"}>
          {phase === "running" ? (
            <Spinner />
          ) : exitCode === undefined ? (
            "中断"
          ) : (
            `exit ${exitCode}`
          )}
        </span>
      </header>
      {phase === "running" && !raw ? (
        <p className="pp-faint pp-pad">出力を待っています…</p>
      ) : (
        <pre className="pp-log">
          <TerminalOutput
            text={folded ? rawLines.slice(0, 2).join("\n") : raw}
          />
          {folded && (
            <>
              {"\n"}
              <button
                type="button"
                className="pp-fold"
                onClick={() => setOpen(true)}
              >
                ⋯ {lines.length - 6} 行を表示 ⋯
              </button>
              {"\n"}
              <TerminalOutput text={rawLines.slice(-4).join("\n")} />
            </>
          )}
        </pre>
      )}
    </div>
  );
}

export const shellProposals = {
  Terminal: {
    title: "ターミナル",
    fit: "出力を全部読む必要がある場面。色付きのログを端末と同じ見た目で、終了コードと所要時間を添える。",
    View: ShellTerminal,
  },
  Verdict: {
    title: "結果を先に",
    fit: "テストやビルドのように成否と要点で足りるコマンド。結論の行と警告・エラー行だけを抜き出す。",
    View: ShellVerdict,
  },
  HeadTail: {
    title: "先頭と末尾",
    fit: "長いログ。始まり（何を実行したか）と終わり（どうなったか）に情報が集まるので、中間を畳む。",
    View: ShellHeadTail,
  },
} satisfies Record<string, Proposal<ToolProps>>;

/* ---------------- extension tool ---------------- */

function Value({ value }: { value: unknown }) {
  return (
    <span className={`pp-json-${value === null ? "null" : typeof value}`}>
      {JSON.stringify(value)}
    </span>
  );
}
function ExtensionSignature({ tool, phase }: ToolProps) {
  const entries = Object.entries(toolArgs(tool));
  const [open, setOpen] = useState(false);
  const lines = output(tool).split("\n");
  return (
    <div className="pp-signature">
      <code className="pp-call">
        <strong>{tool.call.name}</strong>(
        {entries.map(([key, value], i) => (
          <span key={key}>
            {i > 0 && ", "}
            <span className="pp-faint">{key}: </span>
            <Value value={value} />
          </span>
        ))}
        )
      </code>
      <div className="pp-return">
        <ArrowRight size={12} />
        {phase === "running" ? (
          <Spinner />
        ) : phase === "error" ? (
          <span className="pp-error-text">{output(tool)}</span>
        ) : (
          <>
            <code>{lines[0]}</code>
            {lines.length > 1 && (
              <button
                type="button"
                className="pp-link"
                onClick={() => setOpen(!open)}
              >
                {open ? "隠す" : `+${lines.length - 1} 行`}
              </button>
            )}
          </>
        )}
      </div>
      {open && <pre className="pp-result">{lines.slice(1).join("\n")}</pre>}
    </div>
  );
}

function ExtensionTable({ tool, phase }: ToolProps) {
  const entries = Object.entries(toolArgs(tool));
  return (
    <div className="pp-argtable">
      <header>
        <strong>{tool.call.name}</strong>
        <span>
          {phase === "running" ? (
            <Spinner />
          ) : phase === "done" ? (
            <Check size={13} />
          ) : (
            <X size={13} />
          )}
        </span>
      </header>
      <table>
        <tbody>
          {entries.map(([key, value]) => (
            <tr key={key}>
              <th scope="row">{key}</th>
              <td>
                <Value value={value} />
              </td>
              <td className="pp-faint">{typeof value}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {phase === "error" ? (
        <Failure tool={tool} />
      ) : (
        phase === "done" && <pre className="pp-result">{output(tool)}</pre>
      )}
    </div>
  );
}

function ExtensionResultFirst({ tool, phase }: ToolProps) {
  const [open, setOpen] = useState(false);
  return (
    <div className="pp-resultfirst">
      {phase === "running" ? (
        <p className="pp-faint">
          <Spinner /> {tool.call.name} を実行しています
        </p>
      ) : phase === "error" ? (
        <Failure tool={tool} />
      ) : (
        <pre className="pp-result">{output(tool)}</pre>
      )}
      <button type="button" className="pp-link" onClick={() => setOpen(!open)}>
        <ChevronRight size={12} className={open ? "pp-open" : undefined} />
        {tool.call.name} への入力
      </button>
      {open && (
        <pre className="pp-result">
          {JSON.stringify(toolArgs(tool), null, 2)}
        </pre>
      )}
    </div>
  );
}

export const extensionProposals = {
  Signature: {
    title: "関数呼び出しの形",
    fit: "引数が少ない拡張ツール。呼び出しの式と戻り値の 1 行目がそのまま説明になる。",
    View: ExtensionSignature,
  },
  Table: {
    title: "引数の表",
    fit: "引数が多い、または値が長いツール。名前・値・型を一つずつ確かめられる。",
    View: ExtensionTable,
  },
  ResultFirst: {
    title: "結果だけ",
    fit: "入力に興味がないツール（検索や参照）。結果を本文として見せ、入力は必要な時に開く。",
    View: ExtensionResultFirst,
  },
} satisfies Record<string, Proposal<ToolProps>>;

/* ---------------- configured card ---------------- */

type ListItem = Extract<ToolCardBlock, { type: "list" }>["items"][number];
function Evidence({ block }: { block: ToolCardBlock }) {
  switch (block.type) {
    case "diff":
      return <HighlightedDiff text={block.text} />;
    case "terminal":
      return (
        <pre className="pp-log">
          <TerminalOutput text={block.text} />
        </pre>
      );
    case "code":
      return <pre className="pp-log">{block.text}</pre>;
    case "text":
      return block.format === "markdown" ? (
        <div className="prose">
          <Markdown text={block.text} />
        </div>
      ) : (
        <p>{block.text}</p>
      );
    default:
      return null;
  }
}
const evidenceLabel: Record<string, string> = {
  diff: "差分",
  terminal: "ターミナル",
  code: "コード",
  text: "メモ",
};
function StateIcon({ item }: { item: ListItem }) {
  return item.state === "completed" ? (
    <Check size={13} className="pp-ok-text" />
  ) : item.state === "active" ? (
    <Spinner size={13} />
  ) : item.state === "cancelled" ? (
    <X size={13} className="pp-faint" />
  ) : (
    <span className="pp-pending-dot" />
  );
}
function cardParts(tool: Tool) {
  const body = tool.card?.body ?? [];
  return {
    facts: body.flatMap((block) => (block.type === "facts" ? block.items : [])),
    items: body.flatMap((block) => (block.type === "list" ? block.items : [])),
    notes: body.filter((block) => block.type === "text"),
    evidence: body.filter((block) =>
      ["diff", "terminal", "code"].includes(block.type),
    ),
  };
}
function CardPhase({ tool, phase }: ToolProps) {
  return phase === "running" ? (
    <Spinner />
  ) : phase === "error" ? (
    <Failure tool={tool} />
  ) : null;
}

function CardReport({ tool, phase }: ToolProps) {
  const { facts, items, notes, evidence } = cardParts(tool);
  return (
    <div className="pp-report">
      <header>
        <strong>{tool.card?.title}</strong>
        <code>{tool.card?.target}</code>
        <CardPhase tool={tool} phase={phase} />
      </header>
      {phase === "done" && (
        <>
          <dl className="pp-stats">
            {facts.map((fact) => (
              <div key={fact.label}>
                <dt>{fact.label}</dt>
                <dd>{fact.value}</dd>
              </div>
            ))}
          </dl>
          {notes.map((block, i) => (
            <Evidence key={i} block={block} />
          ))}
          <ul className="pp-checklist">
            {items.map((item) => (
              <li key={item.title}>
                <StateIcon item={item} />
                <strong>{item.title}</strong>
                <span>{item.description}</span>
              </li>
            ))}
          </ul>
          {evidence.map((block, i) => (
            <section key={i}>
              <h4>{evidenceLabel[block.type]}</h4>
              <Evidence block={block} />
            </section>
          ))}
        </>
      )}
    </div>
  );
}

function CardSummary({ tool, phase }: ToolProps) {
  const { facts, items, notes, evidence } = cardParts(tool);
  const [open, setOpen] = useState<number>();
  const done = items.filter((item) => item.state === "completed").length;
  return (
    <div className="pp-card-summary">
      <header>
        <strong>{tool.card?.title}</strong>
        <code>{tool.card?.target}</code>
        {phase === "done" &&
          facts.map((fact) => (
            <span key={fact.label} className="pp-chip" title={fact.label}>
              {fact.value}
            </span>
          ))}
        <CardPhase tool={tool} phase={phase} />
      </header>
      {phase === "done" && (
        <>
          {notes.map((block, i) => (
            <Evidence key={i} block={block} />
          ))}
          <p className="pp-faint">
            項目 {done}/{items.length} 完了
            {items
              .filter((item) => item.state !== "completed")
              .map((item) => ` · 未完了: ${item.title}`)}
          </p>
          <div className="pp-chips">
            {evidence.map((block, i) => (
              <button
                key={i}
                type="button"
                className="pp-chip"
                aria-pressed={open === i}
                onClick={() => setOpen(open === i ? undefined : i)}
              >
                {evidenceLabel[block.type]}
              </button>
            ))}
          </div>
          {open !== undefined && <Evidence block={evidence[open]} />}
        </>
      )}
    </div>
  );
}

function CardProgress({ tool, phase }: ToolProps) {
  const { facts, items } = cardParts(tool);
  const done = items.filter((item) => item.state === "completed").length;
  return (
    <div className="pp-card-progress">
      <header>
        <strong>{tool.card?.title}</strong>
        <span>
          {done} / {items.length}
        </span>
        <CardPhase tool={tool} phase={phase} />
      </header>
      <div className="pp-progress" aria-hidden="true">
        <span style={{ width: `${(done / (items.length || 1)) * 100}%` }} />
      </div>
      {phase === "done" && (
        <>
          <ol>
            {items.map((item) => (
              <li key={item.title} className={`pp-state-${item.state}`}>
                <StateIcon item={item} />
                <span>
                  {item.title}
                  <small>{item.description}</small>
                </span>
              </li>
            ))}
          </ol>
          <small className="pp-pad">
            {facts.map((fact) => `${fact.label} ${fact.value}`).join(" · ")}
          </small>
        </>
      )}
    </div>
  );
}

export const cardProposals = {
  Report: {
    title: "レポート",
    fit: "レビューや監査のように、結論と根拠を一通り読ませたいカード。数値、所見、項目、証拠の順に並べる。",
    View: CardReport,
  },
  Summary: {
    title: "要点と証拠の切り替え",
    fit: "会話の中に何度も出るカード。数値と未完了の項目だけを常に見せ、差分やログは選んだものだけ開く。",
    View: CardSummary,
  },
  Progress: {
    title: "進捗",
    fit: "作業項目の消化状況を伝えるカード。リストを主役にし、数値は脚注に回す。",
    View: CardProgress,
  },
} satisfies Record<string, Proposal<ToolProps>>;

/* ---------------- explore group ---------------- */

const exploreVerb: Record<string, string> = {
  ls: "一覧",
  grep: "検索",
  read: "読む",
  find: "探す",
};
function stepTarget(step: Tool) {
  const args = toolArgs(step);
  if (step.call.name === "read") {
    const { start, end, total } = readRange(step);
    return (
      baseName(str(args.path)) +
      (end < total || start > 1 ? ` L${start}–${end}` : "")
    );
  }
  if (step.call.name === "ls") return `${str(args.path) || "."}/`;
  return str(args.pattern);
}
function stepIcon(step: Tool) {
  return step.call.name === "read" ? (
    <FileText size={12} />
  ) : step.call.name === "ls" ? (
    <Folder size={12} />
  ) : (
    <Search size={12} />
  );
}

export function ExploreTrail({ steps }: { steps: Tool[] }) {
  return (
    <ol className="pp-trail">
      {steps.map((step, i) => (
        <li key={i}>
          {i > 0 && <ChevronRight size={11} className="pp-faint" />}
          <span className="pp-chip" title={exploreVerb[step.call.name]}>
            {stepIcon(step)}
            <code>{stepTarget(step)}</code>
          </span>
        </li>
      ))}
    </ol>
  );
}

export function ExploreFiles({ steps }: { steps: Tool[] }) {
  const files = new Map<string, string[]>();
  const note = (path: string, text: string) =>
    files.set(path, [...(files.get(path) ?? []), text]);
  for (const step of steps) {
    const args = toolArgs(step);
    if (step.call.name === "read") {
      const { start, end, total } = readRange(step);
      note(
        str(args.path),
        end < total || start > 1 ? `L${start}–${end} を読んだ` : "全体を読んだ",
      );
    } else if (step.call.name === "grep")
      for (const file of grepFiles(step))
        note(file.path, `"${str(args.pattern)}" ${file.lines.length} 件`);
    else if (step.call.name === "find")
      for (const path of pathLines(step))
        note(path, `${str(args.pattern)} に一致`);
  }
  const order = [...files].sort((a, b) => b[1].length - a[1].length);
  return (
    <div className="pp-touched">
      <small>
        {steps.length} 回の探索で {files.size} ファイルに触れた
      </small>
      <ul>
        {order.map(([path, notes]) => (
          <li
            key={path}
            className={
              notes.some((n) => n.includes("読んだ")) ? "pp-read" : undefined
            }
          >
            <FileIcon path={path} size={13} />
            <code title={path}>{path}</code>
            <span>{notes.join(" · ")}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ExploreSentence({ steps }: { steps: Tool[] }) {
  const [open, setOpen] = useState(false);
  const count = (name: string) =>
    steps.filter((step) => step.call.name === name).length;
  const parts = [
    count("ls") && `${count("ls")} フォルダを一覧`,
    count("grep") && `${count("grep")} 回検索`,
    count("find") && `${count("find")} 回ファイルを探し`,
    count("read") && `${count("read")} ファイルを読んだ`,
  ].filter(Boolean);
  return (
    <div className="pp-sentence">
      <p>
        <Search size={13} />
        {parts.join("、")}
        <button
          type="button"
          className="pp-link"
          onClick={() => setOpen(!open)}
        >
          {open ? "隠す" : "内訳"}
        </button>
      </p>
      {open && (
        <ul className="pp-plain-steps">
          {steps.map((step, i) => (
            <li key={i}>
              {stepIcon(step)}
              <span>{exploreVerb[step.call.name]}</span>
              <code>{stepTarget(step)}</code>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export type ExploreProps = { steps: Tool[] };
export const exploreProposals = {
  Trail: {
    title: "足跡",
    fit: "探索の順序に意味がある場面。フォルダ → 検索 → 読む、とエージェントが辿った道筋を一列で示す。",
    View: ExploreTrail,
  },
  Files: {
    title: "触れたファイル",
    fit: "探索の結果どのファイルを把握したかが大事な場面。操作ではなくファイルを単位にまとめる。",
    View: ExploreFiles,
  },
  Sentence: {
    title: "一文の要約",
    fit: "探索がいつもの前段作業にすぎない場面。何をしたかを一文にし、内訳は必要な時だけ開く。",
    View: ExploreSentence,
  },
} satisfies Record<string, Proposal<ExploreProps>>;
export type { Phase };
