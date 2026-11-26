import { ArrowUp, ChevronDown, SquarePen, X } from "lucide-react";
import { useRef, useState } from "react";
import {
  PaneDragGrip,
  PaneDropOverlay,
  paneRect as rect,
  usePaneDrag,
} from "../../mainview/PaneDrag";
import {
  initialPaneTree,
  type PaneLayout,
  paneGeometry,
} from "../../mainview/pane-layout";
import { ResizeDivider } from "../../mainview/ResizeDivider";
import "../../mainview/panes.css";
import "./panes.css";
import "./pane-drag.css";

const sessions: Record<
  number,
  { project: string; title: string; prompt: string; response: string }
> = {
  1: {
    project: "piris",
    title: "pane機能のレイアウトを検討",
    prompt: "winbarをつまんでpaneを移動したい。",
    response: "移動後のレイアウトをドラッグ中に重ねて表示します。",
  },
  2: {
    project: "LLEs",
    title: "DualPumpLLEのコードを確認",
    prompt: "計算結果の保存処理を確認して。",
    response:
      "保存処理を確認しました。出力先とファイル名の規則は揃っています。",
  },
  3: {
    project: "piris",
    title: "変更内容のレビュー",
    prompt: "レイアウトが崩れていないかレビューして。",
    response: "通常幅と狭い幅を比較します。",
  },
  4: {
    project: "Chats",
    title: "New chat",
    prompt: "ドラッグで分割方向を変えられる？",
    response: "下端にドロップすると上下分割になります。",
  },
};

/** Story-only: drag a pane's winbar to move it; the overlay shows the layout after drop. */
export function PaneDragPreview({
  initialLayout = "columns",
}: {
  initialLayout?: PaneLayout;
}) {
  const [tree, setTree] = useState(() => initialPaneTree(initialLayout));
  const [active, setActive] = useState(1);
  const workspace = useRef<HTMLDivElement>(null);
  const geometry = paneGeometry(tree);
  const { dragging, winbarProps } = usePaneDrag(
    tree,
    workspace,
    (id, result) => {
      setTree(result);
      setActive(id);
    },
  );

  return (
    <div className="pane-drag-window sidebar-collapsed">
      <main>
        <div className="pane-drag-clip">
          <div
            className="pane-workspace"
            ref={workspace}
            data-dragging={!!dragging}
          >
            {geometry.panes.map(({ id, bounds }) => {
              const session = sessions[id];
              return (
                <section
                  key={id}
                  className="pane-view"
                  data-pane-id={id}
                  data-active={active === id}
                  data-drag-source={dragging?.id === id}
                  aria-label={`Pane ${id}`}
                  onPointerDownCapture={() => setActive(id)}
                  style={rect(bounds)}
                >
                  <header
                    className="pane-winbar"
                    {...winbarProps(id, geometry.panes.length > 1)}
                  >
                    <PaneDragGrip />
                    <span className="pane-winbar-project">
                      {session.project}
                    </span>
                    <span className="pane-winbar-separator" aria-hidden="true">
                      /
                    </span>
                    <span className="pane-winbar-title">{session.title}</span>
                  </header>
                  <div className="pane-content">
                    <section className="pane-preview-history">
                      <div className="transcript">
                        <div className="message user">
                          <div className="user-bubble">{session.prompt}</div>
                        </div>
                        <div className="message assistant">
                          <p>{session.response}</p>
                        </div>
                      </div>
                    </section>
                    <div className="pane-preview-composer">
                      <div className="composer">
                        <textarea
                          aria-label={`Pane ${id}へのメッセージ（プレビュー）`}
                          placeholder="メッセージを入力…"
                        />
                        <div className="composer-toolbar">
                          <span className="muted pane-preview-model">
                            GPT-6.1 Sol <small>High</small>
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
                  </div>
                  <div className="pane-actions">
                    <button
                      type="button"
                      className="pane-action"
                      aria-label={`New chat: Pane ${id}`}
                    >
                      <SquarePen size={14} aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      className="pane-action"
                      aria-label={`Close: Pane ${id}`}
                    >
                      <X size={14} aria-hidden="true" />
                    </button>
                  </div>
                </section>
              );
            })}
            {!dragging &&
              geometry.dividers.map((divider) => (
                <ResizeDivider
                  key={`${divider.path.join(".")}:${divider.index}`}
                  divider={divider}
                  tree={tree}
                  onChange={setTree}
                />
              ))}
            {dragging && (
              <PaneDropOverlay
                tree={tree}
                drag={dragging}
                label={(id) => sessions[id]}
              />
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
