import { RefreshCw } from "lucide-react";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import {
  type StatisticsPeriod as Period,
  type StatisticsData,
  type TokenSplit,
  tokenKinds,
} from "../shared/statistics";
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
        <dt title={t.cacheRateHint}>{t.cacheRate}</dt>
        <dd>{pct(all.cacheRead, inputSide)}</dd>
      </div>
    </dl>
  );
}

/** Daily total tokens stacked by model; the model table is the legend. */
function DailyChart({ data }: { data: StatisticsData }) {
  const t = useT().statisticsText;
  const tooltipId = useId();
  const popup = useRef<HTMLDivElement>(null);
  const anchor = useRef<HTMLButtonElement | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [active, setActive] = useState<number | null>(null);
  const close = useCallback(() => {
    clearTimeout(timer.current);
    setActive(null);
  }, []);
  const leave = () => {
    clearTimeout(timer.current);
    timer.current = setTimeout(close, 150);
  };
  const open = (index: number, button: HTMLButtonElement) => {
    clearTimeout(timer.current);
    anchor.current = button;
    setActive(index);
  };
  useEffect(() => {
    const dismiss = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("resize", close);
    document.addEventListener("scroll", close, true);
    document.addEventListener("keydown", dismiss);
    return () => {
      clearTimeout(timer.current);
      window.removeEventListener("resize", close);
      document.removeEventListener("scroll", close, true);
      document.removeEventListener("keydown", dismiss);
    };
  }, [close]);
  useLayoutEffect(() => {
    const panel = popup.current;
    const button = anchor.current;
    if (active === null || !panel || !button) return;
    panel.showPopover();
    const box = button.getBoundingClientRect();
    const bounds = panel.getBoundingClientRect();
    panel.style.left = `${Math.max(8, Math.min(box.left + box.width / 2 - bounds.width / 2, innerWidth - bounds.width - 8))}px`;
    panel.style.top = `${Math.max(8, Math.min(box.top + 8, innerHeight - bounds.height - 8))}px`;
  }, [active]);
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
                  aria-describedby={active === index ? tooltipId : undefined}
                  onPointerEnter={(e) => open(index, e.currentTarget)}
                  onPointerLeave={leave}
                  onFocus={(e) => {
                    if (e.currentTarget.matches(":focus-visible"))
                      open(index, e.currentTarget);
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
          ref={popup}
          id={tooltipId}
          popover="manual"
          className="stats-tip"
          role="tooltip"
          onPointerEnter={() => clearTimeout(timer.current)}
          onPointerLeave={leave}
        >
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
                <th scope="col" title={t.speedHint}>
                  token/s
                </th>
              </tr>
            </thead>
            <tbody>
              {data.models.map((m, i) => (
                <tr key={m.id}>
                  <th scope="row" title={m.id}>
                    <span className="stats-swatch" data-model={i % 6} />
                    {m.name}
                  </th>
                  {kinds.map((k) => (
                    <td key={k.id}>{tokens(m.tokens[k.id])}</td>
                  ))}
                  <td className="strong">{tokens(sum(m.tokens))}</td>
                  <td>{pct(sum(m.tokens), total)}</td>
                  <td title={t.speedSamples(m.measuredRequests, m.requests)}>
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

function ToolTable({ data }: { data: StatisticsData }) {
  const t = useT().statisticsText;
  const calls = data.tools.reduce((n, t) => n + t.calls, 0);
  return (
    <section className="stats-panel stats-tools" data-ui-surface="card">
      <h2>
        {t.tools}
        <span>{t.calls(calls)}</span>
      </h2>
      {data.tools.length ? (
        <div className="stats-scroll">
          <table className="stats-table">
            <thead>
              <tr>
                <th scope="col">{t.tools}</th>
                <th scope="col">{t.share}</th>
                <th scope="col">{t.failures}</th>
                <th scope="col">{t.success}</th>
                <th scope="col" title={t.definitionHint}>
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
                      <td title={`${t.calls.toLocaleString()}`}>
                        <span className="stats-share">
                          <span className="stats-share-bar">
                            <span
                              style={{
                                width: `${calls ? (t.calls / calls) * 100 : 0}%`,
                              }}
                            />
                          </span>
                          {pct(t.calls, calls)}
                        </span>
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

/** Donut with its legend and values next to it: no hover needed to read it. */
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
  const r = 15.9155; // circumference 100
  let offset = 25;
  // A small gap separates slices like the 1px seams elsewhere in the UI.
  const gap = slices.filter((s) => s.value > 0).length > 1 ? 1 : 0;
  return (
    <figure className="stats-donut">
      <figcaption>
        {title}
        {note && <span>{note}</span>}
      </figcaption>
      {total ? (
        <div className="stats-donut-body">
          <div className="stats-donut-ring">
            <svg viewBox="0 0 42 42" aria-hidden="true">
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
            {slices.map((s) => (
              <li key={s.id} data-slice={s.color}>
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
            p.id === "tools"
              ? t.toolDefinitions
              : p.id === "base"
                ? t.base
                : p.id === "agents"
                  ? t.agents
                  : p.id === "skills"
                    ? t.skills
                    : p.id === "extensions"
                      ? t.extensions
                      : p.id === "other"
                        ? t.other
                        : p.label,
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
    <div className="stats-container">
      <div className="statistics-page" aria-busy={busy}>
        <header className="stats-header">
          <h1>{t.Statistics}</h1>
          <span className="muted">
            {status ??
              (data.collectingSince
                ? text.since(data.collectingSince)
                : text.noRecords)}
          </span>
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
              title={text.refresh}
              aria-label={text.refresh}
            >
              <RefreshCw size={14} aria-hidden="true" />
            </button>
          )}
        </header>
        <Summary data={data} />
        <DailyChart data={data} />
        <div className="stats-side">
          <ToolTable data={data} />
          <Composition data={data} />
        </div>
        <ModelTable data={data} />
      </div>
    </div>
  );
}
