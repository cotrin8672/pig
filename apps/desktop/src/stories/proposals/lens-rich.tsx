// biome-ignore-all lint/suspicious/noArrayIndexKey: Parsed rows keep their order and may repeat.
import { Aperture, ArrowRight } from "lucide-react";
import { type CSSProperties, type ReactNode, useState } from "react";
import { CodeText } from "../../mainview/HighlightedCode";
import { DisclosureScope } from "../../mainview/LazyDetails";
import { languageFromPath } from "../../mainview/syntax-highlighting";
import { ToolRow } from "../../mainview/ToolBlock";
import type { Proposal, ToolProps } from "./kit";
import { Glyph } from "./lens-family";
import {
  type Body,
  crumb,
  type Item,
  kindName,
  type LensView,
  lensView,
  type Tone,
} from "./lens-family-model";
import { Code, Path, Phased } from "./lens-kit";
import { baseName } from "./lens-model";
import "./lens-family.css";
import "./lens-rich.css";

/*
 * Rich families: the same pi-lens view model drawn as pictures instead of rows.
 * Each family owns one visual primitive (map, graph, gauge, split, treemap)
 * and applies it to every body type, so all 13 tools speak one visual language.
 */

type Mark = Item & {
  line?: number;
  end?: number;
  weight: number;
  color: string;
};
type Groups = { title: string; isFile?: boolean; items: Mark[] }[];

const toneColor: Record<Tone, string> = {
  error: "var(--ds-error)",
  warn: "var(--ds-warning)",
  info: "var(--ds-info)",
  ok: "var(--ds-success)",
  neutral: "var(--ds-text-faint)",
};
const kindColor: Record<string, string> = {
  function: "var(--ds-syntax-function)",
  method: "var(--ds-syntax-function)",
  class: "var(--ds-syntax-type)",
  struct: "var(--ds-syntax-keyword)",
  type: "var(--ds-syntax-keyword)",
  interface: "var(--ds-syntax-keyword)",
  constant: "var(--ds-syntax-constant)",
  variable: "var(--ds-syntax-constant)",
  import: "var(--ds-text-faint)",
};
const glyphColor: Record<string, string> = {
  on: "var(--ds-success)",
  off: "var(--ds-text-faint)",
  added: "var(--ds-info)",
  cycle: "var(--ds-warning)",
  error: "var(--ds-error)",
  warning: "var(--ds-warning)",
  info: "var(--ds-info)",
  hint: "var(--ds-text-faint)",
};
const severityWeight: Record<string, number> = {
  error: 3,
  warning: 2,
  info: 1,
  hint: 1,
};
const vars = (values: Record<string, string | number>) =>
  values as CSSProperties;

/** Lines and a size for every item: ranges, severities, scores or counts. */
function measure(item: Item): Mark {
  const at = /^L?(\d+)(?:–(\d+))?(?::\d+)?$/.exec(item.loc ?? "");
  const line = at ? Number(at[1]) : undefined;
  const end = at?.[2] ? Number(at[2]) : line;
  const places = /^(\d+)箇所$/.exec(item.loc ?? "")?.[1];
  const number = /(\d+(?:\.\d+)?)/.exec(item.sub ?? "")?.[1];
  const weight =
    severityWeight[item.glyph] ??
    (at?.[2] && line !== undefined && end !== undefined
      ? end - line + 1
      : Number(places ?? number ?? 1));
  return {
    ...item,
    line,
    end,
    weight: Math.max(weight, 0.5),
    color: item.tone
      ? toneColor[item.tone]
      : (kindColor[item.glyph] ?? glyphColor[item.glyph] ?? "var(--ds-accent)"),
  };
}
const groupsOf = (body: Body): Groups =>
  body.type === "list"
    ? body.groups.map((g) => ({ ...g, items: g.items.map(measure) }))
    : [];
/** "エラー 2" → value 2, label エラー; chips without a number keep their text. */
const statsOf = (view: LensView) =>
  view.verdict.map((v) => {
    const found = /^(.*?)\s*([\d.?/%]+)$/.exec(v.text);
    return found?.[1]
      ? { label: found[1], value: found[2], tone: v.tone }
      : { label: "", value: v.text, tone: v.tone };
  });
const symbolMark = (view: LensView, start: number, end: number): Mark => ({
  glyph: view.kind ?? "function",
  text: view.subject ?? "",
  line: start,
  end,
  weight: end - start + 1,
  color: kindColor[view.kind ?? ""] ?? "var(--ds-accent)",
});
const codeEnd = (b: Extract<Body, { type: "code" }>) =>
  b.start + b.code.split("\n").length - 1;
const factLine = (b: Extract<Body, { type: "facts" }>) =>
  Number(/:(\d+)$/.exec(b.rows[0]?.value ?? "")?.[1] ?? 1);
const label = (m: Mark) => `${m.text}${m.loc ? ` ${m.loc}` : ""}`;

function Facts({ rows }: { rows: { label: string; value: string }[] }) {
  return (
    <dl className="lf-facts">
      {rows.map((row) => (
        <div key={row.label}>
          <dt>{row.label}</dt>
          <dd>{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/* ------------------------------ 1. minimap ------------------------------ */

function Strip({ marks, length }: { marks: Mark[]; length: number }) {
  return (
    <span className="lr-strip">
      {marks.map((m, i) =>
        m.line === undefined ? null : (
          <span
            key={i}
            className="lr-mark"
            role="img"
            aria-label={label(m)}
            style={vars({
              "--x": `${((m.line - 1) / length) * 100}%`,
              "--w": `${(((m.end ?? m.line) - m.line + 1) / length) * 100}%`,
              "--c": m.color,
            })}
          />
        ),
      )}
    </span>
  );
}

/** One file drawn tall, symbols as blocks, labels spread out and joined by leaders. */
function VerticalMap({ marks, length }: { marks: Mark[]; length: number }) {
  const height = Math.max(160, marks.length * 18);
  return (
    <div className="lr-vmap" style={vars({ "--h": `${height}px` })}>
      <span className="lr-vrail">
        {marks.map((m, i) => (
          <span
            key={i}
            className="lr-vblock"
            style={vars({
              "--y": `${(((m.line ?? 1) - 1) / length) * 100}%`,
              "--hh": `${(((m.end ?? m.line ?? 1) - (m.line ?? 1) + 1) / length) * 100}%`,
              "--c": m.color,
            })}
          />
        ))}
      </span>
      <svg
        className="lr-leaders"
        viewBox={`0 0 100 ${height}`}
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        {marks.map((m, i) => {
          const from =
            ((((m.line ?? 1) + (m.end ?? m.line ?? 1)) / 2 - 0.5) / length) *
            height;
          const to = ((i + 0.5) / marks.length) * height;
          return (
            <path
              key={i}
              d={`M0 ${from} C50 ${from} 50 ${to} 100 ${to}`}
              style={vars({ "--c": m.color })}
            />
          );
        })}
      </svg>
      <ol className="lr-vlabels">
        {marks.map((m, i) => (
          <li key={i}>
            <Glyph item={m} />
            <span className="lf-text">{m.text}</span>
            <small>{m.loc}</small>
          </li>
        ))}
      </ol>
    </div>
  );
}

function Segments({ groups }: { groups: Groups }) {
  return (
    <div className="lr-rows">
      {groups.map((g, gi) => (
        <div key={gi} className="lr-strip-row">
          <span className="lr-row-label">{g.title}</span>
          <span className="lr-segs">
            {g.items.map((m, i) => (
              <span
                key={i}
                className="lr-seg"
                style={vars({ "--c": m.color, flexGrow: m.weight })}
              >
                <Glyph item={m} />
                <span className="lf-text">
                  {m.file ? baseName(m.file) : m.text}
                </span>
              </span>
            ))}
          </span>
        </div>
      ))}
    </div>
  );
}

function MinimapFamily({ view }: { view: LensView }) {
  const b = view.body;
  if (b.type === "code") {
    const end = codeEnd(b);
    const marks = [symbolMark(view, b.start, end)];
    if (b.mark)
      marks.push({
        ...marks[0],
        line: b.mark,
        end: b.mark,
        color: "var(--ds-highlight)",
      });
    return (
      <div className="lr-peek">
        <Code text={b.code} path={b.path} start={b.start} mark={b.mark} />
        <span className="lr-side-rail">
          <Strip marks={marks} length={end + 24} />
        </span>
      </div>
    );
  }
  if (b.type === "facts") {
    const line = factLine(b);
    return (
      <div className="lf-frame lr-stack">
        <div className="lr-strip-row">
          <Path path={view.path ?? ""} line={line} />
          <Strip
            marks={[
              {
                glyph: "info",
                text: view.subject ?? "",
                line,
                end: line,
                weight: 1,
                color: "var(--ds-info)",
              },
            ]}
            length={line + 40}
          />
        </div>
        <Facts rows={b.rows.slice(1)} />
      </div>
    );
  }
  const groups = groupsOf(b);
  const all = groups.flatMap((g) => g.items);
  const located = all.filter((m) => m.line !== undefined);
  if (located.length === 0)
    return (
      <div className="lf-frame">
        <Segments groups={groups} />
      </div>
    );
  const length = Math.max(20, ...located.map((m) => (m.end ?? 0) * 1.15));
  const singleFile =
    (groups.length === 1 && groups[0].isFile) ||
    all.every((m) => !m.file && !groups.some((g) => g.isFile));
  if (singleFile) {
    const unique = [
      ...new Map(located.map((m) => [`${m.text}:${m.line}`, m])).values(),
    ];
    unique.sort((a, b) => (a.line ?? 0) - (b.line ?? 0));
    return (
      <div className="lf-frame">
        <VerticalMap marks={unique} length={length} />
      </div>
    );
  }
  // Many files: one strip per file, every finding at its line.
  const rows = groups.some((g) => g.isFile)
    ? groups.map((g) => ({ path: g.title, marks: g.items }))
    : all.map((m) => ({ path: m.file ?? m.text, marks: [m] }));
  return (
    <div className="lf-frame lr-rows">
      {rows.map((row, i) => (
        <div key={i} className="lr-strip-row">
          <Path path={row.path} />
          <Strip marks={row.marks} length={length} />
          <small className="lr-count">{row.marks.length}</small>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------ 2. graph ------------------------------ */

const ROW = 24;
function Node({
  className = "",
  x,
  y,
  width,
  color,
  children,
}: {
  className?: string;
  x: number;
  y: number;
  width?: number;
  color?: string;
  children: ReactNode;
}) {
  return (
    <span
      className={`lr-node ${className}`}
      style={vars({
        "--x": `${x}%`,
        "--y": `${y}px`,
        ...(width ? { "--nw": `${width}%` } : {}),
        "--c": color ?? "var(--ds-text-faint)",
      })}
    >
      {children}
    </span>
  );
}
const curve = (x1: number, y1: number, x2: number, y2: number) =>
  `M${x1} ${y1} C${(x1 + x2) / 2} ${y1} ${(x1 + x2) / 2} ${y2} ${x2} ${y2}`;

function Chain({ nodes }: { nodes: { text: ReactNode; color?: string }[] }) {
  return (
    <div className="lr-chain">
      {nodes.map((n, i) => (
        <span key={i} className="lr-chain-step">
          {i > 0 && <ArrowRight size={12} aria-hidden="true" />}
          <span
            className="lr-node lr-node-inline"
            style={vars({ "--c": n.color ?? "var(--ds-text-faint)" })}
          >
            {n.text}
          </span>
        </span>
      ))}
    </div>
  );
}

function GraphFamily({ view }: { view: LensView }) {
  const b = view.body;
  if (b.type === "code") {
    const end = codeEnd(b);
    return (
      <div className="lr-stack">
        <Chain
          nodes={[
            { text: <Path path={b.path} /> },
            {
              text: (
                <>
                  <Glyph item={symbolMark(view, b.start, end)} />
                  {view.subject}
                </>
              ),
              color: kindColor[view.kind ?? ""],
            },
            { text: `L${b.start}–${end}` },
          ]}
        />
        <Code text={b.code} path={b.path} start={b.start} mark={b.mark} />
      </div>
    );
  }
  if (b.type === "facts")
    return (
      <div className="lf-frame lr-stack">
        <Chain
          nodes={b.rows
            .filter((r) => r.label !== "理由")
            .map((r) => ({
              text: r.value,
              color: r.tone ? toneColor[r.tone] : undefined,
            }))}
        />
        <p className="lr-caption">
          {b.rows.find((r) => r.label === "理由")?.value}
        </p>
      </div>
    );
  const groups = groupsOf(b).filter((g) => g.items.length > 0);
  const leaves = groups.flatMap((g) => g.items);
  const tiered = groups.length > 1;
  const height = Math.max(leaves.length, 1) * ROW;
  const leafX = tiered ? 58 : 34;
  let row = 0;
  const placed = groups.map((g) => {
    const ys = g.items.map(() => row++ * ROW + ROW / 2);
    return { g, ys, y: (ys[0] + ys[ys.length - 1]) / 2 };
  });
  // Keep the root inside the first ~8 rows, so a tall graph that scrolls still shows its origin.
  const rootY = Math.min(height / 2, 4 * ROW);
  return (
    <div className="lf-frame">
      <div className="lr-graph" style={vars({ "--h": `${height}px` })}>
        <svg
          viewBox={`0 0 100 ${height}`}
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          {placed.map(({ g, ys, y }, gi) => [
            tiered && <path key={`g${gi}`} d={curve(26, rootY, 32, y)} />,
            ...g.items.map((m, i) => (
              <path
                key={`${gi}-${i}`}
                d={
                  tiered
                    ? curve(54, y, leafX, ys[i])
                    : curve(26, rootY, leafX, ys[i])
                }
                style={vars({ "--c": m.color })}
              />
            )),
          ])}
        </svg>
        <Node
          className="lr-node-root"
          x={0}
          y={rootY}
          width={26}
          color="var(--lf-hue)"
        >
          <Aperture size={12} aria-hidden="true" />
          <span className="lf-text">{crumb(view) || view.verb}</span>
        </Node>
        {placed.map(({ g, ys, y }, gi) => (
          <span key={gi}>
            {tiered && (
              <Node className="lr-node-group" x={32} y={y} width={22}>
                <span className="lf-text">
                  {g.isFile ? baseName(g.title) : g.title}
                </span>
                <small>{g.items.length}</small>
              </Node>
            )}
            {g.items.map((m, i) => (
              <Node key={i} x={leafX} y={ys[i]} color={m.color}>
                <Glyph item={m} />
                <span className="lf-text">
                  {m.file && m.text === m.file ? baseName(m.file) : m.text}
                </span>
                {m.loc && <small>{m.loc}</small>}
              </Node>
            ))}
          </span>
        ))}
      </div>
    </div>
  );
}

/* ------------------------- 2b. compact graph ------------------------- */

/**
 * The same graph, one row per group: only root → group is drawn as a tree,
 * results wrap as chips beside their group. Height follows the group count.
 */
function CompactGraphFamily({ view }: { view: LensView }) {
  if (view.body.type !== "list") return <GraphFamily view={view} />;
  const groups = groupsOf(view.body).filter((g) => g.items.length > 0);
  const tiered = groups.length > 1;
  return (
    <div className="lf-frame">
      <div className="lr-cgraph">
        <span
          className="lr-node lr-node-root lr-croot"
          style={vars({ "--c": "var(--lf-hue)" })}
        >
          <Aperture size={12} aria-hidden="true" />
          <span className="lf-text">{crumb(view) || view.verb}</span>
        </span>
        <div className="lr-cbranches">
          {groups.map((g, gi) => (
            <div key={gi} className="lr-cbranch">
              {tiered && (
                <span className="lr-node lr-node-group lr-cgroup">
                  <span className="lf-text">
                    {g.isFile ? baseName(g.title) : g.title}
                  </span>
                  <small>{g.items.length}</small>
                </span>
              )}
              <span className="lr-cleaves">
                {g.items.map((m, i) => (
                  <span
                    key={i}
                    className="lr-node lr-cleaf"
                    style={vars({ "--c": m.color })}
                  >
                    <Glyph item={m} />
                    <span className="lf-text">
                      {m.file && m.text === m.file ? baseName(m.file) : m.text}
                    </span>
                    {m.loc && <small>{m.loc}</small>}
                  </span>
                ))}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------ 3. gauges ------------------------------ */

function Tiles({ view }: { view: LensView }) {
  return (
    <div className="lr-tiles">
      {statsOf(view).map((s) => (
        <span
          key={s.label + s.value}
          className="lr-tile"
          style={vars({
            "--c":
              s.tone === "neutral"
                ? "var(--ds-text-secondary)"
                : toneColor[s.tone],
          })}
        >
          <strong>{s.value}</strong>
          {s.label && <small>{s.label}</small>}
        </span>
      ))}
    </div>
  );
}

function Bars({ groups }: { groups: Groups }) {
  const stacked = groups.length > 1;
  const rows = stacked
    ? groups.map((g) => ({
        label: g.isFile ? baseName(g.title) : g.title,
        parts: g.items,
      }))
    : (groups[0]?.items ?? []).map((m) => ({
        label: m.file && m.text === m.file ? baseName(m.file) : m.text,
        parts: [m],
      }));
  const total = (parts: Mark[]) => parts.reduce((s, m) => s + m.weight, 0);
  const max = Math.max(1, ...rows.map((r) => total(r.parts)));
  return (
    <div className="lr-bars">
      {rows.map((r, i) => (
        <div key={i} className="lr-bar-row">
          <span className="lr-row-label">{r.label}</span>
          <span className="lr-bar">
            {r.parts.map((m, j) => (
              <span
                key={j}
                role="img"
                aria-label={label(m)}
                style={vars({
                  "--c": m.color,
                  width: `${(m.weight / max) * 100}%`,
                })}
              />
            ))}
          </span>
          <small className="lr-count">
            {Math.round(total(r.parts) * 100) / 100}
          </small>
        </div>
      ))}
    </div>
  );
}

function GaugeFamily({ view }: { view: LensView }) {
  const b = view.body;
  if (b.type === "code")
    return (
      <div className="lr-stack">
        <Tiles view={view} />
        <Code text={b.code} path={b.path} start={b.start} mark={b.mark} />
      </div>
    );
  return (
    <div className="lf-frame lr-stack">
      <Tiles view={view} />
      {b.type === "facts" ? (
        <Facts rows={b.rows} />
      ) : (
        <Bars groups={groupsOf(b)} />
      )}
    </div>
  );
}

/* ------------------------------ 4. split ------------------------------ */

function Detail({ mark, lang }: { mark: Mark; lang?: string }) {
  const source = lang ?? mark.file;
  return (
    <div className="lr-detail">
      <header>
        <Glyph item={mark} />
        <strong className="lf-text">{mark.text}</strong>
      </header>
      {mark.file && mark.text !== mark.file && (
        <Path path={mark.file} line={mark.line} />
      )}
      {mark.loc && !mark.file && <small>{mark.loc}</small>}
      {mark.before !== undefined ? (
        <pre className="lr-snippet">
          <del>- {mark.before}</del>
          {"\n"}
          <ins>+ {mark.after}</ins>
        </pre>
      ) : (
        mark.code &&
        source && (
          <pre className="lr-snippet">
            <CodeText text={mark.code} language={languageFromPath(source)} />
          </pre>
        )
      )}
      {mark.sub && <p>{mark.sub}</p>}
    </div>
  );
}

function SplitFamily({ view }: { view: LensView }) {
  const [selected, setSelected] = useState(0);
  const b = view.body;
  if (b.type === "code") {
    const end = codeEnd(b);
    return (
      <div className="lr-split">
        <div className="lr-detail">
          <header>
            <Glyph item={symbolMark(view, b.start, end)} />
            <strong>{view.subject}</strong>
          </header>
          <Facts
            rows={[
              { label: "種類", value: kindName[view.kind ?? ""] ?? "" },
              { label: "範囲", value: `L${b.start}–${end}` },
              { label: "行数", value: `${end - b.start + 1}` },
            ]}
          />
          <Path path={b.path} />
        </div>
        <Code text={b.code} path={b.path} start={b.start} mark={b.mark} />
      </div>
    );
  }
  const items: Mark[] =
    b.type === "facts"
      ? b.rows.map((r) => ({
          glyph: "info",
          text: r.label,
          sub: r.value,
          weight: 1,
          color: r.tone ? toneColor[r.tone] : "var(--ds-text-faint)",
        }))
      : groupsOf(b).flatMap((g) => g.items);
  const current = items[Math.min(selected, items.length - 1)];
  return (
    <div className="lr-split lf-frame">
      <ul className="lr-master">
        {items.map((m, i) => (
          <li key={i}>
            <button
              type="button"
              aria-pressed={m === current}
              onClick={() => setSelected(i)}
              style={vars({ "--c": m.color })}
            >
              <Glyph item={m} />
              <span className="lf-text">
                {m.file && m.text === m.file ? baseName(m.file) : m.text}
              </span>
              {m.loc && <small>{m.loc}</small>}
            </button>
          </li>
        ))}
      </ul>
      {current && (
        <Detail mark={current} lang={b.type === "list" ? b.lang : undefined} />
      )}
    </div>
  );
}

/* ------------------------------ 5. treemap ------------------------------ */

function TileBox({ mark }: { mark: Mark }) {
  return (
    <span
      className="lr-tm-tile"
      role="img"
      aria-label={label(mark)}
      style={vars({ "--c": mark.color, flexGrow: mark.weight })}
    >
      <Glyph item={mark} />
      <span className="lf-text">
        {mark.file && mark.text === mark.file ? baseName(mark.file) : mark.text}
      </span>
    </span>
  );
}

function TreemapFamily({ view }: { view: LensView }) {
  const b = view.body;
  if (b.type === "code") {
    const end = codeEnd(b);
    return (
      <div className="lr-stack">
        <div className="lr-tm lr-tm-row lr-tm-short">
          <TileBox mark={symbolMark(view, b.start, end)} />
          <span className="lr-tm-tile lr-tm-quiet">
            L{b.start}–{end}
          </span>
        </div>
        <Code text={b.code} path={b.path} start={b.start} mark={b.mark} />
      </div>
    );
  }
  if (b.type === "facts")
    return (
      <div className="lr-tm lr-tm-row lr-tm-short">
        {b.rows.map((r) => (
          <span
            key={r.label}
            className="lr-tm-tile lr-tm-fact"
            style={vars({
              "--c": r.tone ? toneColor[r.tone] : "var(--ds-text-faint)",
              flexGrow: r.label === "理由" ? 3 : 1,
            })}
          >
            <small>{r.label}</small>
            <span className="lf-text">{r.value}</span>
          </span>
        ))}
      </div>
    );
  const groups = groupsOf(b).filter((g) => g.items.length > 0);
  const total = (items: Mark[]) => items.reduce((s, m) => s + m.weight, 0);
  if (groups.length === 1)
    return (
      <div className="lr-tm lr-tm-row">
        {groups[0].items.map((m, i) => (
          <TileBox key={i} mark={m} />
        ))}
      </div>
    );
  // Slice and dice: groups are columns by total size, items split each column.
  return (
    <div className="lr-tm">
      {groups.map((g, gi) => (
        <section
          key={gi}
          className="lr-tm-group"
          style={vars({ flexGrow: total(g.items) })}
        >
          <header className="lf-text">
            {g.isFile ? baseName(g.title) : g.title}
          </header>
          {g.items.map((m, i) => (
            <TileBox key={i} mark={m} />
          ))}
        </section>
      ))}
    </div>
  );
}

/* ------------------------------ wiring ------------------------------ */

type RichVariant = {
  key: "minimap" | "graph" | "graphCompact" | "gauge" | "split" | "treemap";
  title: string;
  fit: string;
  Body: (props: { view: LensView }) => ReactNode;
};

function LensRich({ tool, phase, v }: ToolProps & { v: RichVariant }) {
  const view = lensView(tool);
  return (
    <DisclosureScope id={`story:${tool.call.id}:lr-${v.key}`}>
      <div className={`lf lr lr-v-${v.key}`}>
        <ToolRow
          icon={<Aperture size={14} className="lf-mark" aria-label="pi-lens" />}
          verb={view.verb}
          target={crumb(view)}
          meta={view.meta.join(" · ")}
          state={tool.state}
          status={phase}
          defaultOpen
        >
          <Phased tool={tool} phase={phase}>
            <v.Body view={view} />
          </Phased>
        </ToolRow>
      </div>
    </DisclosureScope>
  );
}

const rich: RichVariant[] = [
  {
    key: "minimap",
    title: "ミニマップ",
    fit: "ファイルを帯として描き、結果を行の位置に印で置く。診断・参照・一致は「どのファイルのどのあたりか」、構造は縦長のマップと引き出し線で見せる。",
    Body: MinimapFamily,
  },
  {
    key: "graph",
    title: "関係図",
    fit: "起点 → グループ → 結果のつながりをノードと線で描く。参照の広がり、モジュールの公開APIと参照元、設定の採用関係を同じ図法で見せる。",
    Body: GraphFamily,
  },
  {
    key: "graphCompact",
    title: "関係図（コンパクト）",
    fit: "関係図の縦長を抑えた版。線で結ぶのは起点 → グループだけにし、結果はグループの横にチップとして折り返す。高さは結果の件数ではなくグループ数で決まる。",
    Body: CompactGraphFamily,
  },
  {
    key: "gauge",
    title: "計器",
    fit: "結論を大きな数字のタイルに、内訳を積み上げ棒にする。ファイル別の重大度、関連度スコア、宣言の大きさを同じ棒で比べる。",
    Body: GaugeFamily,
  },
  {
    key: "split",
    title: "分割ビュー",
    fit: "左の一覧で選んだ項目の詳細を右に出す。IDEのピーク表示のように、一覧を見ながらコード・置換前後・補足を1件ずつ確かめる。",
    Body: SplitFamily,
  },
  {
    key: "treemap",
    title: "ツリーマップ",
    fit: "量を面積で見せる。重大度で重みを付けた診断、行数で大きさが決まる宣言、fanInの大きいハブが一目で大きく見える。",
    Body: TreemapFamily,
  },
];

export const richProposals = Object.fromEntries(
  rich.map((v) => [
    v.key,
    {
      title: v.title,
      fit: v.fit,
      View: (props: ToolProps) => <LensRich {...props} v={v} />,
    },
  ]),
) as Record<RichVariant["key"], Proposal<ToolProps>>;
