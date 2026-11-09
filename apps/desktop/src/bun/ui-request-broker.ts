import { AsyncLocalStorage } from "node:async_hooks";
import type {
  ExtensionUIEvent,
  UIReply,
  UIRequest,
} from "../shared/extension-ui";
import type { SessionAddress, UIAddress } from "../shared/runtime-contract";

export const UI_TEXT_LIMIT = 1024 * 1024;
export function sameSession(a: SessionAddress, b: SessionAddress): boolean {
  return (
    a.hostId === b.hostId && a.sessionId === b.sessionId && a.epoch === b.epoch
  );
}
export function sessionKey(a: SessionAddress): string {
  validateSession(a);
  return JSON.stringify([a.hostId, a.sessionId, a.epoch]);
}
export function validateSession(a: SessionAddress): void {
  if (
    !a ||
    typeof a.hostId !== "string" ||
    !a.hostId ||
    a.hostId.length > 256 ||
    typeof a.sessionId !== "string" ||
    !a.sessionId ||
    a.sessionId.length > 256 ||
    !Number.isSafeInteger(a.epoch) ||
    a.epoch < 0
  )
    throw new TypeError("Invalid session address");
}
function key(a: UIAddress): string {
  const session = sessionKey(a);
  if (typeof a.uiId !== "string" || !a.uiId || a.uiId.length > 256)
    throw new TypeError("Invalid UI address");
  return `${session}:${a.uiId}`;
}
export function checkText(text: string, limit = UI_TEXT_LIMIT): void {
  if (typeof text !== "string" || Buffer.byteLength(text, "utf8") > limit)
    throw new RangeError("UI text limit exceeded");
}
type EndReason = Extract<ExtensionUIEvent, { type: "requestEnd" }>["reason"];
type Entry = {
  request: UIRequest;
  finish: (reply: UIReply) => void;
  cancelTerminal?: () => void;
  timer?: ReturnType<typeof setTimeout>;
  unlisten?: () => void;
  foreground?: (active: boolean) => void;
};
export type UIRequestOptions = { signal?: AbortSignal };

/** Root-owned, including requests made before AgentSession/ExtensionUIHost exists.
 * Availability is opt-in: the RPC connection owner must call setAvailable(true).
 * Every request is published; pending() is ordered with the foreground first.
 */
export class UIRequestBroker {
  private readonly entries = new Map<string, Entry>();
  private readonly used = new Set<string>();
  private readonly context = new AsyncLocalStorage<UIAddress>();
  private available = false;
  private active?: string;
  private cancelling = 0;
  private readonly cancellingSessions = new Set<string>();
  constructor(private readonly emit: (event: ExtensionUIEvent) => void) {}

  setAvailable(available: boolean): void {
    this.available = available;
    if (!available) {
      this.cancelling++;
      try {
        for (const entry of [...this.entries.values()])
          this.end(entry, "cancelled");
      } finally {
        this.cancelling--;
      }
    }
  }
  isAvailable(address?: SessionAddress): boolean {
    return (
      this.available &&
      !this.cancelling &&
      (!address || !this.cancellingSessions.has(sessionKey(address)))
    );
  }
  currentParent(address: SessionAddress): UIAddress | undefined {
    const parent = this.context.getStore();
    return parent &&
      sameSession(parent, address) &&
      this.entries.has(key(parent))
      ? { ...parent }
      : undefined;
  }
  /** Explicit dynamic scope; used around real custom factories and their async work.
   * Never enterWith(): unrelated session startup must not inherit another session's UI.
   */
  withContext<T>(address: UIAddress, action: () => T): T {
    return this.context.run(address, action);
  }
  isForeground(address: UIAddress): boolean {
    return this.active === key(address);
  }
  /** A validated reply or terminal interaction is an explicit Root selection,
   * unlike a new request, which must never steal another session's focus. */
  activate(address: UIAddress): boolean {
    const id = key(address);
    if (!this.entries.has(id)) return false;
    this.focus(id);
    return this.isForeground(address);
  }
  pending(): UIRequest[] {
    const entries = [...this.entries.entries()];
    entries.sort(([a], [b]) =>
      a === this.active ? -1 : b === this.active ? 1 : 0,
    );
    return entries.map(([, entry]) => structuredClone(entry.request));
  }
  request(
    request: Exclude<UIRequest, { kind: "terminal" }>,
    options: UIRequestOptions = {},
  ): Promise<UIReply> {
    this.validate(request);
    if (!this.isAvailable(request) || options.signal?.aborted)
      return Promise.resolve({ ...request, kind: "cancel" });
    return new Promise((resolve) => {
      const entry: Entry = {
        request: structuredClone(request),
        finish: resolve,
      };
      this.add(entry, options.signal);
    });
  }
  registerTerminal(
    request: UIRequest & { kind: "terminal" },
    cancel: () => void,
    foreground?: (active: boolean) => void,
  ): void {
    this.validate(request);
    if (!this.isAvailable(request)) {
      cancel();
      throw new Error("Extension UI unavailable");
    }
    this.add({
      request: structuredClone(request),
      finish: () => {},
      cancelTerminal: cancel,
      foreground,
    });
  }
  endTerminal(
    address: UIAddress,
    reason: "done" | "cancelled" | "failed",
  ): void {
    const entry = this.entries.get(key(address));
    if (entry?.request.kind === "terminal")
      this.end(entry, reason, undefined, false);
  }
  resolve(reply: UIReply): void {
    const entry = this.entries.get(key(reply));
    if (!entry) throw new Error("Unknown or completed UI request");
    if (Buffer.byteLength(JSON.stringify(reply)) > 4 * UI_TEXT_LIMIT)
      throw new RangeError("UI reply size exceeded");
    const request = entry.request;
    if (reply.kind !== "cancel") {
      if (reply.kind !== request.kind)
        throw new TypeError("UI reply kind mismatch");
      switch (reply.kind) {
        case "confirm":
          if (typeof reply.value !== "boolean")
            throw new TypeError("Invalid confirmation");
          break;
        case "select":
          checkText(reply.value);
          if (
            request.kind !== "select" ||
            !request.options.includes(reply.value)
          )
            throw new TypeError("Invalid selected value");
          break;
        case "input":
        case "editor":
          checkText(reply.value);
          break;
        case "project-trust":
          if (!["once", "persist", "safe"].includes(reply.value))
            throw new TypeError("Invalid trust decision");
          break;
        default:
          throw new TypeError("Invalid UI reply kind");
      }
    }
    if (reply.kind !== "cancel" && !this.activate(reply))
      throw new Error("UI request has a waiting child");
    this.end(
      entry,
      reply.kind === "cancel" ? "cancelled" : "done",
      structuredClone(reply),
    );
  }
  cancelSession(address: SessionAddress): void {
    const id = sessionKey(address);
    if (this.cancellingSessions.has(id)) return;
    this.cancellingSessions.add(id);
    try {
      for (const entry of [...this.entries.values()])
        if (sameSession(entry.request, address)) this.end(entry, "cancelled");
    } finally {
      this.cancellingSessions.delete(id);
    }
  }
  cancel(address: UIAddress): void {
    const entry = this.entries.get(key(address));
    if (entry) this.end(entry, "cancelled");
  }
  private validate(request: UIRequest): void {
    key(request);
    checkText(request.title, 16 * 1024);
    if (
      request.expiresAt !== undefined &&
      (!Number.isFinite(request.expiresAt) ||
        request.expiresAt > Date.now() + 2_147_000_000)
    )
      throw new RangeError("Invalid UI deadline");
    if (request.parentUiId !== undefined) {
      const parent = this.entries.get(
        key({ ...request, uiId: request.parentUiId }),
      );
      if (!parent) throw new Error("Unknown parent UI request");
    }
    switch (request.kind) {
      case "confirm":
        checkText(request.message);
        break;
      case "select":
        if (!Array.isArray(request.options) || request.options.length > 10_000)
          throw new RangeError("Too many UI options");
        for (const option of request.options) checkText(option);
        break;
      case "input":
        if (request.placeholder !== undefined) checkText(request.placeholder);
        if (request.initialValue !== undefined) checkText(request.initialValue);
        break;
      case "editor":
        if (request.initialValue !== undefined) checkText(request.initialValue);
        break;
      case "project-trust":
        checkText(request.cwd);
        checkText(request.fingerprint);
        if (
          !Array.isArray(request.resources) ||
          request.resources.length > 10_000
        )
          throw new RangeError("Too many trust resources");
        for (const resource of request.resources) {
          checkText(resource.path);
          if (
            !["code", "settings", "instructions", "skill", "prompt"].includes(
              resource.kind,
            )
          )
            throw new TypeError("Invalid trust resource");
        }
        break;
      case "terminal":
        break;
      default:
        throw new TypeError("Unknown UI request kind");
    }
    if (Buffer.byteLength(JSON.stringify(request)) > 4 * UI_TEXT_LIMIT)
      throw new RangeError("UI request size exceeded");
  }
  private add(entry: Entry, signal?: AbortSignal): void {
    const id = key(entry.request);
    if (this.used.has(id)) throw new Error("UI request ID already used");
    if (this.entries.size >= 256)
      throw new RangeError("Too many pending UI requests");
    this.used.add(id);
    this.entries.set(id, entry);
    const parent =
      entry.request.parentUiId &&
      key({ ...entry.request, uiId: entry.request.parentUiId });
    if (!this.active || parent === this.active) this.focus(id);
    else entry.foreground?.(false);
    const deadline = entry.request.expiresAt;
    if (deadline !== undefined) {
      if (deadline <= Date.now()) {
        this.end(entry, "timeout");
        return;
      }
      entry.timer = setTimeout(
        () => this.end(entry, "timeout"),
        deadline - Date.now(),
      );
    }
    if (signal) {
      const abort = () => this.end(entry, "cancelled");
      signal.addEventListener("abort", abort, { once: true });
      entry.unlisten = () => signal.removeEventListener("abort", abort);
      if (signal.aborted) {
        abort();
        return;
      }
    }
    try {
      this.emit({ type: "request", request: structuredClone(entry.request) });
    } catch {
      this.end(entry, "failed");
    }
  }
  private focus(id?: string): void {
    // When a queued parent is promoted, its already-waiting descendants win.
    let selected = id ? this.entries.get(id) : undefined;
    while (selected) {
      const parentRequest = selected.request;
      const child = [...this.entries.values()].find(
        (entry) =>
          sameSession(entry.request, parentRequest) &&
          entry.request.parentUiId === parentRequest.uiId,
      );
      if (!child) break;
      id = key(child.request);
      selected = child;
    }
    if (id === this.active) return;
    const previous = this.active ? this.entries.get(this.active) : undefined;
    this.active = id;
    previous?.foreground?.(false);
    if (id) this.entries.get(id)?.foreground?.(true);
  }
  private end(
    entry: Entry,
    reason: EndReason,
    reply?: UIReply,
    cancelTerminal = true,
  ): void {
    const id = key(entry.request);
    if (this.entries.get(id) !== entry) return;
    // Remove first: cancellation callbacks and event sinks may re-enter.
    this.entries.delete(id);
    clearTimeout(entry.timer);
    entry.unlisten?.();
    // Descendants cannot outlive their parent.
    for (const child of [...this.entries.values()]) {
      if (
        sameSession(child.request, entry.request) &&
        child.request.parentUiId === entry.request.uiId
      )
        this.end(child, "cancelled");
    }
    if (this.active === id || (this.active && !this.entries.has(this.active))) {
      const parent =
        entry.request.parentUiId &&
        key({ ...entry.request, uiId: entry.request.parentUiId });
      this.focus(
        parent && this.entries.has(parent)
          ? parent
          : this.entries.keys().next().value,
      );
    }
    try {
      if (cancelTerminal) entry.cancelTerminal?.();
    } catch {
      /* A broken terminal disposer must not strand other sessions. */
    } finally {
      entry.finish(reply ?? { ...entry.request, kind: "cancel" });
      try {
        this.emit({
          type: "requestEnd",
          address: {
            hostId: entry.request.hostId,
            sessionId: entry.request.sessionId,
            epoch: entry.request.epoch,
            uiId: entry.request.uiId,
          },
          reason,
        });
      } catch {
        /* A lost view must not prevent cancellation/settlement. */
      }
    }
  }
}
