// biome-ignore-all lint/suspicious/noArrayIndexKey: Parsed rows keep their order and may repeat.
import {
  ArrowRight,
  Check,
  CircleAlert,
  Eye,
  EyeOff,
  FileCog,
  Flame,
  GitBranch,
  Info,
  Lightbulb,
  LogIn,
  Network,
  Plus,
  Settings2,
  ShieldCheck,
  StickyNote,
  TriangleAlert,
  Wrench,
  X,
} from "lucide-react";
import { type CSSProperties, type ReactNode, useState } from "react";
import type { Proposal, Tool, ToolProps } from "./kit";
import { Badge, CardHead, Path, Phased, Row, Spin } from "./lens-kit";
import {
  args,
  baseName,
  body,
  type Diagnostic,
  details,
  groupBy,
  list,
  num,
  parseDiagnostics,
  parseSections,
  str,
} from "./lens-model";

/* ---------------- lens_diagnostics ---------------- */

const severityIcon = {
  error: CircleAlert,
  warning: TriangleAlert,
  info: Info,
  hint: Lightbulb,
};
const severityLabel = {
  error: "エラー",
  warning: "警告",
  info: "情報",
  hint: "ヒント",
};
function SeverityIcon({ severity }: { severity: Diagnostic["severity"] }) {
  const Icon = severityIcon[severity];
  return (
    <Icon
      size={13}
      className={`lx-sev-${severity}`}
      aria-label={severityLabel[severity]}
    />
  );
}
function diagnosticsOf(tool: Tool) {
  const d = details(tool);
  const items = parseDiagnostics(d.diagnostics);
  const count = (...severities: Diagnostic["severity"][]) =>
    items.filter((item) => severities.includes(item.severity)).length;
  const a = args(tool);
  return {
    target: list(a.paths).join(", ") || str(a.path) || "workspace",
    items,
    errors: count("error"),
    warnings: count("warning"),
    hints: count("hint", "info"),
    scanned: num(d.filesScanned) ?? 0,
    clean: num(d.cleanFiles) ?? 0,
    unconfirmed: num(d.unconfirmedFiles) ?? 0,
  };
}
type Diagnostics = ReturnType<typeof diagnosticsOf>;
const diagnosticMeta = (d: Diagnostics) =>
  d.items.length ? `${d.errors} エラー · ${d.warnings} 警告` : "問題なし";

function DiagSignal(props: ToolProps) {
  const d = diagnosticsOf(props.tool);
  const lamps: [string, number, string][] = [
    ["エラー", d.errors, "error"],
    ["警告", d.warnings, "warn"],
    ["ヒント", d.hints, "info"],
  ];
  return (
    <Row
      {...props}
      icon={<ShieldCheck size={14} />}
      verb="診断"
      target={d.target}
      meta={`${d.scanned} ファイル`}
    >
      <div className="lx-signal">
        {lamps.map(([label, value, tone]) => (
          <span
            key={label}
            className={`lx-lamp lx-${tone}${value ? " lx-lit" : ""}`}
          >
            <i />
            <strong>{value}</strong>
            {label}
          </span>
        ))}
        <span className="lx-row-meta">
          <small>
            {d.clean} ファイルは問題なし
            {d.unconfirmed > 0 && ` · ${d.unconfirmed} 未確認`}
          </small>
        </span>
      </div>
    </Row>
  );
}

function DiagCompiler(props: ToolProps) {
  const d = diagnosticsOf(props.tool);
  return (
    <Row
      {...props}
      icon={<ShieldCheck size={14} />}
      verb="診断"
      target={d.target}
      meta={diagnosticMeta(d)}
    >
      <pre className="lx-log lx-compiler">
        {d.items.map((item, i) => (
          <span key={i}>
            <span className="lx-loc">
              {item.file}({item.line},{item.column})
            </span>
            : <span className={`lx-sev-${item.severity}`}>{item.severity}</span>{" "}
            <span className="lx-faint">
              {item.source === "typescript" ? `TS${item.code}` : item.code}
            </span>
            : {item.message}
            {"\n"}
          </span>
        ))}
      </pre>
    </Row>
  );
}

function DiagSources(props: ToolProps) {
  const d = diagnosticsOf(props.tool);
  return (
    <section className="lx-card" data-ui-surface="card">
      <CardHead
        icon={<ShieldCheck size={14} />}
        title="診断"
        sub={d.target}
        phase={props.phase}
        aside={
          <Badge tone={d.errors ? "error" : "ok"}>{diagnosticMeta(d)}</Badge>
        }
      />
      <Phased {...props}>
        <div className="lx-sources">
          {groupBy(d.items, (item) => item.source ?? "unknown").map(
            ([source, items]) => (
              <section key={source}>
                <h4>
                  {source}
                  <small>{items.length}</small>
                </h4>
                {items.map((item, i) => (
                  <p key={i}>
                    <SeverityIcon severity={item.severity} />
                    <span>{item.message}</span>
                    <small>
                      {baseName(item.file)}:{item.line}
                    </small>
                  </p>
                ))}
              </section>
            ),
          )}
        </div>
      </Phased>
    </section>
  );
}

function DiagTodo(props: ToolProps) {
  const d = diagnosticsOf(props.tool);
  const [rest, setRest] = useState(false);
  const errors = d.items.filter((item) => item.severity === "error");
  const others = d.items.filter((item) => item.severity !== "error");
  return (
    <Row
      {...props}
      icon={<ShieldCheck size={14} />}
      verb="直すもの"
      target={d.target}
      meta={`${errors.length} 件`}
    >
      <ul className="lx-todo">
        {errors.map((item, i) => (
          <li key={i}>
            <span className="lx-box" />
            <span>
              {item.message}
              <small>
                <Path path={item.file} line={item.line} />
              </small>
            </span>
          </li>
        ))}
      </ul>
      {others.length > 0 && (
        <button
          type="button"
          className="lx-link"
          onClick={() => setRest(!rest)}
        >
          {rest
            ? "警告・ヒントを隠す"
            : `ほかに警告・ヒント ${others.length} 件`}
        </button>
      )}
      {rest && (
        <ul className="lx-list">
          {others.map((item, i) => (
            <li key={i}>
              <SeverityIcon severity={item.severity} />
              <span className="lx-ellipsis">{item.message}</span>
            </li>
          ))}
        </ul>
      )}
    </Row>
  );
}

function DiagDonut(props: ToolProps) {
  const d = diagnosticsOf(props.tool);
  const total = Math.max(1, d.scanned);
  const withProblems = Math.max(0, d.scanned - d.clean - d.unconfirmed);
  const parts: [string, number, string][] = [
    ["問題なし", d.clean, "var(--ds-success)"],
    ["問題あり", withProblems, "var(--ds-error)"],
    ["未確認", d.unconfirmed, "var(--ds-text-faint)"],
  ];
  let at = 0;
  const gradient = parts
    .map(([, value, color]) => {
      const from = at;
      at += (value / total) * 100;
      return `${color} ${from}% ${at}%`;
    })
    .join(", ");
  return (
    <Row
      {...props}
      icon={<ShieldCheck size={14} />}
      verb="診断の網羅"
      target={d.target}
      meta={`${d.scanned} ファイル`}
    >
      <div className="lx-donut-row">
        <span
          className="lx-donut"
          style={
            { "--lx-gradient": `conic-gradient(${gradient})` } as CSSProperties
          }
          role="img"
          aria-label={`${d.clean}/${d.scanned} ファイルが問題なし`}
        >
          <strong>
            {d.clean}/{d.scanned}
          </strong>
        </span>
        <ul className="lx-legend lx-legend-col">
          {parts.map(([label, value, color]) => (
            <li key={label}>
              <i style={{ background: color }} />
              {label} <small>{value}</small>
            </li>
          ))}
        </ul>
      </div>
    </Row>
  );
}

export const diagnosticsProposals = {
  Signal: {
    title: "信号灯",
    fit: "エラー・警告・ヒントを3つのランプで。0件のランプは消灯し、一目で状態がわかる。",
    View: DiagSignal,
  },
  Compiler: {
    title: "コンパイラ出力",
    fit: "tsc と同じ file(行,列): error TSxxxx の形に整える。普段のターミナル出力と同じ感覚で読める。",
    View: DiagCompiler,
  },
  Sources: {
    title: "検査元ごと",
    fit: "typescript・biome など、どの検査器の指摘かで分ける。型エラーとLintを混ぜずに読む。",
    View: DiagSources,
  },
  Todo: {
    title: "修正のToDo",
    fit: "エラーだけを未完了のチェック項目に。警告とヒントは畳んでおく。",
    View: DiagTodo,
  },
  Donut: {
    title: "網羅のドーナツ",
    fit: "調べたファイルのうち問題なし・問題あり・未確認の割合を円で。0件が本当に検査済みかを示す。",
    View: DiagDonut,
  },
} satisfies Record<string, Proposal<ToolProps>>;

/* ---------------- lens_diagnostic_mark ---------------- */

function markOf(tool: Tool) {
  const a = args(tool);
  const disposition = str(details(tool).disposition) || str(a.disposition);
  return {
    path: str(a.path) || str(a.filePath),
    line: num(details(tool).line) ?? num(a.line),
    rule: str(a.rule),
    source: str(a.tool),
    message: str(a.message),
    reason: str(a.reason),
    anchor: str(details(tool).anchor),
    label:
      disposition === "suppress"
        ? "抑制"
        : disposition.includes("false")
          ? "誤検知"
          : "記録",
  };
}

function MarkVisibility(props: ToolProps) {
  const m = markOf(props.tool);
  return (
    <Row
      {...props}
      icon={<EyeOff size={14} />}
      verb={`診断を${m.label}`}
      target={`${baseName(m.path)}:${m.line}`}
      meta={m.rule}
    >
      <div className="lx-visibility">
        <span className="lx-chip">
          <Eye size={12} />
          表示
        </span>
        <ArrowRight size={13} className="lx-faint" />
        <span className="lx-chip lx-chip-accent">
          <EyeOff size={12} />
          非表示
        </span>
        <small>この行が変わるまで</small>
      </div>
    </Row>
  );
}

function MarkNote(props: ToolProps) {
  const m = markOf(props.tool);
  return (
    <aside className="lx-note-card" data-ui-surface="card">
      <header>
        <StickyNote size={13} />
        <code>{m.rule}</code>
        <span className="lx-row-meta">
          {props.phase === "running" ? (
            <Spin />
          ) : (
            <Badge tone="info">{m.label}</Badge>
          )}
        </span>
      </header>
      <p>{m.reason}</p>
      <footer>
        <Path path={m.path} line={m.line} />
        <small>{m.source}</small>
      </footer>
      {props.phase === "error" && <Phased {...props} />}
    </aside>
  );
}

function MarkTimeline(props: ToolProps) {
  const m = markOf(props.tool);
  return (
    <Row
      {...props}
      icon={<EyeOff size={14} />}
      verb="診断の履歴"
      target={`${m.path}:${m.line}`}
    >
      <ol className="lx-timeline-v">
        <li>
          <i className="lx-tl-warn" />
          <span>
            {m.source} が報告
            <small>{m.message}</small>
          </span>
        </li>
        <li>
          <i className="lx-tl-accent" />
          <span>
            {m.label}として記録
            <small>{m.reason}</small>
          </span>
        </li>
        <li>
          <i className="lx-tl-faint" />
          <span>
            以後は非表示
            <small>行が変わると再び表示されます</small>
          </span>
        </li>
      </ol>
    </Row>
  );
}

function MarkInline(props: ToolProps) {
  const m = markOf(props.tool);
  return (
    <div className="lx-plain">
      <p className="lx-inline-row">
        <EyeOff size={13} className="lx-faint" />
        <Path path={m.path} line={m.line} />
        <span className="lx-rule-pill">{m.rule}</span>
        {props.phase === "running" ? (
          <Spin />
        ) : (
          props.phase === "done" && <Badge tone="info">{m.label}</Badge>
        )}
        <span className="lx-ellipsis lx-faint" title={m.reason}>
          {m.reason}
        </span>
      </p>
      {props.phase === "error" && <Phased {...props} />}
    </div>
  );
}

function MarkReceipt(props: ToolProps) {
  const m = markOf(props.tool);
  return (
    <Row
      {...props}
      icon={<EyeOff size={14} />}
      verb={`診断を${m.label}`}
      target={m.rule}
      meta={m.anchor && `#${m.anchor}`}
    >
      <pre className="lx-log lx-receipt">
        {[
          `rule     ${m.rule}`,
          `tool     ${m.source}`,
          `at       ${m.path}:${m.line}`,
          `action   ${m.label}`,
          `anchor   ${m.anchor}`,
          `reason   ${m.reason}`,
        ].join("\n")}
      </pre>
    </Row>
  );
}

export const diagnosticMarkProposals = {
  Visibility: {
    title: "表示 → 非表示",
    fit: "この操作で何が変わるか（診断が見えなくなる）だけを2つのチップで示す。",
    View: MarkVisibility,
  },
  Note: {
    title: "付箋",
    fit: "理由を付箋のように書き残す。後から見返したとき、なぜ抑制したかが主役になる。",
    View: MarkNote,
  },
  Timeline: {
    title: "経緯のタイムライン",
    fit: "報告 → 記録 → 非表示 の流れで、元の診断文と理由の両方を残す。",
    View: MarkTimeline,
  },
  Inline: {
    title: "1行のラベル",
    fit: "場所・ルール・扱い・理由を1行に。行は開閉せず、理由はホバーで全文。",
    View: MarkInline,
  },
  Receipt: {
    title: "控え",
    fit: "等幅の控えとして記録内容を残す。アンカーで後から特定できる。",
    View: MarkReceipt,
  },
} satisfies Record<string, Proposal<ToolProps>>;

/* ---------------- project_report ---------------- */

function reportOf(tool: Tool) {
  const { head, sections } = parseSections(body(tool));
  const items = (name: string) =>
    (sections.get(name) ?? [])
      .filter((row) => row.startsWith("- "))
      .map((row) => row.slice(2));
  const coverage = /(\d+)\/(\d+) files \((\d+)% coverage\)/.exec(head);
  const fan = (row: string) => {
    const found = /^(\S+)(?: \(fanIn (\d+)\))?/.exec(row);
    return { file: found?.[1] ?? row, fanIn: Number(found?.[2] ?? 0) };
  };
  const risk = (row: string) => {
    const found = /^(\S+)(?: \((.*)\))?$/.exec(row);
    return {
      file: found?.[1] ?? row,
      facts: (found?.[2] ?? "")
        .split(",")
        .map((part) => part.trim())
        .filter(Boolean),
    };
  };
  const subsystemRows = sections.get("SUBSYSTEMS") ?? [];
  return {
    focus: str(args(tool).focus),
    analyzed: coverage ? `${coverage[1]}/${coverage[2]}` : "",
    percent: coverage ? Number(coverage[3]) : undefined,
    hubs: items("HUBS").map(fan),
    entries: items("ENTRY POINTS"),
    subsystems: subsystemRows.flatMap((row) => {
      const found = /^- (\S+) \((\d+) files\)$/.exec(row);
      return found ? [{ dir: found[1], files: Number(found[2]) }] : [];
    }),
    cycles: subsystemRows
      .filter((row) => row.includes("→"))
      .map((row) => row.replace(/^- /, "").split(/\s*→\s*/)),
    risks: items("RISK HOTSPOTS").map(risk),
    dead: items("DEAD WEIGHT"),
  };
}

function ReportLayers(props: ToolProps) {
  const r = reportOf(props.tool);
  const layer = (label: string, icon: ReactNode, files: string[]) => (
    <div className="lx-layer">
      <small>
        {icon}
        {label}
      </small>
      <div className="lx-chips">
        {files.map((file) => (
          <span key={file} className="lx-chip" title={file}>
            {baseName(file)}
          </span>
        ))}
      </div>
    </div>
  );
  return (
    <Row
      {...props}
      icon={<Network size={14} />}
      verb="プロジェクト構造"
      target={r.focus || "全体"}
      meta={r.analyzed && `${r.analyzed} ファイル`}
    >
      <div className="lx-layers">
        {layer("入口", <LogIn size={11} />, r.entries)}
        {layer(
          "中心（ハブ）",
          <Network size={11} />,
          r.hubs.map((hub) => hub.file),
        )}
        {layer(
          "領域",
          <GitBranch size={11} />,
          r.subsystems.map((item) => `${item.dir}`),
        )}
      </div>
    </Row>
  );
}

function ReportHotspots(props: ToolProps) {
  const r = reportOf(props.tool);
  return (
    <Row
      {...props}
      icon={<Flame size={14} />}
      verb="ホットスポット"
      target={r.focus || "全体"}
      meta={`${r.risks.length + r.dead.length} 件`}
    >
      <ul className="lx-hotspots">
        {r.risks.map((risk) => (
          <li key={risk.file}>
            <Flame size={13} className="lx-error-text" />
            <Path path={risk.file} />
            <span className="lx-chips">
              {risk.facts.map((fact) => (
                <Badge key={fact} tone="warn">
                  {fact}
                </Badge>
              ))}
            </span>
          </li>
        ))}
        {r.dead.map((file) => (
          <li key={file}>
            <X size={13} className="lx-faint" />
            <Path path={file} />
            <span className="lx-chips">
              <Badge>未使用の可能性</Badge>
            </span>
          </li>
        ))}
      </ul>
    </Row>
  );
}

function ReportIndex(props: ToolProps) {
  const r = reportOf(props.tool);
  const sections: [string, string[]][] = [
    ["ハブ", r.hubs.map((hub) => `${hub.file}  ← ${hub.fanIn}`)],
    ["入口", r.entries],
    ["領域", r.subsystems.map((item) => `${item.dir}  ${item.files} files`)],
    ["循環", r.cycles.map((cycle) => cycle.join(" → "))],
    ["リスク", r.risks.map((risk) => risk.file)],
    ["不要候補", r.dead],
  ];
  const [open, setOpen] = useState<string>();
  return (
    <section className="lx-card" data-ui-surface="card">
      <CardHead
        icon={<Network size={14} />}
        title="プロジェクトレポート"
        sub={r.focus && `焦点: ${r.focus}`}
        phase={props.phase}
        aside={
          r.percent !== undefined && <Badge tone="ok">網羅 {r.percent}%</Badge>
        }
      />
      <Phased {...props}>
        <div className="lx-index">
          {sections.map(([label, rows]) => (
            <button
              key={label}
              type="button"
              aria-pressed={open === label}
              disabled={!rows.length}
              onClick={() => setOpen(open === label ? undefined : label)}
            >
              <strong>{rows.length}</strong>
              <small>{label}</small>
            </button>
          ))}
        </div>
        {open && (
          <pre className="lx-log">
            {sections.find(([label]) => label === open)?.[1].join("\n")}
          </pre>
        )}
      </Phased>
    </section>
  );
}

function ReportBrief(props: ToolProps) {
  const r = reportOf(props.tool);
  return (
    <div className="lx-plain">
      <p className="lx-sentence">
        <Network size={13} />
        {props.phase === "done" ? (
          <span>
            {r.analyzed} ファイルを解析。中心は{" "}
            <code>{baseName(r.hubs[0]?.file ?? "")}</code>（{r.hubs[0]?.fanIn}{" "}
            ファイルが依存）、入口は{" "}
            {r.entries.map((entry) => (
              <code key={entry}>{baseName(entry)}</code>
            ))}
            。{r.cycles.length > 0 && <>循環 {r.cycles.length} 件、</>}
            {r.risks.length > 0 && <>注意箇所 {r.risks.length} 件。</>}
          </span>
        ) : (
          <span className="lx-faint">プロジェクトの構造を調べています</span>
        )}
      </p>
      {props.phase === "error" && <Phased {...props} />}
    </div>
  );
}

function ReportCycle(props: ToolProps) {
  const r = reportOf(props.tool);
  return (
    <Row
      {...props}
      icon={<GitBranch size={14} />}
      verb="循環依存"
      target={r.focus || "全体"}
      meta={`${r.cycles.length} 件`}
    >
      {r.cycles.length ? (
        r.cycles.map((cycle, i) => (
          <div key={i} className="lx-cycle">
            {cycle.slice(0, -1).map((file, j) => (
              <span key={j} className="lx-cycle-node">
                {j > 0 && <ArrowRight size={12} className="lx-faint" />}
                <code title={file}>{baseName(file)}</code>
              </span>
            ))}
            <span className="lx-cycle-back">↺ {baseName(cycle[0])} に戻る</span>
          </div>
        ))
      ) : (
        <p className="lx-faint">循環はありません</p>
      )}
    </Row>
  );
}

export const projectReportProposals = {
  Layers: {
    title: "入口・中心・領域の層",
    fit: "入口 → ハブ → 領域 の3段で、プロジェクトの骨格を上から下へ読む。",
    View: ReportLayers,
  },
  Hotspots: {
    title: "注意箇所の一覧",
    fit: "複雑度・変更頻度・未テストの分岐をバッジにし、触ると危ない場所を先に知らせる。",
    View: ReportHotspots,
  },
  Index: {
    title: "目次カード",
    fit: "各セクションの件数を目次のボタンにし、選んだものだけ中身を開く。",
    View: ReportIndex,
  },
  Brief: {
    title: "要約文",
    fit: "中心・入口・注意点を1段落の文章で。初回の把握を会話の流れの中で伝える。",
    View: ReportBrief,
  },
  Cycle: {
    title: "循環の図",
    fit: "循環依存を矢印でつないだ輪として描く。どこで断ち切るかを考える場面に。",
    View: ReportCycle,
  },
} satisfies Record<string, Proposal<ToolProps>>;

/* ---------------- effective_config ---------------- */

type Entry = {
  id: string;
  on: boolean;
  group: string;
  role?: string;
  reason?: string;
};
function configOf(tool: Tool) {
  const text = body(tool);
  const newline = text.indexOf("\n");
  let json: Record<string, unknown> = {};
  try {
    json = JSON.parse(text.slice(newline + 1));
  } catch {}
  const file = (json.file ?? {}) as Record<string, unknown>;
  const servers = (Array.isArray(file.servers) ? file.servers : []) as {
    id: string;
    selected: boolean;
    reason?: string;
    role?: string;
  }[];
  const runners = (Array.isArray(file.runners) ? file.runners : []) as {
    id: string;
    enabled: boolean;
    tier?: string;
  }[];
  const entries: Entry[] = [
    ...servers.map((s) => ({
      id: s.id,
      on: s.selected,
      group: "言語サーバー",
      role: s.role,
      reason: s.selected ? undefined : s.reason,
    })),
    ...runners.map((r) => ({
      id: r.id,
      on: r.enabled,
      group: "解析",
      role: r.tier,
      reason: r.enabled ? undefined : "無効",
    })),
  ];
  return {
    path: str(args(tool).path) || str(file.path),
    language: str(file.language),
    configFiles: (Array.isArray(json.configFiles) ? json.configFiles : []) as {
      path: string;
    }[],
    entries,
  };
}

function ConfigMatrix(props: ToolProps) {
  const c = configOf(props.tool);
  return (
    <Row
      {...props}
      icon={<Settings2 size={14} />}
      verb="有効な設定"
      target={c.path}
      meta={c.language}
    >
      <div className="lx-table-wrap">
        <table className="lx-table">
          <thead>
            <tr>
              <th>名前</th>
              <th>種類</th>
              <th>役割</th>
              <th>状態</th>
            </tr>
          </thead>
          <tbody>
            {c.entries.map((entry) => (
              <tr key={entry.id} className={entry.on ? undefined : "lx-dim"}>
                <td>
                  <code>{entry.id}</code>
                </td>
                <td>{entry.group}</td>
                <td>{entry.role}</td>
                <td>
                  {entry.on ? (
                    <Badge tone="ok">使用</Badge>
                  ) : (
                    <span>{entry.reason}</span>
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

function ConfigWhy(props: ToolProps) {
  const c = configOf(props.tool);
  const off = c.entries.filter((entry) => !entry.on);
  return (
    <Row
      {...props}
      icon={<Settings2 size={14} />}
      verb="使われないもの"
      target={c.path}
      meta={`${off.length} 件`}
    >
      <ul className="lx-why">
        {off.map((entry) => (
          <li key={entry.id}>
            <code>{entry.id}</code>
            <span className="lx-why-bubble">なぜ？ — {entry.reason}</span>
          </li>
        ))}
      </ul>
    </Row>
  );
}

function ConfigLayers(props: ToolProps) {
  const c = configOf(props.tool);
  const on = c.entries.filter((entry) => entry.on).length;
  return (
    <section className="lx-card" data-ui-surface="card">
      <CardHead
        icon={<Wrench size={14} />}
        title="設定の重なり"
        sub={c.path}
        phase={props.phase}
      />
      <Phased {...props}>
        <ol className="lx-stack-layers">
          <li>
            <small>既定</small>pi-lens の組み込み設定
          </li>
          {c.configFiles.map((file) => (
            <li key={file.path}>
              <small>上書き</small>
              <FileCog size={12} />
              {file.path}
            </li>
          ))}
          <li className="lx-stack-result">
            <small>結果</small>
            {c.language} · {on}/{c.entries.length} が有効
          </li>
        </ol>
      </Phased>
    </section>
  );
}

function ConfigChips(props: ToolProps) {
  const c = configOf(props.tool);
  return (
    <Row
      {...props}
      icon={<Settings2 size={14} />}
      verb="有効な設定"
      target={c.path}
      meta={c.language}
    >
      <div className="lx-onoff">
        <small>有効</small>
        <div className="lx-chips">
          {c.entries
            .filter((entry) => entry.on)
            .map((entry) => (
              <span key={entry.id} className="lx-chip lx-chip-ok">
                <Check size={11} />
                {entry.id}
              </span>
            ))}
        </div>
        <small>無効</small>
        <div className="lx-chips">
          {c.entries
            .filter((entry) => !entry.on)
            .map((entry) => (
              <span
                key={entry.id}
                className="lx-chip lx-chip-off"
                title={entry.reason}
              >
                {entry.id}
              </span>
            ))}
        </div>
      </div>
    </Row>
  );
}

function ConfigHeader(props: ToolProps) {
  const c = configOf(props.tool);
  const count = (group: string) =>
    c.entries.filter((e) => e.group === group && e.on).length;
  return (
    <div className="lx-plain">
      <p className="lx-inline-row">
        <Settings2 size={13} className="lx-faint" />
        <Path path={c.path} />
        <Badge tone="info">{c.language || "…"}</Badge>
        {props.phase === "done" ? (
          <>
            <Badge>サーバー {count("言語サーバー")}</Badge>
            <Badge>解析 {count("解析")}</Badge>
            {c.configFiles.map((file) => (
              <Badge key={file.path} tone="accent">
                {baseName(file.path)}
              </Badge>
            ))}
          </>
        ) : (
          props.phase === "running" && <Spin />
        )}
      </p>
      {props.phase === "error" && <Phased {...props} />}
    </div>
  );
}

export const effectiveConfigProposals = {
  Matrix: {
    title: "設定の表",
    fit: "サーバーと解析を1つの表に。名前・種類・役割・状態を揃え、無効は理由を表示する。",
    View: ConfigMatrix,
  },
  Why: {
    title: "なぜ使われない？",
    fit: "無効なものだけを理由付きで並べる。「このLintが走らない」の調査に直接答える。",
    View: ConfigWhy,
  },
  Layers: {
    title: "設定の重なり",
    fit: "既定 → 設定ファイル → 結果 の順に重ねて、どこで決まったかを示す。",
    View: ConfigLayers,
  },
  Chips: {
    title: "有効／無効のチップ",
    fit: "2行のチップで、使うもの・使わないものを一覧。理由はホバーで。",
    View: ConfigChips,
  },
  Header: {
    title: "バッジだけの1行",
    fit: "言語・有効な数・設定ファイルをバッジで並べる最小表示。",
    View: ConfigHeader,
  },
} satisfies Record<string, Proposal<ToolProps>>;

/* ---------------- pi_lens_activate_tools ---------------- */

const toolInfo: Record<string, string> = {
  ast_grep_search: "構文で検索",
  ast_grep_replace: "構文で置換",
  ast_grep_outline: "構造の概要",
  lsp_navigation: "定義・参照へ移動",
  lens_diagnostic_mark: "診断の記録",
};
function activateOf(tool: Tool) {
  return {
    requested: list(args(tool).tools),
    added: new Set(list(details(tool).added)),
  };
}

function ActivateToolbox(props: ToolProps) {
  const a = activateOf(props.tool);
  return (
    <Row
      {...props}
      icon={<Wrench size={14} />}
      verb="ツールを追加"
      target={`${a.requested.length} 件`}
      meta="次のターンから"
    >
      <ul className="lx-toolbox">
        {a.requested.map((name) => (
          <li key={name} className={a.added.has(name) ? "lx-new" : undefined}>
            <Wrench size={14} />
            <strong>{toolInfo[name] ?? name}</strong>
            <small>{name}</small>
          </li>
        ))}
      </ul>
    </Row>
  );
}

function ActivateDiff(props: ToolProps) {
  const a = activateOf(props.tool);
  return (
    <Row
      {...props}
      icon={<Plus size={14} />}
      verb="ツールを追加"
      target={a.requested.join(", ")}
      meta={`+${a.added.size}`}
    >
      <pre className="lx-log lx-tool-diff">
        {a.requested.map((name) => (
          <span
            key={name}
            className={a.added.has(name) ? "lx-add-line" : "lx-faint"}
          >
            {a.added.has(name) ? "+ " : "= "}
            {name}
            {"\n"}
          </span>
        ))}
      </pre>
    </Row>
  );
}

function ActivateToast(props: ToolProps) {
  const a = activateOf(props.tool);
  return (
    <div className="lx-toast" data-ui-surface="card">
      {props.phase === "running" ? <Spin size={14} /> : <Check size={14} />}
      <span>
        <strong>
          {props.phase === "done"
            ? `${a.added.size} 個のツールを追加しました`
            : props.phase === "running"
              ? "ツールを追加しています"
              : "ツールを追加できませんでした"}
        </strong>
        <small>
          {props.phase === "done"
            ? `${[...a.added].join("、")} は次のターンから使えます`
            : a.requested.join("、")}
        </small>
      </span>
      {props.phase === "error" && <Phased {...props} />}
    </div>
  );
}

function ActivateHeaderOnly(props: ToolProps) {
  const a = activateOf(props.tool);
  return (
    <Row
      {...props}
      open={false}
      icon={<Plus size={14} />}
      verb="ツールを追加"
      target=""
      meta={
        <span className="lx-chips">
          {a.requested.map((name) => (
            <Badge key={name} tone={a.added.has(name) ? "accent" : "neutral"}>
              {name}
            </Badge>
          ))}
        </span>
      }
    />
  );
}

function ActivateDescribed(props: ToolProps) {
  const a = activateOf(props.tool);
  return (
    <Row
      {...props}
      icon={<Plus size={14} />}
      verb="ツールを追加"
      target={`${a.requested.length} 件`}
      meta="次のターンから"
    >
      <dl className="lx-facts">
        {a.requested.map((name) => (
          <div key={name}>
            <dt>
              <code>{name}</code>
            </dt>
            <dd>
              {toolInfo[name] ?? "—"}
              {!a.added.has(name) && (
                <small className="lx-faint">（有効化済み）</small>
              )}
            </dd>
          </div>
        ))}
      </dl>
    </Row>
  );
}

export const activateProposals = {
  Toolbox: {
    title: "道具箱",
    fit: "ツールを日本語の用途付きのタイルで。新しく増えたものだけ縁取りする。",
    View: ActivateToolbox,
  },
  Diff: {
    title: "差分",
    fit: "+ 追加 / = 既存 をコード差分のように。何が増えたかだけを正確に。",
    View: ActivateDiff,
  },
  Toast: {
    title: "通知風",
    fit: "完了通知のような1枚で、次のターンから使えることを伝える。",
    View: ActivateToast,
  },
  HeaderOnly: {
    title: "見出しだけ",
    fit: "本文を持たず、行の右側にツール名のバッジを並べる。準備操作を最小の高さに。",
    View: ActivateHeaderOnly,
  },
  Described: {
    title: "用途の説明",
    fit: "各ツールが何をするものかを1行ずつ説明する。ツール名に慣れていない人向け。",
    View: ActivateDescribed,
  },
} satisfies Record<string, Proposal<ToolProps>>;
