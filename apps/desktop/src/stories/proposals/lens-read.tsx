// biome-ignore-all lint/suspicious/noArrayIndexKey: Parsed rows keep their order and may repeat.
import {
  ArrowLeft,
  Braces,
  FileText,
  Info,
  ListTree,
  Scan,
  ShieldCheck,
  TriangleAlert,
} from "lucide-react";
import { useState } from "react";
import { CodeText } from "../../mainview/HighlightedCode";
import { languageFromPath } from "../../mainview/syntax-highlighting";
import type { Proposal, Tool, ToolProps } from "./kit";
import {
  Badge,
  CardHead,
  Code,
  KindIcon,
  kindLabel,
  Path,
  Phased,
  Row,
} from "./lens-kit";
import {
  args,
  baseName,
  body,
  details,
  dirName,
  groupBy,
  type ModuleSymbol,
  num,
  parseModuleSymbol,
  parseOutline,
  parseSections,
  parseSymbolRead,
  range,
  str,
} from "./lens-model";

/* ---------------- read_symbol / read_enclosing ---------------- */

function symbolOf(tool: Tool) {
  const head = parseSymbolRead(body(tool));
  const path = str(args(tool).path);
  const start = num(details(tool).startLine) ?? head?.start ?? 1;
  const end = num(details(tool).endLine) ?? head?.end ?? start;
  const enclosing = tool.call.name === "read_enclosing";
  const line = num(args(tool).line);
  const code = head?.code ?? "";
  return {
    path,
    name: head?.name || str(args(tool).symbol),
    kind: head?.kind ?? (str(details(tool).kind) || "symbol"),
    code,
    lines: code ? code.split("\n") : [],
    start,
    end,
    enclosing,
    // read_enclosing starts from a line; read_symbol from the name, whose first line is the signature.
    focus: enclosing ? line : start,
    target: enclosing
      ? `${path}:${line ?? "?"}`
      : `${path} · ${str(args(tool).symbol)}`,
  };
}
type SymbolRead = ReturnType<typeof symbolOf>;
const symbolVerb = (s: SymbolRead) =>
  s.enclosing ? "囲むシンボル" : "シンボル";

function SymbolTab(props: ToolProps) {
  const s = symbolOf(props.tool);
  return (
    <div className="lx-tabbed" data-ui-surface="card">
      <div className="lx-tabbar">
        <span className="lx-tab">
          <FileText size={12} />
          {baseName(s.path)}
        </span>
        <span className="lx-tab-crumb">
          <KindIcon kind={s.kind} size={12} />
          {s.name || "…"}
        </span>
        <span className="lx-row-meta">
          {props.phase === "done" && <small>{range(s.start, s.end)}</small>}
        </span>
      </div>
      <Phased {...props}>
        <Code
          text={s.code}
          path={s.path}
          start={s.start}
          mark={s.focus}
          className="lx-flush"
        />
      </Phased>
    </div>
  );
}

function SymbolFocus(props: ToolProps) {
  const s = symbolOf(props.tool);
  return (
    <Row
      {...props}
      icon={<Scan size={14} />}
      verb={symbolVerb(s)}
      target={s.target}
      meta={range(s.start, s.end)}
    >
      <pre className="lx-code lx-focus">
        {s.lines.map((text, i) => (
          <span
            key={i}
            className={s.start + i === s.focus ? "lx-focus-line" : undefined}
          >
            <span className="lx-gutter-cell">{s.start + i}</span>
            <CodeText text={text} language={languageFromPath(s.path)} />
            {"\n"}
          </span>
        ))}
      </pre>
    </Row>
  );
}

function SymbolDoc(props: ToolProps) {
  const s = symbolOf(props.tool);
  const [open, setOpen] = useState(false);
  return (
    <section className="lx-card" data-ui-surface="card">
      <pre className="lx-doc-sig">
        <CodeText
          text={(s.lines[0] ?? s.name).replace(/\s*\{\s*$/, "")}
          language={languageFromPath(s.path)}
        />
      </pre>
      <Phased {...props}>
        <dl className="lx-facts">
          <div>
            <dt>種類</dt>
            <dd>{kindLabel[s.kind] ?? s.kind}</dd>
          </div>
          <div>
            <dt>場所</dt>
            <dd>
              <Path path={s.path} line={s.start} />
            </dd>
          </div>
          <div>
            <dt>大きさ</dt>
            <dd>{s.end - s.start + 1} 行</dd>
          </div>
          {s.enclosing && (
            <div>
              <dt>起点</dt>
              <dd>L{s.focus}</dd>
            </div>
          )}
        </dl>
        <button
          type="button"
          className="lx-link"
          onClick={() => setOpen(!open)}
        >
          {open ? "本文を閉じる" : "本文を見る"}
        </button>
        {open && (
          <Code text={s.code} path={s.path} start={s.start} mark={s.focus} />
        )}
      </Phased>
    </section>
  );
}

function SymbolBracket(props: ToolProps) {
  const s = symbolOf(props.tool);
  return (
    <Row
      {...props}
      icon={<Braces size={14} />}
      verb={symbolVerb(s)}
      target={s.target}
      meta={`${s.end - s.start + 1} 行`}
    >
      <div className="lx-bracket">
        <div className="lx-bracket-rail" aria-hidden="true">
          <small>{s.start}</small>
          <i />
          <small>{s.end}</small>
        </div>
        <Code text={s.code} path={s.path} start={s.start} mark={s.focus} />
      </div>
    </Row>
  );
}

function SymbolFold(props: ToolProps) {
  const s = symbolOf(props.tool);
  const [open, setOpen] = useState(false);
  const inner = s.lines.slice(1, -1);
  const folded = !open && inner.length > 1;
  return (
    <Row
      {...props}
      icon={<Braces size={14} />}
      verb={symbolVerb(s)}
      target={s.target}
      meta={range(s.start, s.end)}
    >
      {folded ? (
        <pre className="lx-code lx-fold">
          <span>
            <span className="lx-gutter-cell">{s.start}</span>
            <CodeText text={s.lines[0]} language={languageFromPath(s.path)} />
          </span>
          <button type="button" onClick={() => setOpen(true)}>
            <span className="lx-gutter-cell" />⋯ {inner.length} 行
          </button>
          <span>
            <span className="lx-gutter-cell">{s.end}</span>
            <CodeText
              text={s.lines.at(-1) ?? ""}
              language={languageFromPath(s.path)}
            />
          </span>
        </pre>
      ) : (
        <Code text={s.code} path={s.path} start={s.start} mark={s.focus} />
      )}
    </Row>
  );
}

const symbolProposals = {
  Tab: {
    title: "エディタのタブ",
    fit: "ファイルのタブとシンボル名の見出しを持つ小さなエディタ。どのファイルの何を読んだかを本文の上で示す。",
    View: SymbolTab,
  },
  Focus: {
    title: "注目行の強調",
    fit: "起点の行（read_symbolは宣言行）だけを明るくし、残りを控えめにする。どこを見ているかがすぐわかる。",
    View: SymbolFocus,
  },
  Doc: {
    title: "ドキュメント風",
    fit: "シグネチャを主役に、種類・場所・大きさを項目で。本文は必要なときだけ開く。",
    View: SymbolDoc,
  },
  Bracket: {
    title: "行範囲の括弧",
    fit: "左の括弧で開始行と終了行を結び、シンボルの大きさを視覚化する。",
    View: SymbolBracket,
  },
  Fold: {
    title: "折りたたみ本文",
    fit: "最初と最後の行だけを見せ、中身は「⋯ n 行」で畳む。長い関数でも会話を押し下げない。",
    View: SymbolFold,
  },
} satisfies Record<string, Proposal<ToolProps>>;
export const readSymbolProposals = symbolProposals;
export const readEnclosingProposals = symbolProposals;

/* ---------------- ast_grep_outline ---------------- */

function outlineOf(tool: Tool) {
  const parsed = parseOutline(body(tool));
  const file =
    parsed.file || (args(tool).paths as string[] | undefined)?.join(", ") || "";
  return { file, items: parsed.items };
}

function OutlineFolded(props: ToolProps) {
  const { file, items } = outlineOf(props.tool);
  return (
    <Row
      {...props}
      icon={<ListTree size={14} />}
      verb="アウトライン"
      target={file}
      meta={`${items.length} 項目`}
    >
      <pre className="lx-code lx-fold">
        {items.map((item, i) => (
          <span key={i}>
            <span className="lx-gutter-cell">{item.start}</span>
            <CodeText
              text={item.signature.replace(/\s*[{=]\s*$/, "")}
              language={languageFromPath(file)}
            />
            {item.end > item.start && (
              <span className="lx-fold-mark">{` { ⋯ ${item.end - item.start + 1} 行 }`}</span>
            )}
            {"\n"}
          </span>
        ))}
      </pre>
    </Row>
  );
}

function OutlineTiles(props: ToolProps) {
  const { file, items } = outlineOf(props.tool);
  return (
    <section className="lx-card" data-ui-surface="card">
      <CardHead
        icon={<ListTree size={14} />}
        title={baseName(file)}
        sub={dirName(file)}
        phase={props.phase}
        aside={<Badge>{items.length} 項目</Badge>}
      />
      <Phased {...props}>
        <ul className="lx-tiles">
          {items.map((item, i) => (
            <li key={i} className={`lx-tile-${item.kind}`}>
              <KindIcon kind={item.kind} />
              <strong>{item.name}</strong>
              <small>
                {kindLabel[item.kind] ?? item.kind} ·{" "}
                {range(item.start, item.end)}
              </small>
              {item.exported && <span className="lx-tile-flag">export</span>}
            </li>
          ))}
        </ul>
      </Phased>
    </section>
  );
}

function OutlineSizes(props: ToolProps) {
  const { file, items } = outlineOf(props.tool);
  const max = Math.max(1, ...items.map((item) => item.end - item.start + 1));
  return (
    <Row
      {...props}
      icon={<ListTree size={14} />}
      verb="アウトライン"
      target={file}
      meta="大きさ順"
    >
      <ul className="lx-sizes lx-frame">
        {[...items]
          .sort((a, b) => b.end - b.start - (a.end - a.start))
          .map((item, i) => {
            const size = item.end - item.start + 1;
            return (
              <li key={i}>
                <span>
                  <KindIcon kind={item.kind} size={12} />
                  {item.name}
                </span>
                <span className="lx-size-bar" aria-hidden="true">
                  <i style={{ width: `${(size / max) * 100}%` }} />
                </span>
                <small>{size} 行</small>
              </li>
            );
          })}
      </ul>
    </Row>
  );
}

function OutlineSentence(props: ToolProps) {
  const { file, items } = outlineOf(props.tool);
  const counts = groupBy(
    items.filter((item) => item.kind !== "import"),
    (item) => kindLabel[item.kind] ?? item.kind,
  );
  return (
    <div className="lx-plain">
      <p className="lx-sentence">
        <ListTree size={13} />
        <Path path={file} />
        {props.phase === "done" ? (
          <>
            {counts.map(([label, group]) => (
              <span key={label} className="lx-count">
                {label} <strong>{group.length}</strong>
              </span>
            ))}
            <span className="lx-faint">
              （うち公開 {items.filter((item) => item.exported).length}）
            </span>
          </>
        ) : (
          <span className="lx-faint">の構造を読んでいます</span>
        )}
      </p>
      {props.phase === "error" && <Phased {...props} />}
    </div>
  );
}

function OutlineTable(props: ToolProps) {
  const { file, items } = outlineOf(props.tool);
  return (
    <Row
      {...props}
      icon={<ListTree size={14} />}
      verb="アウトライン"
      target={file}
      meta={`${items.length} 項目`}
    >
      <div className="lx-table-wrap">
        <table className="lx-table">
          <thead>
            <tr>
              <th>名前</th>
              <th>種類</th>
              <th>行</th>
              <th>公開</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item, i) => (
              <tr key={i}>
                <td>
                  <span className="lx-cell">
                    <KindIcon kind={item.kind} size={12} />
                    {item.name}
                  </span>
                </td>
                <td className="lx-faint">
                  {kindLabel[item.kind] ?? item.kind}
                </td>
                <td className="lx-num">{range(item.start, item.end)}</td>
                <td>
                  {item.exported ? (
                    <ShieldCheck size={12} className="lx-accent-text" />
                  ) : (
                    ""
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

export const outlineProposals = {
  Folded: {
    title: "折りたたんだコード",
    fit: "エディタで全部畳んだ状態と同じ見た目。宣言行がそのままコードとして読め、中身の行数が括弧に入る。",
    View: OutlineFolded,
  },
  Tiles: {
    title: "シンボルのタイル",
    fit: "1シンボル1枚のタイルを敷き詰める。種類ごとの色で、関数が多いか型が多いかが面で見える。",
    View: OutlineTiles,
  },
  Sizes: {
    title: "大きさの順位",
    fit: "行数の多い順に棒で並べる。分割すべき大きな関数やクラスがすぐ見つかる。",
    View: OutlineSizes,
  },
  Sentence: {
    title: "数の要約",
    fit: "関数 3・型 1・クラス 1 のように数えるだけ。探索の途中で何度も出るときの最小表示。",
    View: OutlineSentence,
  },
  Table: {
    title: "表",
    fit: "名前・種類・行・公開を列で揃える。並びを正確に比べたいとき。",
    View: OutlineTable,
  },
} satisfies Record<string, Proposal<ToolProps>>;

/* ---------------- module_report ---------------- */

function moduleOf(tool: Tool) {
  const { head, sections } = parseSections(body(tool));
  const symbols = (name: string) =>
    (sections.get(name) ?? [])
      .map(parseModuleSymbol)
      .filter((item): item is ModuleSymbol => Boolean(item));
  const imports = (sections.get("IMPORTS") ?? []).flatMap((row) => {
    const [scope, rest = ""] = row.split(":");
    return rest.trim() === "(none)"
      ? []
      : rest
          .split(",")
          .map((name) => ({ scope: scope.trim(), name: name.trim() }))
          .filter((item) => item.name);
  });
  const usedBy = new Map(
    (sections.get("USED BY") ?? []).map((row) => {
      const [name, refs = ""] = row.split("←").map((part) => part.trim());
      return [name, refs ? refs.split(/,\s*/) : []] as const;
    }),
  );
  return {
    path: str(args(tool).path),
    api: symbols("API"),
    internal: symbols("INTERNAL"),
    imports,
    usedBy,
    lines: /(\d+)L/.exec(head)?.[1],
    fresh: /\[(\w+)\]/.exec(head)?.[1],
    provenance: (sections.get("PROVENANCE") ?? []).join(" "),
  };
}

function ModuleSpec(props: ToolProps) {
  const m = moduleOf(props.tool);
  const callers = new Set(
    [...m.usedBy.values()].flat().map((ref) => ref.split(":")[0]),
  );
  const rows: [string, string][] = [
    ["行数", `${m.lines ?? "—"} 行`],
    ["シンボル", `公開 ${m.api.length} · 内部 ${m.internal.length}`],
    ["依存先", m.imports.map((item) => item.name).join(", ") || "なし"],
    ["利用元", `${callers.size} ファイル`],
    ["情報源", m.provenance.replace(/graphBuiltAt=\S+/, "").trim()],
  ];
  return (
    <Row
      {...props}
      icon={<FileText size={14} />}
      verb="モジュール"
      target={m.path}
      meta={m.fresh}
    >
      <dl className="lx-facts lx-facts-wide">
        {rows.map(([key, value]) => (
          <div key={key}>
            <dt>{key}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
    </Row>
  );
}

function ModuleBands(props: ToolProps) {
  const m = moduleOf(props.tool);
  const callers = [
    ...new Set([...m.usedBy.values()].flat().map((ref) => ref.split(":")[0])),
  ];
  const band = (label: string, items: string[], tone: string) => (
    <div className="lx-band">
      <small>{label}</small>
      <div className="lx-chips">
        {items.map((item) => (
          <span key={item} className={`lx-chip lx-chip-${tone}`}>
            {item}
          </span>
        ))}
      </div>
    </div>
  );
  return (
    <section className="lx-card" data-ui-surface="card">
      <CardHead
        icon={<FileText size={14} />}
        title={baseName(m.path)}
        sub={dirName(m.path)}
        phase={props.phase}
        aside={m.lines && <Badge>{m.lines} 行</Badge>}
      />
      <Phased {...props}>
        {band(
          "読み込む",
          m.imports.map((item) => item.name),
          "muted",
        )}
        {band(
          "公開する",
          m.api.map((item) => item.name),
          "accent",
        )}
        {band("使われる", callers.map(baseName), "info")}
      </Phased>
    </section>
  );
}

function ModuleHealth(props: ToolProps) {
  const m = moduleOf(props.tool);
  const unused = m.api.filter((item) => !m.usedBy.get(item.name)?.length);
  return (
    <Row
      {...props}
      icon={<FileText size={14} />}
      verb="モジュール点検"
      target={m.path}
      meta={unused.length ? `未使用 ${unused.length}` : "問題なし"}
    >
      <ul className="lx-checks">
        <li>
          <ShieldCheck size={13} className="lx-ok-text" />
          グラフは最新（{m.fresh}）
        </li>
        <li>
          <Info size={13} className="lx-info-text" />
          公開 {m.api.length} 件のうち {m.api.length - unused.length}{" "}
          件が他から使われています
        </li>
        {unused.length > 0 && (
          <li>
            <TriangleAlert size={13} className="lx-warn-text" />
            <span>
              使われていない公開シンボル:{" "}
              {unused.map((item) => (
                <code key={item.name}>{item.name}</code>
              ))}
            </span>
          </li>
        )}
      </ul>
    </Row>
  );
}

function ModuleCallers(props: ToolProps) {
  const m = moduleOf(props.tool);
  const [open, setOpen] = useState<string>();
  return (
    <Row
      {...props}
      icon={<FileText size={14} />}
      verb="公開API"
      target={m.path}
      meta={`${m.api.length} export`}
    >
      <ul className="lx-callers lx-frame">
        {m.api.map((item) => {
          const refs = m.usedBy.get(item.name) ?? [];
          return (
            <li key={item.name}>
              <button
                type="button"
                disabled={!refs.length}
                aria-expanded={open === item.name}
                onClick={() =>
                  setOpen(open === item.name ? undefined : item.name)
                }
              >
                <KindIcon kind={item.kind} size={12} />
                <code>{item.signature}</code>
                <span className={refs.length ? "lx-callers-count" : "lx-faint"}>
                  <ArrowLeft size={11} />
                  {refs.length}
                </span>
              </button>
              {open === item.name && (
                <div className="lx-chips lx-callers-refs">
                  {refs.map((ref) => (
                    <span key={ref} className="lx-chip">
                      {ref}
                    </span>
                  ))}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </Row>
  );
}

function ModuleSentence(props: ToolProps) {
  const m = moduleOf(props.tool);
  const top = [...m.usedBy].sort((a, b) => b[1].length - a[1].length)[0];
  return (
    <div className="lx-plain">
      <p className="lx-sentence">
        <FileText size={13} />
        <Path path={m.path} />
        {props.phase === "done" ? (
          <span>
            は {m.lines} 行で {m.api.length} 個を公開。
            {top && (
              <>
                最も使われているのは <code>{top[0]}</code>（{top[1].length}{" "}
                箇所）
              </>
            )}
          </span>
        ) : (
          <span className="lx-faint">を調べています</span>
        )}
      </p>
      {props.phase === "error" && <Phased {...props} />}
    </div>
  );
}

export const moduleReportProposals = {
  Spec: {
    title: "仕様書",
    fit: "行数・シンボル・依存先・利用元・情報源を項目で並べる。報告書をそのまま読める形にする。",
    View: ModuleSpec,
  },
  Bands: {
    title: "3つの帯",
    fit: "読み込む → 公開する → 使われる を色違いのチップ列で。モジュールの境界を一目で示す。",
    View: ModuleBands,
  },
  Health: {
    title: "点検結果",
    fit: "最新か、公開APIが使われているかを確認項目で。使われていない export を警告する。",
    View: ModuleHealth,
  },
  Callers: {
    title: "利用元の展開",
    fit: "公開シグネチャごとに利用数を出し、開くと呼び出し元が並ぶ。変更の影響を一つずつ確かめる。",
    View: ModuleCallers,
  },
  Sentence: {
    title: "1文の要約",
    fit: "大きさと最もよく使われるAPIだけを文で。探索の途中経過に。",
    View: ModuleSentence,
  },
} satisfies Record<string, Proposal<ToolProps>>;
