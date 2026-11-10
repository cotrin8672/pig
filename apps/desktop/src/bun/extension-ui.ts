import type {
  ExtensionUIContext,
  Theme,
} from "@earendil-works/pi-coding-agent";
import type {
  ExtensionStatus,
  ExtensionUIEvent,
  UIReply,
  UIRequest,
} from "../shared/extension-ui";
import type { SessionAddress, UIAddress } from "../shared/runtime-contract";
import type {
  TerminalClientCommand,
  TerminalHostEvent,
} from "../shared/terminal-ui";
import type { ComposerBridge } from "./composer-bridge";
import {
  configureTerminalUI,
  TerminalKeybindings,
  TerminalUIHost,
} from "./terminal-ui";
import {
  checkText,
  sameSession,
  type UIRequestBroker,
  validateSession,
} from "./ui-request-broker";

let desktopTheme: Theme | undefined;
/** Host-wide theme/keymap setup, once after profile bootstrap, before custom UI.
 * Native dialogs and Composer do not require terminal initialization.
 */
export function configureExtensionUI(
  theme: Theme,
  keybindings = new TerminalKeybindings(),
): void {
  configureTerminalUI(theme, keybindings);
  desktopTheme = theme;
}
export interface ExtensionUIHost {
  readonly uiContext: ExtensionUIContext;
  handleTerminal(command: TerminalClientCommand): void;
  getStatus(): ExtensionStatus;
  rotate(address: SessionAddress): void;
  cancelAll(reason: "stop" | "close" | "reload" | "disconnect"): void;
  dispose(): void;
  /** Runtime calls for shortcut registrations, with extension identity when known. */
  reportUnsupported(api: string, extensionName?: string): void;
}
type Options = {
  address: SessionAddress;
  broker: UIRequestBroker;
  drafts: ComposerBridge;
  emit: (event: ExtensionUIEvent) => void;
  emitTerminal: (event: TerminalHostEvent) => void;
};
type DialogOptions = Parameters<ExtensionUIContext["confirm"]>[2];
type NativeBody =
  | { kind: "confirm"; title: string; message: string }
  | { kind: "select"; title: string; options: string[] }
  | { kind: "input"; title: string; placeholder?: string }
  | { kind: "editor"; title: string; initialValue?: string };
type Surface = { terminal: TerminalUIHost; address?: UIAddress };

export function createExtensionUIHost(options: Options): ExtensionUIHost {
  const { broker, drafts, emit, emitTerminal } = options;
  validateSession(options.address);
  let address = { ...options.address };
  let status: ExtensionStatus = { statuses: [], widgets: [] };
  let disposed = false;
  let suspended = false;
  let cancelling = false;
  const surfaces = new Set<Surface>();
  const listeners = new Map<
    Parameters<ExtensionUIContext["onTerminalInput"]>[0],
    Map<Surface, () => void>
  >();
  const diagnostics = new Set<string>();
  const diagnostic = (api: string, detail = ""): string => {
    const message = `${api} is unsupported in the desktop Composer${detail ? ` (${detail})` : ""}. Use ui.custom() for terminal components.`;
    if (!diagnostics.has(`${api}:${detail}`)) {
      diagnostics.add(`${api}:${detail}`);
      emit({
        type: "capability",
        address: { ...address },
        api,
        supported: false,
        message,
      });
    }
    return message;
  };
  const unsupported = (api: string): never => {
    throw new Error(diagnostic(api));
  };
  const live = () => {
    if (disposed || suspended || cancelling)
      throw new DOMException("Extension UI host unavailable", "AbortError");
  };
  const publish = () =>
    emit({
      type: "status",
      address: { ...address },
      status: structuredClone(status),
    });
  const native = async (
    body: NativeBody,
    opts?: DialogOptions,
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
    const parent = broker.currentParent(address);
    const request: Exclude<UIRequest, { kind: "terminal" }> = {
      ...body,
      ...address,
      uiId: crypto.randomUUID(),
      parentUiId: parent?.uiId,
      expiresAt:
        opts?.timeout === undefined ? undefined : Date.now() + opts.timeout,
    };
    return broker.request(request, { signal: opts?.signal });
  };
  const setLabel = (
    key: "title" | "workingMessage" | "workingSymbol" | "hiddenThinkingLabel",
    value?: string,
  ) => {
    live();
    if (value !== undefined) checkText(value);
    status[key] = value;
    publish();
  };
  const custom: ExtensionUIContext["custom"] = async (
    factory,
    customOptions,
  ) => {
    live();
    if (!broker.isAvailable(address))
      throw new DOMException("No UI connected", "AbortError");
    const parent = broker.currentParent(address);
    if (
      [...surfaces].some((surface) => surface.terminal.pendingCount > 0) &&
      !parent
    )
      throw new Error(
        diagnostic(
          "custom nesting",
          "independent same-session invocation has no parent scope",
        ),
      );
    const invocationAddress = { ...address };
    let surface: Surface;
    const terminal = new TerminalUIHost(
      address.sessionId,
      address.epoch,
      (event) => {
        // The terminal module currently addresses session/epoch/uiId. Add hostId
        // here and reject hostless/wrong-host ingress below; never trust a UI hostId.
        const full = { ...event, hostId: invocationAddress.hostId };
        if (event.type === "open") {
          surface.address = { ...invocationAddress, uiId: event.uiId };
          terminal.deferView(event);
          broker.registerTerminal(
            {
              ...surface.address,
              kind: "terminal",
              title: event.title ?? "Extension UI",
              parentUiId: parent?.uiId,
            },
            () => terminal.accept({ ...event, type: "cancel" }),
            (active) => {
              if (active) terminal.awaitView(event);
              else terminal.deferView(event);
            },
          );
          // A failed/re-entrant Root sink can synchronously cancel registration.
          // Never publish open after close and resurrect an already-ended dialog.
          if (!terminal.pendingCount) return;
        } else if (event.type === "close" && surface.address) {
          broker.endTerminal(surface.address, event.reason);
        }
        emitTerminal(full);
      },
      {
        describe: () => ({ parentUiId: parent?.uiId }),
        onError: (error) => {
          if (!(error instanceof DOMException && error.name === "AbortError"))
            emit({
              type: "notify",
              address: invocationAddress,
              level: "error",
              message: `Extension terminal failed: ${String(error)}`,
            });
        },
      },
    );
    surface = { terminal };
    surfaces.add(surface);
    for (const [listener, subscriptions] of listeners)
      subscriptions.set(surface, terminal.addInputListener(listener));
    try {
      return await terminal.custom((...args) => {
        if (!surface.address)
          throw new Error("Terminal request was not registered");
        return broker.withContext(surface.address, () => factory(...args));
      }, customOptions);
    } finally {
      for (const subscriptions of listeners.values()) {
        subscriptions.get(surface)?.();
        subscriptions.delete(surface);
      }
      surfaces.delete(surface);
      terminal.dispose();
    }
  };
  const uiContext: ExtensionUIContext = {
    confirm: async (title, message, opts) => {
      const reply = await native({ kind: "confirm", title, message }, opts);
      return reply.kind === "confirm" && reply.value;
    },
    select: async (title, choices, opts) => {
      const reply = await native(
        { kind: "select", title, options: choices },
        opts,
      );
      return reply.kind === "select" ? reply.value : undefined;
    },
    input: async (title, placeholder, opts) => {
      const reply = await native({ kind: "input", title, placeholder }, opts);
      return reply.kind === "input" ? reply.value : undefined;
    },
    editor: async (title, initialValue) => {
      const reply = await native({ kind: "editor", title, initialValue });
      return reply.kind === "editor" ? reply.value : undefined;
    },
    custom,
    notify: (message, level = "info") => {
      live();
      checkText(message);
      if (!["info", "warning", "error"].includes(level))
        throw new TypeError("Invalid notification level");
      emit({ type: "notify", address: { ...address }, level, message });
    },
    onTerminalInput: (handler) => {
      live();
      const subscriptions = new Map<Surface, () => void>();
      // Each SDK subscription is independent, even if the function is reused.
      const listener: typeof handler = (data) => handler(data);
      listeners.set(listener, subscriptions);
      for (const surface of surfaces)
        subscriptions.set(surface, surface.terminal.addInputListener(listener));
      return () => {
        for (const unsubscribe of subscriptions.values()) unsubscribe();
        listeners.delete(listener);
      };
    },
    setStatus: (key, text) => {
      live();
      checkText(key, 256);
      if (text !== undefined) checkText(text);
      status.statuses = status.statuses.filter((entry) => entry.key !== key);
      if (text !== undefined) status.statuses.push({ key, text });
      publish();
    },
    setWidget: (key, content, widgetOptions) => {
      live();
      checkText(key, 256);
      if (typeof content === "function") unsupported("setWidget(component)");
      const placement = widgetOptions?.placement ?? "aboveEditor";
      if (placement !== "aboveEditor" && placement !== "belowEditor")
        throw new TypeError("Invalid widget placement");
      if (content !== undefined) {
        if (!Array.isArray(content) || content.length > 10_000)
          throw new TypeError("Invalid string widget");
        for (const line of content) checkText(line);
        checkText(content.join("\n"));
      }
      status.widgets = status.widgets.filter((entry) => entry.key !== key);
      if (content !== undefined)
        status.widgets.push({ key, lines: [...content], placement });
      publish();
    },
    setTitle: (title) => setLabel("title", title),
    setWorkingMessage: (message) => setLabel("workingMessage", message),
    setWorkingVisible: (visible) => {
      if (visible === false) setLabel("workingSymbol", "");
      else if (visible === true) setLabel("workingSymbol");
      else throw new TypeError("Invalid working visibility");
    },
    setWorkingIndicator: (indicator) => {
      if (indicator?.frames && indicator.frames.length > 1)
        unsupported("setWorkingIndicator(animated)");
      if (indicator?.frames && !Array.isArray(indicator.frames))
        throw new TypeError("Invalid working frames");
      setLabel(
        "workingSymbol",
        indicator?.frames ? (indicator.frames[0] ?? "") : undefined,
      );
    },
    setHiddenThinkingLabel: (label) => setLabel("hiddenThinkingLabel", label),
    getEditorText: () => {
      live();
      return drafts.expandedText(address);
    },
    setEditorText: (text) => {
      live();
      drafts.setText(address, text);
    },
    pasteToEditor: (text) => {
      live();
      drafts.paste(address, text);
    },
    setFooter: () => unsupported("setFooter"),
    setHeader: () => unsupported("setHeader"),
    setEditorComponent: () => unsupported("setEditorComponent"),
    getEditorComponent: () => unsupported("getEditorComponent"),
    addAutocompleteProvider: () => unsupported("addAutocompleteProvider"),
    get theme() {
      if (!desktopTheme) return unsupported("theme (not configured)");
      return desktopTheme;
    },
    getAllThemes: () =>
      desktopTheme ? [{ name: "desktop", path: undefined }] : [],
    getTheme: (name) => (name === "desktop" ? desktopTheme : undefined),
    setTheme: () => ({
      success: false,
      error: diagnostic("setTheme", "theme is Host-wide"),
    }),
    getToolsExpanded: () => unsupported("getToolsExpanded"),
    setToolsExpanded: () => unsupported("setToolsExpanded"),
  };
  const cancelAll: ExtensionUIHost["cancelAll"] = (reason) => {
    if (cancelling) return;
    cancelling = true;
    if (reason === "close" || reason === "reload") suspended = true;
    try {
      broker.cancelSession(address);
    } finally {
      for (const surface of surfaces) surface.terminal.cancelAll();
      for (const subscriptions of listeners.values()) {
        for (const unsubscribe of subscriptions.values()) unsubscribe();
        subscriptions.clear();
      }
      if (reason === "reload" || reason === "close") listeners.clear();
      cancelling = false;
    }
  };
  return {
    uiContext,
    handleTerminal(command) {
      const full = command as TerminalClientCommand & { hostId?: unknown };
      if (
        disposed ||
        suspended ||
        full.hostId !== address.hostId ||
        !sameSession({ ...command, hostId: full.hostId as string }, address)
      )
        return;
      for (const surface of surfaces) {
        if (surface.address?.uiId !== command.uiId) continue;
        if (
          (command.type === "ready" || command.type === "input") &&
          !broker.activate(surface.address)
        )
          return;
        broker.withContext(surface.address, () =>
          surface.terminal.accept(command),
        );
        return;
      }
    },
    getStatus: () => structuredClone(status),
    reportUnsupported: (api, extensionName) => {
      diagnostic(api, extensionName);
    },
    rotate(next) {
      liveForRotation();
      validateSession(next);
      if (next.hostId !== address.hostId || next.epoch <= address.epoch)
        throw new Error("Invalid UI epoch rotation");
      cancelAll("reload");
      for (const surface of surfaces) surface.terminal.dispose();
      surfaces.clear();
      address = { ...next };
      status = { statuses: [], widgets: [] };
      diagnostics.clear();
      suspended = false;
      publish();
    },
    cancelAll,
    dispose() {
      if (disposed) return;
      disposed = true;
      cancelAll("close");
      for (const surface of surfaces) surface.terminal.dispose();
      surfaces.clear();
      status = { statuses: [], widgets: [] };
      publish();
    },
  };
  function liveForRotation() {
    if (disposed) throw new Error("Extension UI host disposed");
  }
}
