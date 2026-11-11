import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type {
  TerminalClientCommand,
  TerminalHostEvent,
  TerminalOpenEvent,
} from "../shared/terminal-ui";
import { terminalAddressKey, validDimensions } from "../shared/terminal-ui";
import { useT } from "./i18n";
import { createTerminalConnection, safeTerminalURL } from "./terminal-ui";
import "@xterm/xterm/css/xterm.css";
import "./terminal.css";

export type TerminalDialogProps = {
  request: TerminalOpenEvent;
  /** The dialog shell may precede the host's terminal-open event. */
  ready?: boolean;
  /** Retain started surfaces at root when switching tabs or opening child dialogs. */
  active?: boolean;
  /** Startup UI must not make chat navigation inert. */
  modal?: boolean;
  send: (command: TerminalClientCommand) => void;
  subscribe: (listener: (event: TerminalHostEvent) => void) => () => void;
  /** Bun must independently reject every non-http(s) scheme. */
  openExternal: (url: string) => void;
  onError?: (error: unknown) => void;
  onDismiss?: () => void;
};
/** The root UI broker selects/retains instances; this component owns no request queue. */
export function TerminalDialog(props: TerminalDialogProps) {
  return createPortal(
    <TerminalModal key={terminalAddressKey(props.request)} {...props} />,
    document.body,
  );
}
function TerminalModal(props: TerminalDialogProps) {
  const { request, active = true, modal = true, ready = true } = props;
  const t = useT();
  const callbacks = useRef(props);
  callbacks.current = props;
  const dialog = useRef<HTMLDialogElement>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const connection = useRef<ReturnType<typeof createTerminalConnection> | null>(
    null,
  );
  const fitNow = useRef<(() => void) | null>(null);
  const resources = useRef<(() => void) | null>(null);
  const lease = useRef(0);
  const [error, setError] = useState<string>();
  const { sessionId, epoch, uiId } = request;
  useEffect(() => {
    if (!ready || (!active && !resources.current)) return;
    const generation = ++lease.current;
    const releaseLater = () => {
      // StrictMode's synchronous setup/cleanup/setup probe must not cancel a real
      // host request or recreate xterm and lose its initial ANSI state.
      queueMicrotask(() => {
        if (lease.current !== generation) return;
        resources.current?.();
        resources.current = null;
      });
    };
    if (resources.current) return releaseLater;
    const element = viewport.current;
    const modal = dialog.current;
    if (!element || !modal) return;
    const cleanups: (() => void)[] = [];
    const report = (failure: unknown) => {
      setError(
        failure instanceof Error
          ? failure.message
          : "Terminal transport failed",
      );
      try {
        callbacks.current.onError?.(failure);
      } catch {
        /* Advisory diagnostic. */
      }
    };
    let terminal: Terminal | undefined;
    const client = createTerminalConnection(
      { sessionId, epoch, uiId },
      {
        send: (command) => callbacks.current.send(command),
        write: (data, processed) => {
          if (!terminal) throw new Error("Terminal parser unavailable");
          terminal.write(data, processed);
        },
        onClose: () => modal.close(),
        onError: report,
      },
    );
    connection.current = client;
    resources.current = () => {
      fitNow.current = null;
      connection.current = null;
      client.dispose();
      for (const cleanup of cleanups.reverse()) {
        try {
          cleanup();
        } catch {
          /* Release remaining subscriptions. */
        }
      }
    };
    try {
      const term = new Terminal({
        cursorBlink: true,
        fontFamily: '"Cascadia Mono", Consolas, monospace',
        fontSize: 14,
        scrollback: 500,
        screenReaderMode: true,
        theme: { background: "#1e2430", foreground: "#f1edf5" },
        linkHandler: {
          activate: (_event, value) => {
            const url = safeTerminalURL(value);
            if (url) callbacks.current.openExternal(url);
          },
        },
      });
      terminal = term;
      cleanups.push(() => term.dispose());
      const fit = new FitAddon();
      term.loadAddon(fit);
      term.open(element);
      // Subscribe before ready: Bun can synchronously emit from the ready handler.
      cleanups.push(callbacks.current.subscribe(client.receive));
      const input = term.onData((data) => client.input(data, "text"));
      const binary = term.onBinary((data) => client.input(data, "binary"));
      const resize = term.onResize(({ cols, rows }) =>
        client.resize(cols, rows),
      );
      cleanups.push(
        () => input.dispose(),
        () => binary.dispose(),
        () => resize.dispose(),
      );
      // Do not preventDefault: xterm owns IME, keyboard, paste and Escape handling.
      const stop = (event: KeyboardEvent) => event.stopPropagation();
      modal.addEventListener("keydown", stop);
      modal.addEventListener("keyup", stop);
      cleanups.push(() => {
        modal.removeEventListener("keydown", stop);
        modal.removeEventListener("keyup", stop);
      });
      let frame = 0;
      const fitViewport = () => {
        if (!modal.open) return;
        try {
          const dimensions = fit.proposeDimensions();
          if (!dimensions) return;
          const cols = Math.max(2, Math.min(500, dimensions.cols));
          const rows = Math.max(2, Math.min(200, dimensions.rows));
          if (!validDimensions(cols, rows)) return;
          term.resize(cols, rows);
          client.ready(cols, rows);
        } catch (failure) {
          client.cancel();
          report(failure);
        }
      };
      fitNow.current = () => {
        fitViewport();
        term.focus();
      };
      const observer = new ResizeObserver(() => {
        cancelAnimationFrame(frame);
        frame = requestAnimationFrame(fitViewport);
      });
      observer.observe(element);
      cleanups.push(() => {
        observer.disconnect();
        cancelAnimationFrame(frame);
      });
    } catch (failure) {
      client.cancel();
      report(failure);
    }
    return releaseLater;
  }, [sessionId, epoch, uiId, ready, active]);
  useEffect(() => {
    try {
      dialog.current?.close();
      if (active) {
        if (modal) dialog.current?.showModal();
        else dialog.current?.show();
        if (ready) fitNow.current?.();
      }
    } catch (failure) {
      connection.current?.cancel();
      setError(
        failure instanceof Error
          ? failure.message
          : "Terminal view unavailable",
      );
    }
  }, [active, modal, ready]);
  return (
    <dialog
      ref={dialog}
      data-terminal-ui
      className="terminal-dialog electrobun-webkit-app-region-no-drag"
      aria-label={request.title ?? t.Extension}
      aria-modal={modal}
      onCancel={(event) => event.preventDefault()}
      onKeyDown={(event) => event.stopPropagation()}
      onKeyUp={(event) => event.stopPropagation()}
    >
      <header>
        <strong>{request.title ?? t.Extension}</strong>
        <button
          type="button"
          aria-label={t.Close}
          title={t.Close}
          onClick={() => {
            dialog.current?.close();
            callbacks.current.onDismiss?.();
            if (connection.current) connection.current.cancel();
            else
              callbacks.current.send({
                sessionId,
                epoch,
                uiId,
                type: "cancel",
              });
          }}
        >
          <X size={18} />
        </button>
      </header>
      <div className="terminal-viewport" ref={viewport} />
      {error && <p role="alert">{error}</p>}
    </dialog>
  );
}
