import { invoke } from "@tauri-apps/api/core";
import { Effect, getCurrentWindow } from "@tauri-apps/api/window";
import {
  type CSSProperties,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { createRoot } from "react-dom/client";
import { DynamicTheme } from "../mainview/DynamicTheme";
import { WindowTitlebar } from "../mainview/WindowTitlebar";
import type { Backdrop } from "../shared/rpc-schema";
import probe from "./isolation-probe.js?raw";
import "../mainview/styles.css";

type HostStatus = { bunVersion: string; sessionVersion: number };
type WindowAction = "minimize" | "toggleMaximize" | "close";
const native = getCurrentWindow();
const effects = { acrylic: Effect.Acrylic, mica: Effect.Mica };
// Only this fixed local fixture executes. This is not a renderer for arbitrary HTML.
const frameDoc = `<!doctype html><html lang="ja"><meta charset="utf-8"><button type="button">隔離を確認する</button><script>${probe}</script></html>`;

function Preview() {
  const [maximized, setMaximized] = useState(false);
  const [backdrop, setBackdrop] = useState<Backdrop>("none");
  const [opacity, setOpacity] = useState(0.78);
  const [host, setHost] = useState<HostStatus>();
  const [isolated, setIsolated] = useState<boolean>();
  const [hostError, setHostError] = useState("");
  const [isolationError, setIsolationError] = useState("");
  const [ready, setReady] = useState(false);
  const frame = useRef<HTMLIFrameElement>(null);
  const reportError = useCallback(
    (error: unknown) => setHostError(String(error)),
    [],
  );

  useEffect(() => {
    const refresh = () =>
      void native.isMaximized().then(setMaximized, reportError);
    const resize = native.onResized(refresh);
    refresh();
    void invoke("preview_ipc_ping", { frame: false })
      .then(() => invoke<HostStatus>("preview_host"))
      .then(setHost, reportError);
    const onMessage = (event: MessageEvent) => {
      if (
        event.source === frame.current?.contentWindow &&
        event.origin === "null" &&
        event.data?.type === "pig-tauri-preview-isolation"
      ) {
        const ipc = event.data.ipc;
        const ok =
          event.data.isolated === true &&
          (ipc === "absent" || ipc === "rejected" || ipc === "no reply");
        if (!ok)
          setIsolationError(
            `iframe result: parent DOM blocked=${event.data.isolated === true}; Tauri IPC=${String(ipc)}`,
          );
        setIsolated(ok);
      }
    };
    window.addEventListener("message", onMessage);
    setReady(true);
    const timer = setTimeout(
      () => setIsolated((value) => value ?? false),
      3000,
    );
    return () => {
      void resize.then((unlisten) => unlisten(), reportError);
      window.removeEventListener("message", onMessage);
      clearTimeout(timer);
    };
  }, [reportError]);

  useEffect(() => {
    if (!hostError && (!host || isolated === undefined)) return;
    const failure =
      hostError ||
      isolationError ||
      (isolated === false
        ? "iframe script did not report"
        : !host?.bunVersion || !Number.isInteger(host.sessionVersion)
          ? "invalid Bun/Pi SDK response"
          : null);
    void invoke("preview_report", {
      failure,
    }).catch(reportError);
  }, [hostError, host, isolated, isolationError, reportError]);

  function run(action: WindowAction) {
    void native[action]().catch(reportError);
  }

  async function changeBackdrop(next: Backdrop) {
    try {
      if (next === "none") await native.clearEffects();
      else await native.setEffects({ effects: [effects[next]] });
      setBackdrop(next);
    } catch (error) {
      reportError(error);
    }
  }

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: Native window drag regions retain separate accessible controls.
    <div
      className="app-shell"
      data-backdrop={backdrop}
      style={{ "--window-opacity": opacity } as CSSProperties}
      onMouseDown={(event) => {
        if (
          event.button === 0 &&
          event.target instanceof Element &&
          event.target.closest(".electrobun-webkit-app-region-drag") &&
          !event.target.closest(".electrobun-webkit-app-region-no-drag")
        ) {
          if (event.detail === 2) run("toggleMaximize");
          else if (event.detail === 1)
            void native.startDragging().catch(reportError);
        }
      }}
    >
      <DynamicTheme />
      <aside className="sidebar" aria-label="pig">
        <header className="electrobun-webkit-app-region-drag">
          <strong className="sidebar-brand">pig · Tauri</strong>
        </header>
      </aside>
      <WindowTitlebar maximized={maximized} onAction={run} />
      <main>
        <div className="welcome">
          <h1>Tauri / WebView2 移行プレビュー</h1>
          <p>
            {host
              ? `Bun ${host.bunVersion} · Pi セッション v${host.sessionVersion}`
              : "Bun／Pi を確認中"}
          </p>
          <label>
            背景{" "}
            <select
              value={backdrop}
              onChange={(event) =>
                void changeBackdrop(event.target.value as Backdrop)
              }
            >
              <option value="none">透過</option>
              <option value="acrylic">Acrylic</option>
              <option value="mica">Mica</option>
            </select>
          </label>
          <label>
            不透明度{" "}
            <input
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={opacity}
              onChange={(event) => setOpacity(event.target.valueAsNumber)}
            />
          </label>
          <p role="status">
            {isolated === undefined
              ? "iframe の隔離を確認中"
              : isolated
                ? "iframe: スクリプト動作・親 DOM と Tauri からの隔離を確認"
                : "iframe: 隔離の検証に失敗"}
          </p>
          {ready && (
            <iframe
              ref={frame}
              title="iframe 隔離試験"
              sandbox="allow-scripts"
              srcDoc={frameDoc}
              width={240}
              height={48}
            />
          )}
          {hostError && <p role="alert">{hostError}</p>}
          {isolationError && <p role="alert">{isolationError}</p>}
        </div>
      </main>
    </div>
  );
}

const root = document.getElementById("root");
if (!root) throw new Error("Missing Tauri preview root");
createRoot(root).render(<Preview />);
