import type {
  ExtensionStatus,
  ExtensionUIEvent,
  UIReply,
  UIRequest,
} from "../shared/extension-ui";
import type {
  DraftContent,
  SessionAddress,
  UIAddress,
} from "../shared/runtime-contract";
import type { ComposerBridge } from "./composer-bridge";
import {
  checkText,
  type UIRequestBroker,
  validateSession,
} from "./ui-request-broker";

export type NativeDialogOptions = { signal?: AbortSignal; timeout?: number };
type NativeBody =
  | { kind: "confirm"; title: string; message: string }
  | { kind: "select"; title: string; options: string[] }
  | { kind: "input"; title: string; placeholder?: string }
  | { kind: "editor"; title: string; initialValue?: string };
export type NativeUI = {
  confirm(
    title: string,
    message: string,
    options?: NativeDialogOptions,
  ): Promise<boolean>;
  select(
    title: string,
    choices: readonly string[],
    options?: NativeDialogOptions,
  ): Promise<string | undefined>;
  input(
    title: string,
    placeholder?: string,
    options?: NativeDialogOptions,
  ): Promise<string | undefined>;
  editor(
    title: string,
    initialValue?: string,
    options?: NativeDialogOptions,
  ): Promise<string | undefined>;
  notify(message: string, level?: "info" | "warning" | "error"): void;
  setStatus(key: string, text?: string): void;
  setWidget(
    key: string,
    lines?: readonly string[],
    placement?: "aboveEditor" | "belowEditor",
  ): void;
  setLabel(
    key: "title" | "workingMessage" | "workingSymbol" | "hiddenThinkingLabel",
    value?: string,
  ): void;
  readonly composer: {
    read(): ReturnType<ComposerBridge["read"]>;
    sync(
      content: DraftContent,
      expectedRevision: number,
    ): ReturnType<ComposerBridge["sync"]>;
    text(): string;
    setText(text: string): void;
    paste(text: string): void;
  };
};
export interface NativeUIHost {
  readonly ui: NativeUI;
  getStatus(): ExtensionStatus;
  rotate(address: SessionAddress): void;
  cancelAll(reason: "stop" | "close" | "reload" | "disconnect"): void;
  dispose(): void;
}

/** App-native GUI bridge injected into selected extensions by the Host. No SDK
 * facade, custom terminal, theme, keymap, or TUI compatibility surface. Ordinary
 * confirms are NOT durable security approvals; use native-approvals for those. */
export function createNativeUIHost(options: {
  address: SessionAddress;
  broker: UIRequestBroker;
  drafts: ComposerBridge;
  emit(event: ExtensionUIEvent): void;
}): NativeUIHost {
  const { broker, drafts, emit } = options;
  validateSession(options.address);
  let address = { ...options.address };
  let status: ExtensionStatus = { statuses: [], widgets: [] };
  let disposed = false,
    suspended = false,
    cancelling = false;
  const dialogs = new Set<UIAddress>();
  const live = () => {
    if (disposed || suspended || cancelling)
      throw new DOMException("Native UI unavailable", "AbortError");
  };
  const publish = () =>
    emit({
      type: "status",
      address: { ...address },
      status: structuredClone(status),
    });
  const native = async (
    body: NativeBody,
    opts?: NativeDialogOptions,
  ): Promise<UIReply> => {
    if (disposed || suspended || cancelling)
      return { ...address, uiId: crypto.randomUUID(), kind: "cancel" };
    if (
      opts?.timeout !== undefined &&
      (!Number.isFinite(opts.timeout) ||
        opts.timeout < 0 ||
        opts.timeout > 2_147_000_000)
    )
      throw new RangeError("Invalid dialog timeout");
    const request: Exclude<UIRequest, { kind: "terminal" }> = {
      ...body,
      ...address,
      uiId: crypto.randomUUID(),
      parentUiId: broker.currentParent(address)?.uiId,
      expiresAt:
        opts?.timeout === undefined ? undefined : Date.now() + opts.timeout,
    };
    dialogs.add(request);
    try {
      return await broker.request(request, { signal: opts?.signal });
    } finally {
      dialogs.delete(request);
    }
  };
  const ui: NativeUI = {
    async confirm(title, message, opts) {
      const reply = await native({ kind: "confirm", title, message }, opts);
      return reply.kind === "confirm" && reply.value;
    },
    async select(title, choices, opts) {
      const reply = await native(
        { kind: "select", title, options: [...choices] },
        opts,
      );
      return reply.kind === "select" ? reply.value : undefined;
    },
    async input(title, placeholder, opts) {
      const reply = await native({ kind: "input", title, placeholder }, opts);
      return reply.kind === "input" ? reply.value : undefined;
    },
    async editor(title, initialValue, opts) {
      const reply = await native({ kind: "editor", title, initialValue }, opts);
      return reply.kind === "editor" ? reply.value : undefined;
    },
    notify(message, level = "info") {
      live();
      checkText(message);
      if (!["info", "warning", "error"].includes(level))
        throw new TypeError("Invalid notification level");
      emit({ type: "notify", address: { ...address }, level, message });
    },
    setStatus(key, text) {
      live();
      checkText(key, 256);
      if (text !== undefined) checkText(text);
      status.statuses = status.statuses.filter((entry) => entry.key !== key);
      if (text !== undefined) status.statuses.push({ key, text });
      publish();
    },
    setWidget(key, lines, placement = "aboveEditor") {
      live();
      checkText(key, 256);
      if (placement !== "aboveEditor" && placement !== "belowEditor")
        throw new TypeError("Invalid widget placement");
      if (lines !== undefined) {
        if (!Array.isArray(lines) || lines.length > 10_000)
          throw new TypeError("Invalid string widget");
        for (const line of lines) checkText(line);
        checkText(lines.join("\n"));
      }
      status.widgets = status.widgets.filter((entry) => entry.key !== key);
      if (lines !== undefined)
        status.widgets.push({ key, lines: [...lines], placement });
      publish();
    },
    setLabel(key, value) {
      live();
      if (
        ![
          "title",
          "workingMessage",
          "workingSymbol",
          "hiddenThinkingLabel",
        ].includes(key)
      )
        throw new TypeError("Invalid status label");
      if (value !== undefined) checkText(value);
      status[key] = value;
      publish();
    },
    composer: {
      read() {
        live();
        return drafts.read(address);
      },
      sync(content, expectedRevision) {
        live();
        return drafts.sync({ ...address, content, expectedRevision });
      },
      text() {
        live();
        return drafts.expandedText(address);
      },
      setText(text) {
        live();
        drafts.setText(address, text);
      },
      paste(text) {
        live();
        drafts.paste(address, text);
      },
    },
  };
  const cancelAll: NativeUIHost["cancelAll"] = (reason) => {
    if (cancelling) return;
    cancelling = true;
    if (reason === "close" || reason === "reload") suspended = true;
    try {
      for (const dialog of dialogs) broker.cancel(dialog);
    } finally {
      cancelling = false;
    }
  };
  return {
    ui,
    getStatus: () => structuredClone(status),
    rotate(next) {
      if (disposed) throw new Error("Native UI disposed");
      validateSession(next);
      if (next.hostId !== address.hostId || next.epoch <= address.epoch)
        throw new Error("Invalid UI epoch rotation");
      cancelAll("reload");
      address = { ...next };
      status = { statuses: [], widgets: [] };
      suspended = false;
      publish();
    },
    cancelAll,
    dispose() {
      if (disposed) return;
      disposed = true;
      cancelAll("close");
      status = { statuses: [], widgets: [] };
      publish();
    },
  };
}
