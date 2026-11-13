import {
  ArrowUp,
  Bell,
  ChevronDown,
  ChevronRight,
  Columns2,
  Folder,
  Grid2X2,
  Maximize2,
  Minimize2,
  PanelLeft,
  PanelsTopLeft,
  Plus,
  Puzzle,
  Rows2,
  Rows3,
  Settings,
  Settings2,
  X,
} from "lucide-react";
import { useRef, useState } from "react";
import appIcon from "../../../assets/icon.svg";
import { ProviderUsageView } from "../../mainview/ProviderUsageView";
import "../../mainview/notifications.css";
import { usageFixtures, usageFixtureTime } from "../providers/usage-fixtures";
import "./panes.css";
import {
  initialPaneTree,
  type PaneLayout,
  paneGeometry,
  removePane,
  replacePane,
  type SplitAxis,
  splitPane,
} from "../../mainview/pane-layout";
import { ResizeDivider } from "../../mainview/ResizeDivider";
import "../../mainview/panes.css";

export const paneLayouts = {
  single: {
    label: "分割なし",
    icon: PanelsTopLeft,
    count: 1,
  },
  stacked: {
    label: "上下 · 1:1",
    icon: Rows2,
    count: 2,
  },
  weighted: {
    label: "上下 · 2:1",
    icon: Rows2,
    count: 2,
  },
  triple: {
    label: "上下 · 3段",
    icon: Rows3,
    count: 3,
  },
  columns: {
    label: "左右 · 1:1",
    icon: Columns2,
    count: 2,
  },
  bottomSplit: {
    label: "上1枚＋下2枚",
    icon: PanelsTopLeft,
    count: 3,
  },
  grid: {
    label: "4分割",
    icon: Grid2X2,
    count: 4,
  },
} as const;
export type { PaneLayout } from "../../mainview/pane-layout";

type Session = {
  id: number;
  project: string;
  title: string;
  model: string;
  status?: "running" | "completed";
  prompt?: string;
  response?: string;
};
const sessions: Session[] = [
  { id: 1, project: "piris", title: "New chat", model: "GPT-6.1 Sol" },
  {
    id: 2,
    project: "piris",
    title: "pane機能のレイアウトを検討",
    model: "Claude Opus 4.6",
    status: "running",
    prompt: "上下に分割して、別のセッションも同時に見たい。",
    response:
      "サイドバーは共有し、会話と入力欄はpaneごとに分けます。境界はDividerだけにし、入力先はヘッダーで示します。",
  },
  {
    id: 3,
    project: "LLEs",
    title: "DualPumpLLEのコードを確認",
    model: "GPT-6.1 Sol",
    status: "completed",
    prompt: "計算結果の保存処理を確認して。",
    response:
      "保存処理を確認しました。結果の出力先とファイル名の規則は揃っています。次に境界条件のテストを追加できます。",
  },
  {
    id: 4,
    project: "piris",
    title: "変更内容のレビューとテストの確認",
    model: "Mistral Vibe",
    status: "completed",
    prompt: "今回の変更でレイアウトが崩れていないかレビューして。",
    response:
      "通常幅と狭い幅を比較します。各paneの履歴は独立してスクロールし、入力欄はそれぞれの下端に固定します。",
  },
];
const usage = usageFixtures.filter((entry) =>
  ["anthropic", "mistral", "codex-work"].includes(entry.key),
);

/** Story-only state. No runtime, session persistence or desktop RPC is connected. */
export function PanePreview({
  initialLayout = "single",
  sidebar = true,
}: {
  initialLayout?: PaneLayout;
  sidebar?: boolean;
}) {
  const [tree, setTree] = useState(() => initialPaneTree(initialLayout));
  const { panes: geometry, dividers } = paneGeometry(tree);
  const panes = geometry.map(({ id }) => sessions[id - 1]);
  const [active, setActive] = useState(1);
  const [zoomed, setZoomed] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(sidebar);
  const menu = useRef<HTMLDetailsElement>(null);
  const current = panes.find((pane) => pane.id === active) ?? panes[0];
  function changeLayout(next: PaneLayout) {
    setTree(initialPaneTree(next));
    setActive(1);
    setZoomed(false);
    if (menu.current) menu.current.open = false;
  }
  function splitActive(axis: SplitAxis) {
    const next = sessions.find(
      (session) => !panes.some((pane) => pane.id === session.id),
    );
    if (!next) return;
    setTree(splitPane(tree, active, next.id, axis));
    setZoomed(false);
  }
  function selectSession(session: Session) {
    if (!panes.some((pane) => pane.id === session.id))
      setTree(replacePane(tree, active, session.id));
    setActive(session.id);
  }
  function closePane(id: number) {
    if (panes.length === 1) return;
    const remaining = removePane(tree, id);
    if (!remaining) return;
    setTree(remaining);
    if (active === id) setActive(paneGeometry(remaining).panes[0].id);
    setZoomed(false);
  }
  return (
    <div
      className={`pane-preview-window${sidebarOpen ? "" : " sidebar-collapsed"}`}
    >
      <button
        type="button"
        className="sidebar-toggle"
        aria-label="サイドバーを切り替え"
        aria-expanded={sidebarOpen}
        onClick={() => setSidebarOpen(!sidebarOpen)}
      >
        <PanelLeft size={16} />
      </button>
      <aside className="sidebar" inert={!sidebarOpen}>
        <header>
          <strong className="sidebar-brand">
            <img src={appIcon} alt="" width={20} height={20} />
            pig
          </strong>
        </header>
        <div className="project-list">
          <section className="sidebar-section">
            <div className="sidebar-section-heading">
              <h2>チャット</h2>
              <Plus size={14} aria-hidden="true" />
            </div>
          </section>
          <section className="sidebar-section">
            <div className="sidebar-section-heading">
              <h2>プロジェクト</h2>
              <Plus size={14} aria-hidden="true" />
            </div>
            {["LLEs", "piris"].map((project) => (
              <section className="project" key={project}>
                <div className="project-heading">
                  <ChevronDown size={12} />
                  <Folder size={13} />
                  {project}
                </div>
                <div className="project-threads">
                  {sessions
                    .filter((session) => session.project === project)
                    .map((session) => (
                      <button
                        type="button"
                        key={session.id}
                        className={`thread${current.id === session.id ? " active" : ""}`}
                        aria-pressed={current.id === session.id}
                        onClick={() => selectSession(session)}
                        title={session.title}
                      >
                        {session.title}
                        <span className="pane-preview-open-mark">
                          {panes.some((pane) => pane.id === session.id)
                            ? "•"
                            : ""}
                        </span>
                      </button>
                    ))}
                  <div className="thread muted">…</div>
                </div>
              </section>
            ))}
          </section>
        </div>
        <ProviderUsageView entries={usage} now={usageFixtureTime} />
        <div className="sidebar-footer" aria-hidden="true">
          {[Settings, Settings2, Puzzle, Bell].map((Icon) => (
            <span className="sidebar-icon" key={Icon.displayName}>
              <Icon size={16} />
            </span>
          ))}
        </div>
      </aside>
      <div className="pane-preview-workspace">
        <header className="pane-preview-toolbar">
          <span className="pane-preview-location">
            <Folder size={14} />
            {current.project}
            <ChevronRight size={12} />
            <span>{current.title}</span>
          </span>
          <div className="pane-preview-actions">
            <span className="pane-preview-count">
              {panes.length} pane{panes.length > 1 ? "s" : ""}
            </span>
            <button
              type="button"
              className="pane-preview-icon"
              title="上下に分割"
              aria-label="上下に分割"
              disabled={panes.length === sessions.length}
              onClick={() => splitActive("rows")}
            >
              <Rows2 size={16} />
            </button>
            <button
              type="button"
              className="pane-preview-icon"
              title="左右に分割"
              aria-label="左右に分割"
              disabled={panes.length === sessions.length}
              onClick={() => splitActive("columns")}
            >
              <Columns2 size={16} />
            </button>
            <details
              className="pane-preview-layout-menu"
              ref={menu}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.currentTarget.open = false;
                  event.currentTarget.querySelector("summary")?.focus();
                }
              }}
            >
              <summary
                aria-label="paneレイアウトを選択"
                title="paneレイアウトを選択"
              >
                <PanelsTopLeft size={16} />
                <ChevronDown size={12} />
              </summary>
              <div className="pane-preview-layout-options">
                <strong>レイアウト</strong>
                {(
                  Object.entries(paneLayouts) as [
                    PaneLayout,
                    (typeof paneLayouts)[PaneLayout],
                  ][]
                ).map(([key, { label, icon: Icon }]) => (
                  <button
                    type="button"
                    key={key}
                    aria-pressed={
                      JSON.stringify(tree) ===
                        JSON.stringify(initialPaneTree(key)) && !zoomed
                    }
                    onClick={() => changeLayout(key)}
                  >
                    <Icon size={16} />
                    {label}
                  </button>
                ))}
              </div>
            </details>
          </div>
        </header>
        <div className={`pane-preview-grid${zoomed ? " is-zoomed" : ""}`}>
          {panes.map((session, index) => (
            <section
              key={session.id}
              className="pane-preview-pane"
              data-pane-id={session.id}
              aria-label={`pane ${index + 1}: ${session.title}`}
              data-active={active === session.id}
              hidden={zoomed && active !== session.id}
              onFocusCapture={() => setActive(session.id)}
              onPointerDownCapture={() => setActive(session.id)}
              style={{
                left: `${(zoomed ? 0 : geometry[index].bounds.x) * 100}%`,
                top: `${(zoomed ? 0 : geometry[index].bounds.y) * 100}%`,
                width: `${(zoomed ? 1 : geometry[index].bounds.width) * 100}%`,
                height: `${(zoomed ? 1 : geometry[index].bounds.height) * 100}%`,
              }}
            >
              <header className="pane-preview-pane-header">
                <button
                  type="button"
                  className="pane-preview-session"
                  aria-label={`pane ${index + 1}を選択: ${session.title}`}
                  aria-pressed={active === session.id}
                  onClick={() => setActive(session.id)}
                >
                  <span className="pane-preview-number">{index + 1}</span>
                  <span className="pane-preview-session-project">
                    {session.project}
                  </span>
                  <span
                    className="pane-preview-session-title"
                    title={session.title}
                  >
                    {session.title}
                  </span>
                  {session.status && (
                    <span
                      className={`session-dot ${session.status}`}
                      role="img"
                      aria-label={
                        session.status === "running" ? "実行中" : "完了"
                      }
                    />
                  )}
                </button>
                <div className="pane-preview-actions">
                  <button
                    type="button"
                    className="pane-preview-icon"
                    aria-label={
                      zoomed ? "分割表示に戻す" : `pane ${index + 1}を拡大`
                    }
                    title={zoomed ? "分割表示に戻す" : "このpaneを拡大"}
                    disabled={panes.length === 1}
                    onClick={() => {
                      setActive(session.id);
                      setZoomed(!zoomed);
                    }}
                  >
                    {zoomed ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
                  </button>
                  <button
                    type="button"
                    className="pane-preview-icon"
                    aria-label={`pane ${index + 1}を閉じる`}
                    title="paneを閉じる（セッションは削除しません）"
                    disabled={panes.length === 1}
                    onClick={() => closePane(session.id)}
                  >
                    <X size={14} />
                  </button>
                </div>
              </header>
              <section
                className="pane-preview-history"
                // biome-ignore lint/a11y/noNoninteractiveTabindex: Independently scrollable history must be keyboard-accessible.
                tabIndex={0}
                aria-label={`${session.title}の会話履歴`}
              >
                {session.prompt ? (
                  <div className="transcript">
                    <div className="message user">
                      <div className="user-bubble">{session.prompt}</div>
                    </div>
                    <div className="message assistant">
                      <p>{session.response}</p>
                      <p className="muted">{session.model}</p>
                    </div>
                  </div>
                ) : (
                  <div className="chat-empty">
                    <h1>何を作りましょうか？</h1>
                    <p className="muted">作業場所: piris</p>
                    <p className="muted pane-preview-extension">
                      Ponytail loaded: full
                    </p>
                  </div>
                )}
              </section>
              <div className="pane-preview-composer">
                <div className="composer">
                  <textarea
                    aria-label={`pane ${index + 1}へのメッセージ（プレビュー）`}
                    placeholder="メッセージを入力…"
                    defaultValue={
                      session.id === 1
                        ? "次はpane機能を実装したい。複数のセッションを一つのWindowで管理できるようなもの。"
                        : ""
                    }
                  />
                  <div className="composer-toolbar">
                    <span className="muted pane-preview-model">
                      ◯ {session.prompt ? "12" : "0"}%　{session.model}{" "}
                      <small>High</small>
                      <ChevronDown size={12} />
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
            </section>
          ))}
          {!zoomed &&
            dividers.map((divider) => (
              <ResizeDivider
                key={`${divider.path.join(".")}:${divider.index}`}
                divider={divider}
                tree={tree}
                onChange={setTree}
              />
            ))}
        </div>
      </div>
    </div>
  );
}
