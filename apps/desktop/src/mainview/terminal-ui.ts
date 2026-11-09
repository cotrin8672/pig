import {
  inputBytes,
  TERMINAL_LIMITS as LIMIT,
  sameAddress,
  type TerminalClientCommand,
  type TerminalHostEvent,
  TerminalRateLimit,
  type UIAddress,
  utf8Bytes,
  validAddress,
  validDimensions,
  validSequence,
} from "../shared/terminal-ui";

export type TerminalCallbacks = {
  send: (command: TerminalClientCommand) => void;
  /** Must call processed only when xterm's parser has consumed this write. */
  write: (data: string, processed: () => void) => void;
  onClose?: (reason: "done" | "cancelled" | "failed") => void;
  onError?: (error: unknown) => void;
};
/** Per-surface controller, no global FIFO and no React output state. The root broker
 * owns open/close selection and passes ALL addressed events to receive(). */
export function createTerminalConnection(
  address: UIAddress,
  callbacks: TerminalCallbacks,
) {
  if (!validAddress(address))
    throw new TypeError("Invalid terminal surface address");
  const target = {
    sessionId: address.sessionId,
    epoch: address.epoch,
    uiId: address.uiId,
  };
  let closed = false;
  let ready = false;
  let inputSeq = 0;
  let receivedSeq = 0;
  let ackSeq = 0;
  let pendingBytes = 0;
  const pending = new Map<number, { bytes: number; processed: boolean }>();
  const writes = new TerminalRateLimit(LIMIT.outputEventsPerSecond);
  const inputs = new TerminalRateLimit(LIMIT.commandsPerSecond / 2);
  function cancel() {
    if (closed) return;
    closed = true;
    pending.clear();
    pendingBytes = 0;
    try {
      callbacks.send({ ...target, type: "cancel" });
    } catch (error) {
      callbacks.onError?.(error);
    }
  }
  function fail(error: unknown) {
    cancel();
    callbacks.onError?.(error);
  }
  function send(command: TerminalClientCommand) {
    if (closed) return;
    try {
      callbacks.send(command);
    } catch (error) {
      fail(error);
    }
  }
  return {
    ready(cols: number, rows: number) {
      if (closed || ready || !validDimensions(cols, rows)) return;
      ready = true;
      send({ ...target, type: "ready", cols, rows });
    },
    resize(cols: number, rows: number) {
      if (ready && validDimensions(cols, rows))
        send({ ...target, type: "resize", cols, rows });
    },
    input(data: string, encoding: "text" | "binary" = "text") {
      if (closed || !ready || !data) return;
      try {
        if (inputBytes(data, encoding) > LIMIT.inputBytes || !inputs.accept())
          throw new RangeError("Terminal input limit exceeded");
        send({
          ...target,
          type: "input",
          inputSeq: ++inputSeq,
          encoding,
          data,
        });
      } catch (error) {
        fail(error);
      }
    },
    receive(event: TerminalHostEvent) {
      if (closed || !validAddress(event) || !sameAddress(target, event)) return;
      if (event.type === "close") {
        closed = true;
        pending.clear();
        pendingBytes = 0;
        callbacks.onClose?.(event.reason);
        return;
      }
      if (event.type !== "data") return;
      if (
        !ready ||
        !validSequence(event.seq) ||
        typeof event.data !== "string"
      ) {
        fail(new Error("Invalid terminal output packet"));
        return;
      }
      if (event.seq <= receivedSeq) return; // Never write duplicate ANSI.
      if (event.seq !== receivedSeq + 1) {
        fail(new Error("Terminal output sequence gap"));
        return;
      }
      const bytes = utf8Bytes(event.data);
      if (
        bytes > LIMIT.outputChunkBytes ||
        pendingBytes + bytes > LIMIT.pendingOutputBytes ||
        pending.size >= LIMIT.pendingEvents ||
        !writes.accept()
      ) {
        fail(new RangeError("Terminal pending output limit exceeded"));
        return;
      }
      receivedSeq = event.seq;
      pendingBytes += bytes;
      pending.set(event.seq, { bytes, processed: false });
      try {
        callbacks.write(event.data, () => {
          if (closed) return;
          const item = pending.get(event.seq);
          if (!item || item.processed) return;
          item.processed = true;
          const previous = ackSeq;
          while (pending.get(ackSeq + 1)?.processed) {
            const next = pending.get(++ackSeq);
            if (next) pendingBytes -= next.bytes;
            pending.delete(ackSeq);
          }
          if (ackSeq > previous) send({ ...target, type: "ack", seq: ackSeq });
        });
      } catch (error) {
        fail(error);
      }
    },
    cancel,
    /** Root disconnect/unmount is terminal cancellation, not a resumable detach. */
    dispose: cancel,
  };
}

/** Validate again in the Bun openExternal handler; this is only the WebView guard. */
export function safeTerminalURL(value: string): string | undefined {
  try {
    const url = new URL(value);
    if (url.protocol === "http:" || url.protocol === "https:") return url.href;
  } catch {
    /* Relative and malformed links cannot escape the terminal. */
  }
  return undefined;
}
/** Global capture-phase desktop shortcuts must consult this before acting.
 * Bubble-phase shortcuts are also stopped by TerminalDialog. */
export function isTerminalKeyboardEvent(
  event: Pick<KeyboardEvent, "target">,
): boolean {
  return (
    typeof Element !== "undefined" &&
    event.target instanceof Element &&
    event.target.closest("[data-terminal-ui]") !== null
  );
}
