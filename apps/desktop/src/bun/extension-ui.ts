import type {
  ExtensionUIContext,
  ExtensionUIDialogOptions,
} from "@earendil-works/pi-coding-agent";
import type {
  ExtensionDialogRequest,
  ExtensionDialogResponse,
} from "../shared/extension-dialog";

type Dialog = ExtensionDialogRequest extends infer R
  ? R extends ExtensionDialogRequest
    ? Omit<R, "id" | "sessionId">
    : never
  : never;
type Result = string | boolean | undefined;

export class ExtensionDialogs {
  private disposed = false;
  private closed = new Set<string>();
  activate(sessionId: string) {
    this.closed.delete(sessionId);
  }
  close(sessionId: string) {
    this.closed.add(sessionId);
    this.cancelSession(sessionId);
  }
  private pending = new Map<
    string,
    {
      request: ExtensionDialogRequest;
      finish: (value: Result) => void;
    }
  >();
  private listeners = new Set<
    (sessionId: string, requests: ExtensionDialogRequest[]) => void
  >();

  subscribe(
    listener: (sessionId: string, requests: ExtensionDialogRequest[]) => void,
  ) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  list(sessionId?: string): ExtensionDialogRequest[] {
    return [...this.pending.values()]
      .map(({ request }) => structuredClone(request))
      .filter(
        (request) => sessionId === undefined || request.sessionId === sessionId,
      );
  }
  private changed(sessionId: string) {
    for (const listener of this.listeners) {
      try {
        listener(sessionId, this.list(sessionId));
      } catch (error) {
        console.error("Cannot publish extension dialogs:", error);
      }
    }
  }
  request(
    sessionId: string,
    dialog: Dialog,
    opts?: ExtensionUIDialogOptions,
  ): Promise<Result> {
    if (
      !sessionId ||
      typeof dialog.title !== "string" ||
      (dialog.kind === "select" &&
        (!Array.isArray(dialog.options) ||
          !dialog.options.every((v) => typeof v === "string"))) ||
      (dialog.kind === "confirm" && typeof dialog.message !== "string") ||
      (dialog.kind === "input" &&
        dialog.placeholder !== undefined &&
        typeof dialog.placeholder !== "string") ||
      (dialog.kind === "editor" &&
        dialog.prefill !== undefined &&
        typeof dialog.prefill !== "string") ||
      (opts?.timeout !== undefined &&
        (!Number.isFinite(opts.timeout) || opts.timeout < 0))
    )
      throw new Error("Invalid extension dialog.");
    const cancelled = dialog.kind === "confirm" ? false : undefined;
    if (this.disposed || this.closed.has(sessionId) || opts?.signal?.aborted)
      return Promise.resolve(cancelled);
    const request = {
      ...structuredClone(dialog),
      id: crypto.randomUUID(),
      sessionId,
    } as ExtensionDialogRequest;
    return new Promise((resolve) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const abort = () => finish(cancelled);
      const finish = (value: Result) => {
        if (!this.pending.delete(request.id)) return;
        clearTimeout(timer);
        opts?.signal?.removeEventListener("abort", abort);
        resolve(value);
        this.changed(sessionId);
      };
      this.pending.set(request.id, { request, finish });
      opts?.signal?.addEventListener("abort", abort, { once: true });
      if (opts?.timeout !== undefined) timer = setTimeout(abort, opts.timeout);
      this.changed(sessionId);
    });
  }
  answer(value: ExtensionDialogResponse) {
    if (
      !value ||
      typeof value.id !== "string" ||
      typeof value.sessionId !== "string" ||
      (value.cancelled !== undefined && typeof value.cancelled !== "boolean")
    )
      throw new Error("Invalid extension dialog response.");
    const pending = this.pending.get(value.id);
    if (!pending || pending.request.sessionId !== value.sessionId)
      throw new Error("Extension dialog is no longer pending in this session.");
    const { request, finish } = pending;
    if (value.cancelled) {
      if (value.value !== undefined)
        throw new Error("Cancelled response must not include a value.");
      finish(request.kind === "confirm" ? false : undefined);
      return;
    }
    if (
      request.kind === "confirm"
        ? typeof value.value !== "boolean"
        : typeof value.value !== "string"
    )
      throw new Error("Invalid extension dialog value.");
    if (
      request.kind === "select" &&
      !request.options.includes(value.value as string)
    )
      throw new Error("Choose an offered option.");
    finish(value.value);
  }
  cancelSession(sessionId: string) {
    for (const { request, finish } of [...this.pending.values()])
      if (request.sessionId === sessionId)
        finish(request.kind === "confirm" ? false : undefined);
  }
  dispose() {
    this.disposed = true;
    for (const { request } of [...this.pending.values()])
      this.cancelSession(request.sessionId);
  }
}

export function notificationUI(
  base: ExtensionUIContext,
  notify: ExtensionUIContext["notify"],
  dialogs: ExtensionDialogs,
  sessionId: string,
): ExtensionUIContext {
  return {
    ...base,
    notify,
    select: (title, options, opts) =>
      dialogs.request(
        sessionId,
        { kind: "select", title, options },
        opts,
      ) as Promise<string | undefined>,
    confirm: (title, message, opts) =>
      dialogs.request(
        sessionId,
        { kind: "confirm", title, message },
        opts,
      ) as Promise<boolean>,
    input: (title, placeholder, opts) =>
      dialogs.request(
        sessionId,
        { kind: "input", title, placeholder },
        opts,
      ) as Promise<string | undefined>,
    editor: (title, prefill) =>
      dialogs.request(sessionId, { kind: "editor", title, prefill }) as Promise<
        string | undefined
      >,
    custom: async () => {
      throw new Error(
        "Extension TUI components are not supported in pig (mode: rpc).",
      );
    },
  };
}
