import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { X } from "lucide-react";
import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useT } from "./i18n";
import { rpc } from "./rpc";
import { subscribeTerminalOutput, useTerminalUI } from "./terminal-ui";
import "@xterm/xterm/css/xterm.css";
import "./terminal.css";

export function TerminalDialog() {
  const request = useTerminalUI((s) => s.requests[0]);
  return request
    ? createPortal(
        <TerminalModal key={request.id} id={request.id} />,
        document.body,
      )
    : null;
}

function TerminalModal({ id }: { id: string }) {
  const t = useT();
  const dialog = useRef<HTMLDialogElement>(null);
  const viewport = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    dialog.current?.showModal();
    const terminal = new Terminal({
      cursorBlink: true,
      fontFamily: '"Cascadia Mono", Consolas, monospace',
      fontSize: 14,
      scrollback: 500,
      screenReaderMode: true,
      theme: { background: "#1e2430", foreground: "#f1edf5" },
      linkHandler: {
        activate: (_event, url) => rpc.send.openExternal({ url }),
      },
    });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.open(element);
    const unsubscribe = subscribeTerminalOutput(id, (data) =>
      terminal.write(data),
    );
    const input = terminal.onData((data) =>
      rpc.send.terminalUI({ type: "input", id, data }),
    );
    fit.fit();
    rpc.send.terminalUI({
      type: "ready",
      id,
      cols: terminal.cols,
      rows: terminal.rows,
    });
    const resize = terminal.onResize(({ cols, rows }) =>
      rpc.send.terminalUI({ type: "resize", id, cols, rows }),
    );
    const observer = new ResizeObserver(() => fit.fit());
    observer.observe(element);
    terminal.focus();
    return () => {
      observer.disconnect();
      resize.dispose();
      input.dispose();
      unsubscribe();
      terminal.dispose();
    };
  }, [id]);
  return (
    <dialog
      ref={dialog}
      className="terminal-dialog electrobun-webkit-app-region-no-drag"
      aria-label={t["Extension terminal"]}
      onCancel={(event) => event.preventDefault()}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <header>
        <strong>{t["Extension terminal"]}</strong>
        <button
          type="button"
          aria-label={t["Close terminal"]}
          title={t["Close terminal"]}
          onClick={() => rpc.send.terminalUI({ type: "cancel", id })}
        >
          <X size={18} />
        </button>
      </header>
      <div className="terminal-viewport" ref={viewport} />
      <p className="muted">
        {t["Esc is handled by the extension. Close cancels this UI."]}
      </p>
    </dialog>
  );
}
