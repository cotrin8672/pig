import { ChevronRight, RefreshCw } from "lucide-react";
import { type PointerEvent, type ReactNode, useRef, useState } from "react";
import {
  type StatisticsPeriod as Period,
  type StatisticsData,
  type TokenSplit,
  tokenKinds,
} from "../shared/statistics";
import { ContentPage } from "./ContentPage";
import { useFollowTip } from "./follow-tip";
import { useT } from "./i18n";
import "./statistics.css";

function useKinds() {
  const t = useT().statisticsText;
  return tokenKinds.map((id) => ({ id, label: t[id] }));
}
const compact = new Intl.NumberFormat("en", {
  notation: "compact",
  maximumFractionDigits: 1,
});
const tokens = (n: number) => compact.format(n);
const pct = (part: number, whole: number) =>
  whole ? `${((part / whole) * 100).toFixed(1)}%` : "—";
const sum = (s: TokenSplit) => s.input + s.output + s.cacheRead + s.cacheWrite;
const zero: TokenSplit = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
const shortDay = (day: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(day)
    ? `${Number(day.slice(5, 7))}/${Number(day.slice(8, 10))}`
    : day;

function Summary({ data }: { data: StatisticsData }) {
  const t = useT().statisticsText;
  const kinds = useKinds();
  const all = { ...zero };
  for (const m of data.models)
    for (const k of kinds) all[k.id] += m.tokens[k.id];
  const total = sum(all);
  const inputSide = all.input + all.cacheRead + all.cacheWrite;
  return (
    <dl className="stats-summary" data-ui-surface="card">
      <div>
        <dt>{t.total}</dt>
        <dd>{tokens(total)}</dd>
      </div>
      {kinds.map((k) => (
        <div key={k.id}>
          <dt>{k.label}</dt>
          <dd>
            {tokens(all[k.id])}
            <small>{pct(all[k.id], total)}</small>
          </dd>
        </div>
      ))}
      <div>
        <dt aria-description={t.cacheRateHint}>{t.cacheRate}</dt>
        <dd>{pct(all.cacheRead, inputSide)}</dd>
      </div>
    </dl>
  );
}

/** Daily total tokens stacked by model; the model table is the legend. */
function DailyChart({ data }: { data: StatisticsData }) {
  const t = useT().statisticsText;
  // Centred on the column, just inside its top.
  const tip = useFollowTip<number>("bottom");
  const { active, open, leave } = tip;
  const step = Math.max(1, Math.ceil(data.days.length / 14));
  const columns = data.days
    .filter((_, d) => d % step === 0)
    .map((day, index) => {
      const d = index * step;
      const parts = data.models.map((m, i) => ({
        model: m,
        color: i % 6,
        value: (data.daily[m.id]?.slice(d, d + step) ?? []).reduce(
          (n, split) => n + sum(split),
          0,
        ),
      }));
      const end = data.days[Math.min(d + step - 1, data.days.length - 1)];
      return {
        day,
        range: step > 1 ? `${day} – ${end}` : day,
        parts,
        total: parts.reduce((n, p) => n + p.value, 0),
      };
    });
  const max = Math.max(0, ...columns.map((c) => c.total));
  return (
    <section className="stats-panel stats-daily" data-ui-surface="card">
      <h2>
        {t.daily}
        {step > 1 && <span>{t.bucketDays(step)}</span>}
      </h2>
      {max ? (
        <div className="stats-chart">
          <div className="stats-gridlines" aria-hidden="true">
            {[max, max / 2, 0].map((t) => (
              <span key={t}>{tokens(t)}</span>
            ))}
          </div>
          <div className="stats-columns">
            {columns.map((c, index) => (
              <div key={c.day} className="stats-column">
                <button
                  type="button"
                  className="stats-bar-area"
                  aria-label={`${c.range}: ${tokens(c.total)}`}
                  aria-describedby={tip.describedBy(index)}
                  onPointerEnter={(e) => {
                    const el = e.currentTarget;
                    open(index, () => el.getBoundingClientRect());
                  }}
                  onPointerLeave={leave}
                  onFocus={(e) => {
                    const el = e.currentTarget;
                    if (el.matches(":focus-visible"))
                      open(index, () => el.getBoundingClientRect());
                  }}
                  onBlur={leave}
                >
                  <div
                    className="stats-stack"
                    style={{ height: `${(c.total / max) * 100}%` }}
                  >
                    {c.parts.map((p) => (
                      <span
                        key={p.model.id}
                        data-model={p.color}
                        style={{ flexGrow: p.value }}
                      />
                    ))}
                  </div>
                </button>
                <span className="stats-day">{shortDay(c.day)}</span>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <Empty />
      )}
      {active !== null && columns[active] && (
        <div
          {...tip.panelProps}
          className="stats-tip ui-tooltip ui-tooltip-follow"
        >
          <div key={active} className="ui-tooltip-swap">
            <strong>{columns[active].range}</strong>
            {columns[active].parts.map((p) => (
              <span key={p.model.id} data-model={p.color}>
                {p.model.name}
                <b>{tokens(p.value)}</b>
              </span>
            ))}
            <span className="stats-tip-total">
              {t.totalLabel}
              <b>{tokens(columns[active].total)}</b>
            </span>
          </div>
        </div>
      )}
    </section>
  );
}

/** ccusage-style: exact per-model numbers; swatches double as chart legend. */
function ModelTable({ data }: { data: StatisticsData }) {
  const t = useT().statisticsText;
  const kinds = useKinds();
  const total = data.models.reduce((n, m) => n + sum(m.tokens), 0);
  return (
    <section className="stats-panel stats-models" data-ui-surface="card">
      <h2>{t.models}</h2>
      {data.models.length ? (
        <div className="stats-scroll">
          <table className="stats-table">
            <thead>
              <tr>
                <th scope="col">{t.models}</th>
                {kinds.map((k) => (
                  <th key={k.id} scope="col">
                    {k.label}
                  </th>
                ))}
                <th scope="col">{t.totalColumn}</th>
                <th scope="col">{t.modelShare}</th>
                <th scope="col" aria-description={t.speedHint}>
                  token/s
                </th>
              </tr>
            </thead>
            <tbody>
              {data.models.map((m, i) => (
                <tr key={m.id}>
                  <th scope="row" aria-description={m.id}>
                    <span className="stats-swatch" data-model={i % 6} />
                    {m.name}
                  </th>
                  {kinds.map((k) => (
                    <td key={k.id}>{tokens(m.tokens[k.id])}</td>
                  ))}
                  <td className="strong">{tokens(sum(m.tokens))}</td>
                  <td>{pct(sum(m.tokens), total)}</td>
                  <td
                    aria-description={t.speedSamples(
                      m.measuredRequests,
                      m.requests,
                    )}
                  >
                    {m.tokensPerSecond === null
                      ? "—"
                      : Math.round(m.tokensPerSecond)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <Empty />
      )}
    </section>
  );
}

function Share({ part, whole }: { part: number; whole: number }) {
  return (
    <span className="stats-share">
      <span className="stats-share-bar">
        <span style={{ width: `${whole ? (part / whole) * 100 : 0}%` }} />
      </span>
      {pct(part, whole)}
    </span>
  );
}

/** Where the initial context goes: each system prompt section, then tool declarations per extension. */
function ContextTable({ data }: { data: StatisticsData }) {
  const t = useT().statisticsText;
  const [open, setOpen] = useState<ReadonlySet<string | null>>(new Set());
  const { sections, sources } = data.initialContext;
  const system = sections.reduce((n, s) => n + s.tokens, 0);
  const declared = sources.reduce((n, s) => n + s.tokens, 0);
  const total = system + declared;
  if (!total) return <Empty />;
  const sectionLabel = (id: string) =>
    id in t.sections ? (
      t.sections[id as keyof typeof t.sections]
    ) : (
      <code>{id}</code>
    );
  const row = (
    key: string,
    label: ReactNode,
    value: number,
    className?: string,
  ) => (
    <tr key={key} className={className}>
      <th scope="row">{label}</th>
      <td>
        <Share part={value} whole={total} />
      </td>
      <td className={className === "stats-group" ? "strong" : ""}>
        {tokens(value)}
      </td>
    </tr>
  );
  return (
    <div className="stats-scroll">
      <table className="stats-table stats-context">
        <thead>
          <tr>
            <th scope="col">{t.item}</th>
            <th scope="col">{t.modelShare}</th>
            <th scope="col">tokens</th>
          </tr>
        </thead>
        <tbody>
          {row("system", t.systemPrompt, system, "stats-group")}
          {[...sections]
            .sort((a, b) => b.tokens - a.tokens)
            .map((s) => row(`s:${s.id}`, sectionLabel(s.id), s.tokens))}
          {row("tools", t.toolDefinitions, declared, "stats-group")}
          {sources.flatMap((s) => {
            const expanded = open.has(s.id);
            const label = (
              <button
                key="label"
                type="button"
                className="stats-expand"
                aria-expanded={expanded}
                onClick={() =>
                  setOpen((prev) => {
                    const next = new Set(prev);
                    if (!next.delete(s.id)) next.add(s.id);
                    return next;
                  })
                }
              >
                <ChevronRight size={12} aria-hidden="true" />
                <span>
                  {s.id === null
                    ? t.unknownSource
                    : s.id === "builtin"
                      ? t.builtinSource
                      : s.id}
                </span>
                <small>{s.tools.length}</small>
              </button>
            );
            return [
              row(`x:${s.id}`, label, s.tokens),
              ...(expanded
                ? s.tools.map((tool) =>
                    row(
                      `t:${s.id}:${tool.name}`,
                      <code>{tool.name}</code>,
                      tool.tokens,
                      "stats-nested",
                    ),
                  )
                : []),
            ];
          })}
        </tbody>
      </table>
    </div>
  );
}

/** Ranked by failures: repeated failing commands cost retries and output. */
function CommandTable({ data }: { data: StatisticsData }) {
  const t = useT().statisticsText;
  const { rows, unclassified, unmeasured } = data.commands;
  return (
    <section className="stats-panel stats-commands" data-ui-surface="card">
      <h2>
        {t.commands}
        <span aria-description={t.commandCoverageHint}>
          {t.commandCoverage(unclassified, unmeasured)}
        </span>
      </h2>
      {rows.length ? (
        <div className="stats-scroll">
          <table className="stats-table">
            <thead>
              <tr>
                <th scope="col">{t.command}</th>
                <th scope="col">{t.runs}</th>
                <th scope="col">{t.failures}</th>
                <th scope="col" aria-description={t.commandSuccessHint}>
                  {t.success}
                </th>
                <th scope="col" aria-description={t.unknownHint}>
                  {t.unknownOutcome}
                </th>
                <th scope="col" aria-description={t.sdkErrorsHint}>
                  {t.sdkErrors}
                </th>
                <th scope="col" aria-description={t.failureOutputHint}>
                  {t.failureOutput}
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const known = r.calls - r.unknown;
                const ok = known - r.failures;
                return (
                  <tr key={`${r.shell}:${r.command}`}>
                    <th scope="row">
                      <code>{r.command}</code>
                      <small className="stats-shell">{r.shell}</small>
                    </th>
                    <td>{r.calls.toLocaleString()}</td>
                    <td className={r.failures ? "strong" : ""}>
                      {r.failures.toLocaleString()}
                    </td>
                    <td className={known && ok / known < 0.9 ? "warn" : ""}>
                      {pct(ok, known)}
                    </td>
                    <td>{r.unknown.toLocaleString()}</td>
                    <td>{r.sdkErrors.toLocaleString()}</td>
                    <td>
                      {r.failureBytes ? `${tokens(r.failureBytes)}B` : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <Empty />
      )}
    </section>
  );
}

function ToolTable({ data }: { data: StatisticsData }) {
  const t = useT().statisticsText;
  const [view, setView] = useState<"tools" | "context">("tools");
  const calls = data.tools.reduce((n, t) => n + t.calls, 0);
  return (
    <section className="stats-panel stats-tools" data-ui-surface="card">
      <h2>
        <fieldset className="stats-periods stats-tabs">
          {(["tools", "context"] as const).map((id) => (
            <button
              key={id}
              type="button"
              aria-pressed={view === id}
              className={view === id ? "active" : ""}
              onClick={() => setView(id)}
            >
              {id === "tools" ? t.tools : t.contextBreakdown}
            </button>
          ))}
        </fieldset>
        <span>
          {view === "tools"
            ? t.calls(calls)
            : `${tokens(
                [
                  ...data.initialContext.sections,
                  ...data.initialContext.sources,
                ].reduce((n, s) => n + s.tokens, 0),
              )} tokens`}
        </span>
      </h2>
      {view === "context" ? (
        <ContextTable data={data} />
      ) : data.tools.length ? (
        <div className="stats-scroll">
          <table className="stats-table">
            <thead>
              <tr>
                <th scope="col">{t.tools}</th>
                <th scope="col">{t.share}</th>
                <th scope="col">{t.failures}</th>
                <th scope="col">{t.success}</th>
                <th scope="col" aria-description={t.definitionHint}>
                  {t.definition}
                </th>
              </tr>
            </thead>
            <tbody>
              {[...data.tools]
                .sort((a, b) => b.calls - a.calls)
                .map((t) => {
                  const rate = t.calls ? (t.calls - t.failures) / t.calls : 1;
                  return (
                    <tr key={t.tool}>
                      <th scope="row">
                        <code>{t.tool}</code>
                      </th>
                      <td aria-description={`${t.calls.toLocaleString()}`}>
                        <Share part={t.calls} whole={calls} />
                      </td>
                      <td>{t.failures.toLocaleString()}</td>
                      <td className={rate < 0.9 ? "warn" : ""}>
                        {t.calls ? pct(t.calls - t.failures, t.calls) : "—"}
                      </td>
                      <td>
                        {t.definitionTokens === null
                          ? "—"
                          : tokens(t.definitionTokens)}
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
      ) : (
        <Empty />
      )}
    </section>
  );
}

type Slice = { id: string; label: string; value: number; color: string };

const RING_R = 15.9155; // viewBox 42, circumference 100
const RING_WIDTH = 3.2;

/**
 * Donut with its legend and values next to it: no hover needed to read it.
 * Hovering a slice or its legend row highlights both and opens the shared
 * follow tooltip at the slice; moving on glides it to the next slice.
 */
function Donut({
  title,
  note,
  slices,
  center,
  centerLabel,
}: {
  title: string;
  note?: string;
  slices: Slice[];
  center: string;
  centerLabel: string;
}) {
  const total = slices.reduce((n, s) => n + s.value, 0);
  const r = RING_R;
  let offset = 25;
  // A small gap separates slices like the 1px seams elsewhere in the UI.
  const gap = slices.filter((s) => s.value > 0).length > 1 ? 1 : 0;
  const ring = useRef<SVGSVGElement>(null);
  const tip = useFollowTip<string>("top");
  // Clockwise from 12 o'clock, in percent of the circumference.
  let start = 0;
  const arcs = slices.map((s) => {
    const length = total ? (s.value / total) * 100 : 0;
    const arc = { slice: s, start, length };
    start += length;
    return arc;
  });
  /** The ring's drawn centre and scale (the SVG keeps its square aspect). */
  const frame = () => {
    const box = ring.current?.getBoundingClientRect();
    if (!box) return;
    const scale = Math.min(box.width, box.height) / 42;
    return {
      x: box.left + box.width / 2,
      y: box.top + box.height / 2,
      scale,
    };
  };
  const midpoint = (arc: (typeof arcs)[number]) => () => {
    const f = frame();
    if (!f) return new DOMRect();
    const angle = ((arc.start + arc.length / 2) / 100) * 2 * Math.PI;
    return new DOMRect(
      f.x + Math.sin(angle) * r * f.scale,
      f.y - Math.cos(angle) * r * f.scale,
    );
  };
  const hit = (event: PointerEvent) => {
    const f = frame();
    if (!f) return;
    const dx = event.clientX - f.x;
    const dy = event.clientY - f.y;
    // Slightly wider than the stroke so thin slices remain hoverable.
    if (Math.abs(Math.hypot(dx, dy) / f.scale - r) > RING_WIDTH / 2 + 1) {
      if (tip.active !== null) tip.leave();
      return;
    }
    const at = ((Math.atan2(dx, -dy) / (2 * Math.PI)) * 100 + 100) % 100;
    const arc = arcs.find(
      (a) => a.length > 0 && at >= a.start && at < a.start + a.length,
    );
    if (arc) tip.open(arc.slice.id, midpoint(arc));
  };
  const shown = arcs.find((a) => a.slice.id === tip.active);
  return (
    <figure className="stats-donut">
      <figcaption>
        {title}
        {note && <span>{note}</span>}
      </figcaption>
      {total ? (
        <div className="stats-donut-body">
          <div className="stats-donut-ring">
            <svg
              ref={ring}
              viewBox="0 0 42 42"
              aria-hidden="true"
              onPointerMove={hit}
              onPointerLeave={tip.leave}
            >
              <circle cx="21" cy="21" r={r} className="track" />
              {slices.map((s) => {
                const length = (s.value / total) * 100;
                const arc = (
                  <circle
                    key={s.id}
                    cx="21"
                    cy="21"
                    r={r}
                    data-slice={s.color}
                    data-active={tip.active === s.id || undefined}
                    strokeDasharray={`${Math.max(length - gap, 0)} ${100 - Math.max(length - gap, 0)}`}
                    strokeDashoffset={offset}
                  />
                );
                offset -= length;
                return arc;
              })}
            </svg>
            <span>
              <strong>{center}</strong>
              {centerLabel}
            </span>
          </div>
          <ul className="stats-donut-legend">
            {arcs.map(({ slice: s, ...arc }) => (
              <li
                key={s.id}
                data-slice={s.color}
                data-active={tip.active === s.id || undefined}
                onPointerEnter={() => {
                  if (arc.length > 0)
                    tip.open(s.id, midpoint({ slice: s, ...arc }));
                }}
                onPointerLeave={tip.leave}
              >
                <span>{s.label}</span>
                <b>{tokens(s.value)}</b>
                <small>{pct(s.value, total)}</small>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <Empty />
      )}
      {shown && (
        <div
          {...tip.panelProps}
          className="stats-tip ui-tooltip ui-tooltip-follow"
        >
          <div key={shown.slice.id} className="ui-tooltip-swap">
            <span data-slice={shown.slice.color}>
              {shown.slice.label}
              <b>
                {tokens(shown.slice.value)} · {pct(shown.slice.value, total)}
              </b>
            </span>
          </div>
        </div>
      )}
    </figure>
  );
}

function Composition({ data }: { data: StatisticsData }) {
  const t = useT().statisticsText;
  const kinds = useKinds();
  const all = { ...zero };
  for (const m of data.models)
    for (const k of kinds) all[k.id] += m.tokens[k.id];
  const requests = data.models.reduce((n, m) => n + m.requests, 0);
  const partial = data.coverage.unknownUsage > 0;
  const divisor = partial ? 1 : requests;
  const context = data.initialContext;
  const estimated = context.parts.reduce((n, p) => n + p.tokens, 0);
  const initial = context.measuredTotal ?? estimated;
  return (
    <section className="stats-panel stats-composition" data-ui-surface="card">
      <Donut
        title={t.mix}
        note={partial ? t.knownTotals : t.average}
        center={divisor ? tokens(sum(all) / divisor) : "—"}
        centerLabel="tokens"
        slices={kinds.map((k) => ({
          id: k.id,
          label: k.label,
          value: divisor ? all[k.id] / divisor : 0,
          color: `kind-${k.id}`,
        }))}
      />
      <Donut
        title={t.initial}
        note={context.parts.length ? t.estimated : t.unmeasured}
        center={initial ? tokens(initial) : "—"}
        centerLabel={
          context.contextWindow
            ? t.used(pct(initial, context.contextWindow))
            : ""
        }
        slices={context.parts.map((p, i) => ({
          id: p.id,
          label:
            {
              tools: t.toolDefinitions,
              toolPrompts: t.toolPrompts,
              base: t.base,
              agents: t.agents,
              skills: t.skills,
              extensions: t.extensions,
              other: t.other,
            }[p.id] ?? p.label,
          value: p.tokens,
          color: `part-${i}`,
        }))}
      />
    </section>
  );
}
const Empty = () => (
  <p className="muted stats-empty">{useT().statisticsText.noRecords}</p>
);

/** One-screen overview: every section visible at once, no tabs. */
export function StatisticsView({
  data,
  period,
  onPeriod,
  onRefresh,
  busy = false,
  status,
}: {
  data: StatisticsData;
  period: Period;
  onPeriod: (period: Period) => void;
  onRefresh?: () => void;
  busy?: boolean;
  status?: ReactNode;
}) {
  const t = useT();
  const text = t.statisticsText;
  const periods = ["today", "7d", "30d", "all"] as const;
  return (
    <ContentPage
      title={t.Statistics}
      className="statistics-overview"
      actions={
        <div className="stats-header">
          {status && <span className="muted">{status}</span>}
          <fieldset className="stats-periods" aria-label={text.period}>
            {periods.map((p) => (
              <button
                key={p}
                type="button"
                aria-pressed={period === p}
                className={period === p ? "active" : ""}
                onClick={() => onPeriod(p)}
              >
                {text[p]}
              </button>
            ))}
          </fieldset>
          {onRefresh && (
            <button
              type="button"
              className="stats-refresh sidebar-icon"
              onClick={onRefresh}
              disabled={busy}
              aria-label={text.refresh}
            >
              <RefreshCw size={14} aria-hidden="true" />
            </button>
          )}
        </div>
      }
    >
      <div className="statistics-page" aria-busy={busy}>
        <Summary data={data} />
        <DailyChart data={data} />
        <CommandTable data={data} />
        <div className="stats-side">
          <ToolTable data={data} />
          <Composition data={data} />
        </div>
        <ModelTable data={data} />
      </div>
    </ContentPage>
  );
}
