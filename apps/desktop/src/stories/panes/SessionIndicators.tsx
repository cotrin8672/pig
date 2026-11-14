import {
  ArrowUp,
  Bot,
  ChevronDown,
  Info,
  type LucideIcon,
  PanelRightClose,
  PanelRightOpen,
  PanelTop,
  Terminal,
  X,
} from "lucide-react";
import {
  type ReactNode,
  type RefObject,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import "../../mainview/panes.css";
import {
  dotClass,
  headline,
  isEmpty,
  needsUser,
  paneFixtures,
  type RunState,
  type SectionKey,
  type SessionInfo,
  sectionCount,
  sectionState,
} from "./indicator-data";
import "./indicators.css";

export type IndicatorVariant =
  | "dock"
  | "rail"
  | "island"
  | "inline"
  | "inspector";

const sectionMeta: Record<SectionKey, { label: string; icon: LucideIcon }> = {
  status: { label: "ステータス", icon: Info },
  widgets: { label: "ウィジェット", icon: PanelTop },
  tasks: { label: "バックグラウンド", icon: Terminal },
  agents: { label: "サブエージェント", icon: Bot },
};
const allSections: SectionKey[] = ["status", "widgets", "tasks", "agents"];
const presentSections = (info: SessionInfo, keys = allSections) =>
  keys.filter((key) => sectionCount(info, key) > 0);

function Dot({ state }: { state?: RunState }) {
  return state ? (
    <span className={`session-dot ${dotClass[state]}`} aria-hidden="true" />
  ) : null;
}

/* ---------------- shared content ---------------- */

/** The same rows are reused by every proposal; only the entry point differs. */
export function Sections({
  info,
  only,
}: {
  info: SessionInfo;
  only?: SectionKey;
}) {
  const keys = presentSections(info, only ? [only] : allSections);
  return (
    <div className="si-sections">
      {keys.map((key) => {
        const { label, icon: Icon } = sectionMeta[key];
        return (
          <section key={key} className="si-section">
            <h3>
              <Icon size={13} aria-hidden="true" />
              {label}
              <span className="si-count">{sectionCount(info, key)}</span>
            </h3>
            {key === "status" && (
              <dl className="si-status-list">
                {info.statuses.map((status) => (
                  <div key={status.key}>
                    <dt>{status.key}</dt>
                    <dd>{status.text}</dd>
                  </div>
                ))}
              </dl>
            )}
            {key === "widgets" &&
              info.widgets.map((widget) => (
                <figure key={widget.key} className="si-widget">
                  <figcaption>{widget.key}</figcaption>
                  <pre>{widget.lines.join("\n")}</pre>
                </figure>
              ))}
            {key === "tasks" && (
              <ul className="si-rows">
                {info.tasks.map((task) => (
                  <li key={task.id} className="si-row" data-state={task.state}>
                    <Dot state={task.state} />
                    <code className="si-row-name" title={task.command}>
                      {task.command}
                    </code>
                    <small className="si-row-meta">
                      {task.exit !== undefined && task.state !== "running"
                        ? `exit ${task.exit} · `
                        : ""}
                      {task.elapsed}
                    </small>
                    <span
                      className="si-row-detail"
                      title={task.output.join("\n")}
                    >
                      {task.output.at(-1)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {key === "agents" && (
              <ul className="si-rows">
                {info.agents.map((agent) => (
                  <li
                    key={agent.id}
                    className="si-row"
                    data-state={agent.state}
                  >
                    <Dot state={agent.state} />
                    <span className="si-row-name">
                      <strong>{agent.name}</strong> {agent.task}
                    </span>
                    <small className="si-row-meta">{agent.elapsed}</small>
                    <span className="si-row-detail">
                      {agent.step ?? agent.model}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}

/** Closes on Escape and outside pointer; returns focus to the trigger. */
function useDismiss(
  ref: RefObject<HTMLElement | null>,
  open: boolean,
  close: () => void,
) {
  const latest = useRef(close);
  latest.current = close;
  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) latest.current();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      latest.current();
      ref.current?.querySelector<HTMLElement>("[aria-expanded=true]")?.focus();
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, ref]);
}

function useWidth(ref: RefObject<HTMLElement | null>) {
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setWidth(element.clientWidth));
    observer.observe(element);
    setWidth(element.clientWidth);
    return () => observer.disconnect();
  }, [ref]);
  return width;
}

/** One button per non-empty section: icon, count, and a state dot when live. */
function Counters({
  info,
  keys,
  open,
  onToggle,
  shape,
}: {
  info: SessionInfo;
  keys: SectionKey[];
  open: SectionKey | null;
  onToggle(key: SectionKey): void;
  shape: "pill" | "square";
}) {
  return presentSections(info, keys).map((key) => {
    const { label, icon: Icon } = sectionMeta[key];
    const count = sectionCount(info, key);
    const state = sectionState(info, key);
    return (
      <button
        type="button"
        key={key}
        className={`si-counter si-counter-${shape}`}
        data-state={state}
        aria-expanded={open === key}
        aria-label={`${label} ${count}件`}
        title={label}
        onClick={() => onToggle(key)}
      >
        <Icon size={shape === "square" ? 15 : 13} aria-hidden="true" />
        <span className="si-counter-count">{count}</span>
        {state && <Dot state={state} />}
      </button>
    );
  });
}

/* ---------------- proposals ---------------- */

/** A: a one-line strip riding on top of the composer, expanding upwards. */
type EntryProps = { info: SessionInfo; initial?: SectionKey | null };
function DockStrip({ info, initial = null }: EntryProps) {
  const [open, setOpen] = useState<SectionKey | null>(initial);
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(ref, !!open, () => setOpen(null));
  if (isEmpty(info)) return null;
  const top = headline(info);
  return (
    <div className="si-dock" ref={ref}>
      {open && (
        <div className="si-flyout si-dock-flyout">
          <Sections info={info} only={open} />
        </div>
      )}
      <div className="si-dock-strip">
        <span className="si-dock-lead">
          {top?.state && <Dot state={top.state} />}
          {info.statuses.map((status) => (
            <span
              key={status.key}
              className="si-status-text"
              title={status.key}
            >
              {status.text}
            </span>
          ))}
        </span>
        <span className="si-counter-group">
          <Counters
            info={info}
            keys={["widgets", "tasks", "agents"]}
            open={open}
            onToggle={(key) => setOpen(open === key ? null : key)}
            shape="pill"
          />
        </span>
      </div>
    </div>
  );
}

/** B: a vertical icon rail under the pane close button. */
function Rail({
  info,
  initial = null,
  extra,
}: EntryProps & { extra?: ReactNode }) {
  const [open, setOpen] = useState<SectionKey | null>(initial);
  const ref = useRef<HTMLElement>(null);
  useDismiss(ref, !!open, () => setOpen(null));
  if (isEmpty(info)) return null;
  return (
    <nav className="si-rail" ref={ref} aria-label="セッション情報">
      <Counters
        info={info}
        keys={allSections}
        open={open}
        onToggle={(key) => setOpen(open === key ? null : key)}
        shape="square"
      />
      {extra}
      {open && (
        <div className="si-flyout si-rail-flyout">
          <Sections info={info} only={open} />
        </div>
      )}
    </nav>
  );
}

/** C: a floating pill at the top of the pane with the single most urgent item. */
function Island({ info, initial }: EntryProps) {
  const [open, setOpen] = useState(!!initial);
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(ref, open, () => setOpen(false));
  const top = headline(info);
  if (isEmpty(info) || !top) return null;
  const live =
    info.tasks.filter((task) => task.state === "running").length +
    info.agents.filter((agent) => agent.state === "running").length;
  const attention = [...info.tasks, ...info.agents].filter((run) =>
    needsUser(run.state),
  ).length;
  return (
    <div className="si-island" ref={ref}>
      <button
        type="button"
        className="si-island-pill"
        data-state={top.state}
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <Dot state={top.state} />
        <span className="si-island-text">{top.text}</span>
        {live + attention > 1 && (
          <span className="si-island-more">+{live + attention - 1}</span>
        )}
        <ChevronDown size={12} aria-hidden="true" />
      </button>
      {open && (
        <div className="si-flyout si-island-flyout">
          <Sections info={info} />
        </div>
      )}
    </div>
  );
}

/** D: counters inside the composer toolbar, opening like the model picker. */
function InlineIndicators({ info, initial = null }: EntryProps) {
  const [open, setOpen] = useState<SectionKey | null>(initial);
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(ref, !!open, () => setOpen(null));
  if (isEmpty(info)) return <span className="si-inline" />;
  return (
    <div className="si-inline" ref={ref}>
      <Counters
        info={info}
        keys={["tasks", "agents", "widgets", "status"]}
        open={open}
        onToggle={(key) => setOpen(open === key ? null : key)}
        shape="pill"
      />
      {info.statuses.map((status) => (
        <span
          key={status.key}
          className="si-status-text si-inline-status"
          title={status.key}
        >
          {status.text}
        </span>
      ))}
      {open && (
        <div className="si-flyout si-inline-flyout">
          <Sections info={info} only={open} />
        </div>
      )}
    </div>
  );
}

/** E: a collapsible inspector column for wide panes; falls back to the rail. */
function Inspector({
  info,
  open,
  onToggle,
}: {
  info: SessionInfo;
  open: boolean;
  onToggle(): void;
}) {
  return (
    <aside className="si-inspector" aria-label="セッション情報">
      <header>
        <button
          type="button"
          className="si-icon-button"
          aria-label="インスペクタを閉じる"
          title="インスペクタを閉じる"
          aria-expanded={open}
          onClick={onToggle}
        >
          <PanelRightClose size={15} />
        </button>
        <strong>セッション</strong>
      </header>
      <div className="si-inspector-scroll">
        <Sections info={info} />
      </div>
    </aside>
  );
}

/* ---------------- pane stage ---------------- */

function MockPane({
  info,
  variant,
  closable,
  style,
  initial,
}: {
  info: SessionInfo;
  variant: IndicatorVariant;
  closable: boolean;
  style: React.CSSProperties;
  initial?: SectionKey | null;
}) {
  const pane = useRef<HTMLElement>(null);
  const width = useWidth(pane);
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const wide = width >= 760;
  const showInspector =
    variant === "inspector" && wide && inspectorOpen && !isEmpty(info);
  const railLike =
    variant === "rail" || (variant === "inspector" && !showInspector);
  return (
    <section
      ref={pane}
      className="pane-view si-pane"
      data-variant={variant}
      aria-label={info.title}
      style={style}
    >
      <div className="si-pane-body">
        <div className="si-chat" data-rail={railLike || undefined}>
          <section
            className="thread-scroll si-thread"
            // biome-ignore lint/a11y/noNoninteractiveTabindex: Independently scrollable history must be keyboard-accessible.
            tabIndex={0}
            aria-label={`${info.title}の会話履歴`}
          >
            {info.prompt ? (
              <div className="transcript">
                <div className="message user">
                  <div className="user-bubble">{info.prompt}</div>
                </div>
                <div className="message assistant">
                  <p>{info.response}</p>
                  <p className="muted">{info.model}</p>
                </div>
              </div>
            ) : (
              <div className="chat-empty">
                <h1>何を作りましょうか？</h1>
              </div>
            )}
          </section>
          {variant === "island" && <Island info={info} initial={initial} />}
          {railLike && (
            <Rail
              info={info}
              initial={initial}
              extra={
                variant === "inspector" &&
                wide && (
                  <button
                    type="button"
                    className="si-counter si-counter-square"
                    aria-label="インスペクタを開く"
                    title="インスペクタを開く"
                    onClick={() => setInspectorOpen(true)}
                  >
                    <PanelRightOpen size={15} />
                  </button>
                )
              }
            />
          )}
          <div className="composer-dock si-composer-dock">
            {variant === "dock" && <DockStrip info={info} initial={initial} />}
            <div className="composer">
              <textarea
                aria-label="メッセージ（プレビュー）"
                placeholder="メッセージを入力…"
              />
              <div className="composer-toolbar">
                {variant === "inline" && (
                  <InlineIndicators info={info} initial={initial} />
                )}
                <span className="muted si-model">
                  {info.model}
                  <ChevronDown size={12} aria-hidden="true" />
                </span>
                <button
                  type="button"
                  className="send-button"
                  aria-label="送信（プレビューでは無効）"
                  disabled
                >
                  <ArrowUp size={18} />
                </button>
              </div>
            </div>
          </div>
        </div>
        {showInspector && (
          <Inspector
            info={info}
            open={inspectorOpen}
            onToggle={() => setInspectorOpen(false)}
          />
        )}
      </div>
      {closable && (
        <button
          type="button"
          className="pane-close"
          aria-label="paneを閉じる"
          title="paneを閉じる"
        >
          <X size={14} aria-hidden="true" />
        </button>
      )}
    </section>
  );
}

export type IndicatorLayout = "three" | "single" | "grid";
const layouts: Record<
  IndicatorLayout,
  { x: number; y: number; w: number; h: number }[]
> = {
  single: [{ x: 0, y: 0, w: 1, h: 1 }],
  three: [
    { x: 0, y: 0, w: 0.6, h: 1 },
    { x: 0.6, y: 0, w: 0.4, h: 0.55 },
    { x: 0.6, y: 0.55, w: 0.4, h: 0.45 },
  ],
  grid: [
    { x: 0, y: 0, w: 0.5, h: 0.5 },
    { x: 0.5, y: 0, w: 0.5, h: 0.5 },
    { x: 0, y: 0.5, w: 0.5, h: 0.5 },
    { x: 0.5, y: 0.5, w: 0.5, h: 0.5 },
  ],
};

/** Story-only: three panes with rich, light and empty session info. */
export function IndicatorStage({
  variant,
  title,
  fit,
  layout = "three",
  attention = false,
  expanded = false,
}: {
  variant: IndicatorVariant;
  title: string;
  fit: string;
  layout?: IndicatorLayout;
  attention?: boolean;
  /** Opens the first pane's task list, for reviewing the expanded surface. */
  expanded?: boolean;
}) {
  const fixtures = paneFixtures(attention);
  const rects = layouts[layout];
  const infos = rects.map((_, index) => fixtures[index % fixtures.length]);
  return (
    <div className="si-window">
      <header className="si-caption">
        <strong>{title}</strong>
        <span>{fit}</span>
      </header>
      <div className="pane-workspace si-workspace">
        {rects.map((rect, index) => (
          <MockPane
            // biome-ignore lint/suspicious/noArrayIndexKey: Fixed story layout.
            key={`${layout}-${index}-${expanded}`}
            info={infos[index]}
            variant={variant}
            closable={rects.length > 1}
            initial={expanded && index === 0 ? "tasks" : null}
            style={{
              left: `${rect.x * 100}%`,
              top: `${rect.y * 100}%`,
              width: `${rect.w * 100}%`,
              height: `${rect.h * 100}%`,
            }}
          />
        ))}
        {rects.slice(1).map((rect, index) => (
          <span
            // biome-ignore lint/suspicious/noArrayIndexKey: Fixed story layout.
            key={index}
            className="si-divider"
            aria-hidden="true"
            style={
              rect.x > 0 && rect.y === 0
                ? { left: `${rect.x * 100}%`, top: 0, width: 1, height: "100%" }
                : {
                    left: `${rect.x * 100}%`,
                    top: `${rect.y * 100}%`,
                    width: `${rect.w * 100}%`,
                    height: 1,
                  }
            }
          />
        ))}
      </div>
    </div>
  );
}
