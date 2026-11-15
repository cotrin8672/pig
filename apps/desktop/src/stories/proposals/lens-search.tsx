// biome-ignore-all lint/suspicious/noArrayIndexKey: Parsed rows keep their order and may repeat.
import {
  ArrowRight,
  Check,
  Crosshair,
  Eye,
  FileText,
  Folder,
  Link2,
  Network,
  Replace,
  ScanSearch,
  Search,
  Terminal,
} from "lucide-react";
import type { CSSProperties } from "react";
import { CodeText } from "../../mainview/HighlightedCode";
import { languageFromPath } from "../../mainview/syntax-highlighting";
import type { Phase, Proposal, Tool, ToolProps } from "./kit";
import { Badge, CardHead, Path, Phased, Row, Spin } from "./lens-kit";
import {
  type AstMatch,
  args,
  baseName,
  body,
  details,
  dirName,
  groupBy,
  list,
  num,
  parseAstMatches,
  parseLocations,
  parseReplacements,
  parseSymbolSearch,
  str,
} from "./lens-model";

/* ---------------- symbol_search ---------------- */

function searchOf(tool: Tool) {
  const { hits, coverage } = parseSymbolSearch(body(tool));
  const top = Math.max(1, ...hits.map((hit) => hit.score ?? 0));
  return { query: str(args(tool).query), hits, coverage, top };
}

function SearchBoard(props: ToolProps) {
  const s = searchOf(props.tool);
  return (
    <Row
      {...props}
      icon={<Search size={14} />}
      verb="シンボル検索"
      target={s.query}
      meta={`${s.hits.length} 件`}
    >
      <div className="lx-table-wrap">
        <table className="lx-table">
          <thead>
            <tr>
              <th>#</th>
              <th>ファイル</th>
              <th className="lx-num">スコア</th>
              <th className="lx-num">一致</th>
              <th className="lx-num">被参照</th>
              <th className="lx-num">複雑度</th>
            </tr>
          </thead>
          <tbody>
            {s.hits.map((hit) => (
              <tr key={hit.rank}>
                <td className="lx-faint">{hit.rank}</td>
                <td>
                  <Path path={hit.file} line={hit.line} />
                </td>
                <td className="lx-num">{hit.score?.toFixed(2)}</td>
                <td className="lx-num">{hit.hits ?? "—"}</td>
                <td className="lx-num">{hit.fanIn ?? "—"}</td>
                <td className="lx-num">{hit.complexity ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Row>
  );
}

function SearchRings(props: ToolProps) {
  const s = searchOf(props.tool);
  return (
    <section className="lx-card" data-ui-surface="card">
      <CardHead
        icon={<Search size={14} />}
        title={`「${s.query}」`}
        sub={s.coverage && `${s.coverage} ファイルの索引から`}
        phase={props.phase}
        aside={<Badge>{s.hits.length} 件</Badge>}
      />
      <Phased {...props}>
        <ul className="lx-ring-grid">
          {s.hits.map((hit) => {
            const share = Math.round(((hit.score ?? 0) / s.top) * 100);
            return (
              <li key={hit.rank}>
                <span
                  className="lx-ring"
                  style={{ "--lx-share": `${share}%` } as CSSProperties}
                  role="img"
                  aria-label={`関連度 ${share}%`}
                >
                  <small>{share}</small>
                </span>
                <span>
                  <strong>{baseName(hit.file)}</strong>
                  <small>
                    {dirName(hit.file)} · L{hit.line}
                  </small>
                </span>
              </li>
            );
          })}
        </ul>
      </Phased>
    </section>
  );
}

function SearchStrength(props: ToolProps) {
  const s = searchOf(props.tool);
  return (
    <Row
      {...props}
      icon={<Search size={14} />}
      verb="シンボル検索"
      target={s.query}
      meta={`${s.hits.length} 件`}
    >
      <ul className="lx-list">
        {s.hits.map((hit) => {
          const level = Math.max(1, Math.round(((hit.score ?? 0) / s.top) * 5));
          return (
            <li key={hit.rank}>
              <span
                className="lx-pips"
                role="img"
                aria-label={`関連度 ${level}/5`}
              >
                {[1, 2, 3, 4, 5].map((pip) => (
                  <i key={pip} className={pip <= level ? "lx-on" : undefined} />
                ))}
              </span>
              <Path path={hit.file} line={hit.line} />
            </li>
          );
        })}
      </ul>
    </Row>
  );
}

function SearchFolders(props: ToolProps) {
  const s = searchOf(props.tool);
  return (
    <Row
      {...props}
      icon={<Search size={14} />}
      verb="シンボル検索"
      target={s.query}
      meta={`${s.hits.length} 件`}
    >
      <div className="lx-folders">
        {groupBy(s.hits, (hit) => dirName(hit.file)).map(([dir, hits]) => (
          <section key={dir}>
            <h4>
              <Folder size={12} />
              {dir}/
            </h4>
            {hits.map((hit) => (
              <p key={hit.rank}>
                <FileText size={12} />
                {baseName(hit.file)}
                <small>L{hit.line}</small>
                <span className="lx-rank-mark">#{hit.rank}</span>
              </p>
            ))}
          </section>
        ))}
      </div>
    </Row>
  );
}

function SearchFlow(props: ToolProps) {
  const s = searchOf(props.tool);
  return (
    <div className="lx-plain lx-flow-search">
      <span className="lx-query-bubble">
        <Search size={12} />
        {s.query}
      </span>
      <ArrowRight size={14} className="lx-faint" />
      <div>
        {props.phase === "running" ? (
          <Spin />
        ) : (
          <Phased {...props}>
            {s.hits.map((hit, i) => (
              <span
                key={hit.rank}
                className={`lx-chip${i === 0 ? " lx-chip-accent" : ""}`}
              >
                {baseName(hit.file)}
                <small>:{hit.line}</small>
              </span>
            ))}
          </Phased>
        )}
      </div>
    </div>
  );
}

export const symbolSearchProposals = {
  Board: {
    title: "順位表",
    fit: "スコア・一致数・被参照・複雑度を列で揃える。なぜその順位なのかを数字で比べられる。",
    View: SearchBoard,
  },
  Rings: {
    title: "関連度リング",
    fit: "1位を100とした関連度を円で示すカード。上位が抜けているか、僅差かが形でわかる。",
    View: SearchRings,
  },
  Strength: {
    title: "5段階の強さ",
    fit: "スコアを5つの点に丸めて行頭に置く。数字を読まずに確からしさだけを伝える。",
    View: SearchStrength,
  },
  Folders: {
    title: "フォルダ別",
    fit: "結果をディレクトリでまとめ、順位は小さな印で残す。探している機能がどの層にあるかを示す。",
    View: SearchFolders,
  },
  Flow: {
    title: "問い → 答え",
    fit: "クエリの吹き出しから結果のチップへ矢印でつなぐ、会話の流れに沿った最小表示。",
    View: SearchFlow,
  },
} satisfies Record<string, Proposal<ToolProps>>;

/* ---------------- ast_grep_search ---------------- */

function astOf(tool: Tool) {
  const a = args(tool);
  return {
    pattern: str(a.pattern) || str(a.rule) || str(a.nodeKind),
    lang: str(a.lang),
    paths: list(a.paths),
    matches: parseAstMatches(body(tool)),
  };
}
/** Metavariables ($X, $$$ARGS) are the parts of a pattern that capture. */
function PatternText({ pattern }: { pattern: string }) {
  return (
    <code className="lx-pattern">
      {pattern.split(/(\$\$?\$?[A-Z_][A-Z0-9_]*)/).map((part, i) =>
        part.startsWith("$") ? (
          <mark key={i} className="lx-metavar">
            {part}
          </mark>
        ) : (
          part
        ),
      )}
    </code>
  );
}
/** Compiler-style caret under the captured value. */
function Caret({ match }: { match: AstMatch }) {
  const value = match.captures[0]?.[1] ?? "";
  const at = value ? match.text.indexOf(value) : -1;
  return (
    <span className="lx-caret">
      {" ".repeat(Math.max(0, at))}
      {"^".repeat(Math.max(1, value.length))} ${match.captures[0]?.[0]}
    </span>
  );
}

function AstCompiler(props: ToolProps) {
  const s = astOf(props.tool);
  return (
    <Row
      {...props}
      icon={<ScanSearch size={14} />}
      verb="構文検索"
      target={s.pattern}
      meta={`${s.matches.length} 件`}
    >
      <pre className="lx-log lx-compiler">
        {s.matches.map((match, i) => (
          <span key={i}>
            <span className="lx-loc">
              {match.file}:{match.line}:{match.column}
            </span>
            {"\n  "}
            <CodeText
              text={match.text}
              language={languageFromPath(match.file)}
            />
            {"\n  "}
            <Caret match={match} />
            {"\n"}
          </span>
        ))}
      </pre>
    </Row>
  );
}

function AstAnatomy(props: ToolProps) {
  const s = astOf(props.tool);
  const names = [
    ...new Set(s.matches.flatMap((m) => m.captures.map(([n]) => n))),
  ];
  return (
    <section className="lx-card" data-ui-surface="card">
      <CardHead
        icon={<ScanSearch size={14} />}
        title={<PatternText pattern={s.pattern} />}
        sub={`${s.lang} · ${s.paths.join(", ") || "."}`}
        phase={props.phase}
        aside={<Badge>{s.matches.length} 件</Badge>}
      />
      <Phased {...props}>
        {names.map((name) => {
          const values = groupBy(
            s.matches.flatMap((m) => m.captures.filter(([n]) => n === name)),
            ([, value]) => value,
          );
          return (
            <div key={name} className="lx-anatomy">
              <span className="lx-metavar">${name}</span>
              <span className="lx-faint">に入った値</span>
              <div className="lx-chips">
                {values.map(([value, hits]) => (
                  <span key={value} className="lx-chip">
                    <code>{value}</code>
                    <strong>×{hits.length}</strong>
                  </span>
                ))}
              </div>
            </div>
          );
        })}
      </Phased>
    </section>
  );
}

function AstConsole(props: ToolProps) {
  const s = astOf(props.tool);
  return (
    <div className="lx-console" data-ui-surface="card">
      <p className="lx-console-command">
        <Terminal size={12} />
        <span className="lx-faint">sg</span> -p{" "}
        <PatternText pattern={`'${s.pattern}'`} /> -l {s.lang}{" "}
        {s.paths.join(" ")}
        <span className="lx-row-meta">
          {props.phase === "running" ? (
            <Spin />
          ) : (
            props.phase === "done" && `${s.matches.length} 件`
          )}
        </span>
      </p>
      <Phased {...props}>
        <pre className="lx-log">
          {groupBy(s.matches, (m) => m.file).map(([file, matches]) => (
            <span key={file}>
              <span className="lx-console-file">{file}</span>
              {"\n"}
              {matches.map((m, i) => (
                <span key={i}>
                  <span className="lx-faint">
                    {String(m.line).padStart(4)}│{" "}
                  </span>
                  <CodeText text={m.text} language={languageFromPath(file)} />
                  {"\n"}
                </span>
              ))}
            </span>
          ))}
        </pre>
      </Phased>
    </div>
  );
}

function AstTicks(props: ToolProps) {
  const s = astOf(props.tool);
  return (
    <Row
      {...props}
      icon={<ScanSearch size={14} />}
      verb="構文検索"
      target={s.pattern}
      meta={`${s.matches.length} 件`}
    >
      <ul className="lx-ticks">
        {groupBy(s.matches, (m) => m.file).map(([file, matches]) => {
          // Only match lines are known, so the track spans to just past the last one.
          const span = Math.max(...matches.map((m) => m.line)) * 1.25;
          return (
            <li key={file}>
              <Path path={file} />
              <span className="lx-track" aria-hidden="true">
                {matches.map((m, i) => (
                  <i
                    key={i}
                    style={{ left: `${(m.line / span) * 100}%` }}
                    title={`L${m.line}`}
                  />
                ))}
              </span>
              <small>{matches.length}</small>
            </li>
          );
        })}
      </ul>
    </Row>
  );
}

function AstHeadline(props: ToolProps) {
  const s = astOf(props.tool);
  const [first, ...rest] = s.matches;
  return (
    <Row
      {...props}
      icon={<ScanSearch size={14} />}
      verb="構文検索"
      target={s.pattern}
      meta={`${groupBy(s.matches, (m) => m.file).length} ファイル`}
    >
      {first && (
        <div className="lx-headline">
          <strong>{s.matches.length} 件一致</strong>
          <p>
            <Path path={first.file} line={first.line} />
            <code>
              <CodeText
                text={first.text}
                language={languageFromPath(first.file)}
              />
            </code>
          </p>
          <div className="lx-chips">
            {rest.map((m, i) => (
              <span key={i} className="lx-chip">
                {baseName(m.file)}
                <small>:{m.line}</small>
              </span>
            ))}
          </div>
        </div>
      )}
    </Row>
  );
}

export const astSearchProposals = {
  Compiler: {
    title: "コンパイラ風",
    fit: "場所・一致したコード・捕獲位置の ^^^ を3行で。メタ変数が式のどこに当たったかが正確にわかる。",
    View: AstCompiler,
  },
  Anatomy: {
    title: "パターンの解剖",
    fit: "パターンを見出しに、メタ変数ごとに入った値と回数を並べる。パターンが想定どおりの式を拾えたかを確かめる。",
    View: AstAnatomy,
  },
  Console: {
    title: "ターミナル風",
    fit: "実行したのと同じ sg コマンドと、ファイル別の結果をミニターミナルで。CLIに慣れた人に最も直感的。",
    View: AstConsole,
  },
  Ticks: {
    title: "ファイル内の位置",
    fit: "ファイルごとの帯に一致位置の目盛りを打つ。散らばりか、一か所に集中しているかが見える。",
    View: AstTicks,
  },
  Headline: {
    title: "見出し＋最初の一致",
    fit: "件数を見出しにし、最初の1件だけをコードで、残りはチップで。",
    View: AstHeadline,
  },
} satisfies Record<string, Proposal<ToolProps>>;

/* ---------------- ast_grep_replace ---------------- */

function replaceOf(tool: Tool) {
  const a = args(tool);
  const applied =
    typeof details(tool).applied === "boolean"
      ? Boolean(details(tool).applied)
      : a.apply === true;
  return {
    pattern: str(a.pattern),
    rewrite: str(a.rewrite),
    lang: str(a.lang),
    paths: list(a.paths),
    applied,
    ...parseReplacements(body(tool)),
  };
}

function ReplaceSideBySide(props: ToolProps) {
  const r = replaceOf(props.tool);
  const column = (title: string, key: "before" | "after", tone: string) => (
    <div className={`lx-side lx-side-${tone}`}>
      <small>{title}</small>
      <pre className="lx-log">
        {r.items.map((item, i) => (
          <span key={i}>
            <span className="lx-faint">
              {`${baseName(item.file)}:${item.line}`.padEnd(16)}
            </span>
            <CodeText text={item[key]} language={languageFromPath(item.file)} />
            {"\n"}
          </span>
        ))}
      </pre>
    </div>
  );
  return (
    <Row
      {...props}
      icon={<Replace size={14} />}
      verb={r.applied ? "置換" : "置換プレビュー"}
      target={`${r.pattern} → ${r.rewrite}`}
      meta={`${r.items.length} 件`}
    >
      <div className="lx-sides">
        {column("変更前", "before", "del")}
        {column("変更後", "after", "add")}
      </div>
    </Row>
  );
}

function ReplaceChecklist(props: ToolProps) {
  const r = replaceOf(props.tool);
  return (
    <Row
      {...props}
      icon={<Replace size={14} />}
      verb={r.applied ? "置換" : "置換プレビュー"}
      target={`${r.pattern} → ${r.rewrite}`}
      meta={r.applied ? "適用済み" : "未適用"}
    >
      <ul className="lx-todo">
        {r.items.map((item, i) => (
          <li key={i} className={r.applied ? "lx-done" : undefined}>
            <span className="lx-box" title={r.applied ? "適用済み" : "未適用"}>
              {r.applied && <Check size={10} />}
            </span>
            <Path path={item.file} line={item.line} />
          </li>
        ))}
      </ul>
    </Row>
  );
}

function ReplaceCodemod(props: ToolProps) {
  const r = replaceOf(props.tool);
  const files = groupBy(r.items, (item) => item.file).length;
  return (
    <section className="lx-card" data-ui-surface="card">
      <CardHead
        icon={<Replace size={14} />}
        title="コードモッド"
        sub={`${r.lang} · ${r.paths.join(", ")}`}
        phase={props.phase}
        aside={
          r.applied ? (
            <Badge tone="ok">適用済み</Badge>
          ) : (
            <Badge tone="warn">dry run</Badge>
          )
        }
      />
      <dl className="lx-facts">
        <div>
          <dt>探す</dt>
          <dd>
            <PatternText pattern={r.pattern} />
          </dd>
        </div>
        <div>
          <dt>置き換える</dt>
          <dd>
            <PatternText pattern={r.rewrite} />
          </dd>
        </div>
        {props.phase === "done" && (
          <div>
            <dt>影響</dt>
            <dd>
              {files} ファイル · {r.items.length} 箇所
            </dd>
          </div>
        )}
      </dl>
      {props.phase === "error" && <Phased {...props} />}
    </section>
  );
}

function Stepper({ applied, phase }: { applied: boolean; phase: Phase }) {
  const steps = ["一致を探す", "プレビュー", "適用"];
  const reached = phase === "running" ? 0 : applied ? 3 : 2;
  return (
    <ol className="lx-stepper">
      {steps.map((step, i) => (
        <li
          key={step}
          className={
            phase === "error" && i === 0
              ? "lx-step-error"
              : i < reached
                ? "lx-step-done"
                : i === reached
                  ? "lx-step-current"
                  : undefined
          }
        >
          <i>{i < reached ? <Check size={10} /> : i + 1}</i>
          {step}
        </li>
      ))}
    </ol>
  );
}
function ReplaceStepper(props: ToolProps) {
  const r = replaceOf(props.tool);
  return (
    <Row
      {...props}
      icon={<Replace size={14} />}
      verb="置換"
      target={`${r.pattern} → ${r.rewrite}`}
      meta={`${r.items.length} 件`}
    >
      <Stepper applied={r.applied} phase={props.phase} />
      {!r.applied && (
        <p className="lx-hint">
          <Eye size={12} />
          まだファイルは変更されていません。apply=true で {r.items.length}{" "}
          箇所を書き換えます。
        </p>
      )}
    </Row>
  );
}

function ReplaceFileTiles(props: ToolProps) {
  const r = replaceOf(props.tool);
  return (
    <Row
      {...props}
      icon={<Replace size={14} />}
      verb={r.applied ? "置換" : "置換プレビュー"}
      target={`${r.pattern} → ${r.rewrite}`}
      meta={`${r.items.length} 件`}
    >
      <ul className="lx-file-tiles">
        {groupBy(r.items, (item) => item.file).map(([file, items]) => (
          <li key={file}>
            <strong>{items.length}</strong>
            <span>
              {baseName(file)}
              <small>{items.map((item) => `L${item.line}`).join(" · ")}</small>
            </span>
          </li>
        ))}
      </ul>
    </Row>
  );
}

export const astReplaceProposals = {
  SideBySide: {
    title: "前後の2列",
    fit: "変更前と変更後のコードを左右に並べる。同じ規則が全箇所で同じ形になるかを縦に見比べる。",
    View: ReplaceSideBySide,
  },
  Checklist: {
    title: "チェックリスト",
    fit: "書き換え対象を1件ずつ項目に。プレビューでは空欄、適用後はチェックが入る。",
    View: ReplaceChecklist,
  },
  Codemod: {
    title: "コードモッドのカード",
    fit: "探す／置き換える／影響範囲を定義として示す。規則の正しさをレビューする場面に。",
    View: ReplaceCodemod,
  },
  Stepper: {
    title: "段階の表示",
    fit: "探す → プレビュー → 適用 のどこまで進んだかを示す。dry run を適用済みと誤解させない。",
    View: ReplaceStepper,
  },
  FileTiles: {
    title: "ファイル別の件数",
    fit: "ファイルごとに大きな件数と行番号を置く。影響の広がりを先に見せる。",
    View: ReplaceFileTiles,
  },
} satisfies Record<string, Proposal<ToolProps>>;

/* ---------------- lsp_navigation ---------------- */

const operations = [
  ["definition", "定義"],
  ["references", "参照"],
  ["implementation", "実装"],
  ["hover", "ホバー"],
  ["incomingCalls", "呼び出し元"],
] as const;
const operationLabel = Object.fromEntries(operations) as Record<string, string>;
function lspOf(tool: Tool) {
  const a = args(tool);
  const operation = str(details(tool).operation) || str(a.operation);
  return {
    operation,
    label: operationLabel[operation] ?? operation,
    path: str(a.path) || str(a.file) || str(a.filePath),
    line: num(a.line),
    symbol: str(a.symbol) || str(a.query),
    locations: parseLocations(body(tool)),
    servers: list(details(tool).servers),
  };
}

function LspHierarchy(props: ToolProps) {
  const l = lspOf(props.tool);
  const files = groupBy(l.locations, (location) => location.file);
  return (
    <Row
      {...props}
      icon={<Link2 size={14} />}
      verb={l.label}
      target={l.symbol}
      meta={`${l.locations.length} 件`}
    >
      <div className="lx-hierarchy">
        <p className="lx-hierarchy-root">
          <Crosshair size={12} />
          <code>{l.symbol}</code>
          <small>
            {baseName(l.path)}:{l.line}
          </small>
        </p>
        <ul>
          {files.map(([file, locations]) => (
            <li key={file}>
              <Path path={file} />
              <small>
                {locations.map((location) => location.line).join(", ")}
              </small>
            </li>
          ))}
        </ul>
      </div>
    </Row>
  );
}

function LspSegments(props: ToolProps) {
  const l = lspOf(props.tool);
  return (
    <div className="lx-plain">
      <div className="lx-segmented">
        {operations.map(([key, label]) => (
          <span
            key={key}
            className={
              key === l.operation ? "lx-segment lx-current" : "lx-segment"
            }
          >
            {label}
          </span>
        ))}
        <code>{l.symbol}</code>
        <span className="lx-row-meta">
          {props.phase === "running" ? (
            <Spin />
          ) : (
            props.phase === "done" && `${l.locations.length} 件`
          )}
        </span>
      </div>
      <div className="lx-indent">
        <Phased {...props}>
          <ul className="lx-list">
            {l.locations.map((location, i) => (
              <li key={i}>
                <Path path={location.file} line={location.line} />
              </li>
            ))}
          </ul>
        </Phased>
      </div>
    </div>
  );
}

function LspTable(props: ToolProps) {
  const l = lspOf(props.tool);
  return (
    <Row
      {...props}
      icon={<Link2 size={14} />}
      verb={l.label}
      target={`${l.symbol} · ${l.path}:${l.line}`}
      meta={l.servers.join(", ")}
    >
      <div className="lx-table-wrap">
        <table className="lx-table">
          <thead>
            <tr>
              <th>ファイル</th>
              <th className="lx-num">行</th>
              <th className="lx-num">列</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {l.locations.map((location, i) => (
              <tr key={i}>
                <td>
                  <Path path={location.file} />
                </td>
                <td className="lx-num">{location.line}</td>
                <td className="lx-num">{location.column}</td>
                <td>
                  {location.file === l.path && location.line === l.line && (
                    <Badge tone="accent">起点</Badge>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Row>
  );
}

function LspRibbon(props: ToolProps) {
  const l = lspOf(props.tool);
  const files = groupBy(l.locations, (location) => location.file);
  return (
    <Row
      {...props}
      icon={<Network size={14} />}
      verb={l.label}
      target={l.symbol}
      meta={`${files.length} ファイル`}
    >
      <div className="lx-ribbon" aria-hidden="true">
        {files.map(([file, locations], i) => (
          <i
            key={file}
            className={`lx-ribbon-${i % 4}`}
            style={{ flexGrow: locations.length }}
          />
        ))}
      </div>
      <ul className="lx-legend">
        {files.map(([file, locations], i) => (
          <li key={file}>
            <i className={`lx-ribbon-${i % 4}`} />
            {baseName(file)} <small>{locations.length}</small>
          </li>
        ))}
      </ul>
    </Row>
  );
}

function LspHero(props: ToolProps) {
  const l = lspOf(props.tool);
  const files = groupBy(l.locations, (location) => location.file);
  return (
    <section className="lx-card lx-hero" data-ui-surface="card">
      <div>
        <strong>{props.phase === "done" ? l.locations.length : "–"}</strong>
        <small>{l.label}</small>
      </div>
      <div>
        <p>
          <code>{l.symbol}</code>
          {props.phase === "running" && <Spin />}
        </p>
        <Phased {...props}>
          <small>
            {files
              .map(([file, items]) => `${baseName(file)} ${items.length}`)
              .join(" · ")}
          </small>
        </Phased>
      </div>
    </section>
  );
}

export const lspNavigationProposals = {
  Hierarchy: {
    title: "シンボルを根にした木",
    fit: "問い合わせたシンボルを根に、ファイルと行を枝に。呼び出し階層と同じ読み方ができる。",
    View: LspHierarchy,
  },
  Segments: {
    title: "操作の切り替え表示",
    fit: "定義・参照・実装…のうちどの操作をしたかをセグメントで示す。操作の種類が何より先に伝わる。",
    View: LspSegments,
  },
  Table: {
    title: "位置の表",
    fit: "ファイル・行・列を揃え、起点の行に印。言語サーバー名は見出しの右に。",
    View: LspTable,
  },
  Ribbon: {
    title: "ファイル比率の帯",
    fit: "結果をファイルごとの色帯に。参照がどこに偏っているかを1本で示す。",
    View: LspRibbon,
  },
  Hero: {
    title: "件数を主役に",
    fit: "参照の数を大きく見せ、内訳は1行で。影響範囲の大きさを最初に伝える。",
    View: LspHero,
  },
} satisfies Record<string, Proposal<ToolProps>>;
