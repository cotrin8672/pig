import {
  type ExtensionUIContext,
  getSelectListTheme,
  initTheme,
  type KeybindingsManager as SDKKeybindingsManager,
  type Theme,
} from "@earendil-works/pi-coding-agent";
import {
  type Component,
  formatProgramStatus,
  type KeybindingDefinitions,
  type KeybindingsConfig,
  KeybindingsManager,
  type OverlayOptions,
  type ProgramStatus,
  StdinBuffer,
  setCapabilities,
  setKeybindings,
  setKittyProtocolActive,
  type Terminal,
  type TerminalColorScheme,
  type TerminalColors,
  type TUI,
  TUI_KEYBINDINGS,
  TuiAltScreen,
  type TuiInputListener,
} from "@earendil-works/pi-tui";
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

type CustomComponent = Component & { dispose?(): void };
type Factory<T> = (
  tui: TUI,
  theme: Theme,
  keybindings: SDKKeybindingsManager,
  done: (result: T) => void,
) => CustomComponent | Promise<CustomComponent>;
type Options = Parameters<ExtensionUIContext["custom"]>[1];
// pi-coding-agent 1.5.0 exports its manager as a TYPE ONLY. Use the public pi-tui
// manager and reproduce the SDK 1.5.0 definitions, not a private deep import.
const windowsKeys =
  process.platform === "win32" ||
  (process.platform === "linux" &&
    Boolean(process.env.WSL_DISTRO_NAME || process.env.WSL_INTEROP));
export const TERMINAL_KEYBINDINGS = {
  ...TUI_KEYBINDINGS,
  "tui.editor.undo": {
    defaultKeys:
      process.platform === "win32"
        ? "ctrl+z"
        : windowsKeys
          ? "alt+z"
          : "ctrl+-",
  },
  "tui.altScreen.previousPrompt": {
    defaultKeys: windowsKeys ? "ctrl+up" : ["ctrl+shift+up", "ctrl+up"],
  },
  "tui.altScreen.nextPrompt": {
    defaultKeys: windowsKeys ? "ctrl+down" : ["ctrl+shift+down", "ctrl+down"],
  },
  "tui.altScreen.search": {
    defaultKeys: windowsKeys ? "ctrl+f" : "ctrl+shift+f",
  },
  "app.interrupt": { defaultKeys: "escape" },
  "app.clear": { defaultKeys: "ctrl+c" },
  "app.exit": { defaultKeys: "ctrl+d" },
  "app.suspend": { defaultKeys: process.platform === "win32" ? [] : "ctrl+z" },
  "app.thinking.cycle": { defaultKeys: "shift+tab" },
  "app.thinking.save": { defaultKeys: "ctrl+s" },
  "app.model.cycleForward": { defaultKeys: "ctrl+p" },
  "app.model.cycleBackward": {
    defaultKeys: windowsKeys ? "alt+p" : "shift+ctrl+p",
  },
  "app.model.select": { defaultKeys: "ctrl+l" },
  "app.tools.expand": { defaultKeys: "ctrl+o" },
  "app.thinking.toggle": { defaultKeys: "ctrl+t" },
  "app.session.toggleNamedFilter": { defaultKeys: "ctrl+n" },
  "app.editor.external": { defaultKeys: "ctrl+g" },
  "app.message.copy": { defaultKeys: "ctrl+x" },
  "app.message.followUp": { defaultKeys: windowsKeys ? "ctrl+q" : "alt+enter" },
  "app.message.dequeue": { defaultKeys: windowsKeys ? "alt+q" : "alt+up" },
  "app.clipboard.pasteImage": { defaultKeys: windowsKeys ? "alt+v" : "ctrl+v" },
  "app.session.new": { defaultKeys: [] },
  "app.session.tree": { defaultKeys: [] },
  "app.session.fork": { defaultKeys: [] },
  "app.session.resume": { defaultKeys: [] },
  "app.tree.foldOrUp": {
    defaultKeys:
      process.platform === "darwin"
        ? ["alt+left", "ctrl+left"]
        : ["ctrl+left", "alt+left"],
  },
  "app.tree.unfoldOrDown": {
    defaultKeys:
      process.platform === "darwin"
        ? ["alt+right", "ctrl+right"]
        : ["ctrl+right", "alt+right"],
  },
  "app.tree.editLabel": { defaultKeys: "shift+l" },
  "app.tree.toggleLabelTimestamp": { defaultKeys: "shift+t" },
  "app.session.togglePath": { defaultKeys: "ctrl+p" },
  "app.session.toggleSort": { defaultKeys: "ctrl+s" },
  "app.session.rename": { defaultKeys: "ctrl+r" },
  "app.session.delete": { defaultKeys: "ctrl+d" },
  "app.session.deleteNoninvasive": { defaultKeys: "ctrl+backspace" },
  "app.models.save": { defaultKeys: "ctrl+s" },
  "app.models.enableAll": { defaultKeys: "ctrl+a" },
  "app.models.clearAll": { defaultKeys: "ctrl+x" },
  "app.models.toggleProvider": { defaultKeys: "ctrl+p" },
  "app.models.reorderUp": { defaultKeys: "alt+up" },
  "app.models.reorderDown": { defaultKeys: "alt+down" },
  "app.tree.filter.default": { defaultKeys: "ctrl+d" },
  "app.tree.filter.noTools": { defaultKeys: "ctrl+t" },
  "app.tree.filter.userOnly": { defaultKeys: "ctrl+u" },
  "app.tree.filter.labeledOnly": { defaultKeys: "ctrl+l" },
  "app.tree.filter.all": { defaultKeys: "ctrl+a" },
  "app.tree.filter.cycleForward": { defaultKeys: "ctrl+o" },
  "app.tree.filter.cycleBackward": { defaultKeys: "shift+ctrl+o" },
} satisfies KeybindingDefinitions;
export class TerminalKeybindings extends KeybindingsManager {
  constructor(
    bindings: KeybindingsConfig = {},
    private readonly load?: () => KeybindingsConfig,
  ) {
    super(TERMINAL_KEYBINDINGS, bindings);
  }
  reload(): void {
    // No loader means retain explicit application settings, never reset to {}.
    if (this.load) this.setUserBindings(this.load());
  }
  getEffectiveConfig(): KeybindingsConfig {
    return this.getResolvedBindings();
  }
}
let environment: { theme: Theme; keybindings: TerminalKeybindings } | undefined;

/** Configure once process-wide. The caller supplies profile bindings and a reload
 * loader via TerminalKeybindings; no private SDK modules or user HOME are imported. */
export function configureTerminalUI(
  theme: Theme,
  keybindings: TerminalKeybindings,
): void {
  if (environment) {
    if (environment.theme !== theme || environment.keybindings !== keybindings)
      throw new Error(
        "Terminal UI environment is process-wide; cannot replace it per session",
      );
    return;
  }
  // SDK list helpers use a global theme. Never initialize a watcher per session.
  try {
    getSelectListTheme().selectedText("");
  } catch {
    initTheme("dark", false);
  }
  setCapabilities({ images: null, trueColor: true, hyperlinks: true });
  setKittyProtocolActive(false);
  setKeybindings(keybindings);
  environment = { theme, keybindings };
}
function abortError(reason = "Terminal UI cancelled") {
  return new DOMException(reason, "AbortError");
}
function terminalReply(data: string): boolean {
  // Responses, not keyboard/paste, must reach listeners during async initialization.
  // No palette/Kitty capability is advertised; queryTerminalColors below resolves empty.
  // biome-ignore lint/suspicious/noControlCharactersInRegex: Terminal protocol framing.
  return /^\x1b(?:\[(?:\??[\d;]*[cnR]|[?][\d;]*\$y)|\](?:1[01];|4;\d+;|7501;)|P>\|)/.test(
    data,
  );
}

/** Component byte transport only: not a PTY and never touches process stdin/stdout. */
export class VirtualTerminal implements Terminal {
  readonly kittyProtocolActive = false;
  private buffer?: StdinBuffer;
  private onInput?: (data: string) => void;
  private onResize?: () => void;
  private closed = false;
  private inputReady = false;
  private queued: string[] = [];
  private queuedBytes = 0;
  private unframedBytes = 0;
  constructor(
    public columns: number,
    public rows: number,
    private readonly output: (data: string) => void,
    private readonly fail: (error: unknown) => void,
  ) {}
  start(onInput: (data: string) => void, onResize: () => void) {
    if (this.closed) throw abortError();
    this.onInput = onInput;
    this.onResize = onResize;
    if (this.buffer) return;
    const buffer = new StdinBuffer();
    this.buffer = buffer;
    buffer.on("data", (data: string) => this.frame(data));
    buffer.on("paste", (data: string) =>
      this.frame(`\x1b[200~${data}\x1b[201~`),
    );
    this.write("\x1b[?2004h");
  }
  private frame(data: string) {
    this.unframedBytes = Math.max(0, this.unframedBytes - utf8Bytes(data));
    if (this.closed) return;
    if (!this.inputReady && !terminalReply(data)) {
      this.queuedBytes += utf8Bytes(data);
      if (
        this.queuedBytes > LIMIT.bufferedInputBytes ||
        this.queued.length >= LIMIT.pendingEvents
      ) {
        this.fail(new RangeError("Terminal input buffer exceeded"));
        return;
      }
      this.queued.push(data);
    } else this.deliver(data);
  }
  private deliver(data: string) {
    try {
      this.onInput?.(data);
    } catch (error) {
      this.fail(error);
    }
  }
  input(data: string, bytes = utf8Bytes(data)) {
    if (this.closed) return;
    this.unframedBytes += bytes;
    if (this.unframedBytes + this.queuedBytes > LIMIT.bufferedInputBytes) {
      this.fail(new RangeError("Terminal input buffer exceeded"));
      return;
    }
    try {
      this.buffer?.process(data);
    } catch (error) {
      this.fail(error);
    }
  }
  resumeInput() {
    this.inputReady = true;
    const queued = this.queued;
    this.queued = [];
    this.queuedBytes = 0;
    for (const data of queued) {
      if (this.closed) break;
      this.deliver(data);
    }
  }
  resize(cols: number, rows: number) {
    if (this.closed) return;
    this.columns = cols;
    this.rows = rows;
    try {
      this.onResize?.();
    } catch (error) {
      this.fail(error);
    }
  }
  stop() {
    if (this.buffer) this.write("\x1b[?2004l");
    this.buffer?.destroy();
    this.buffer?.removeAllListeners();
    this.buffer = undefined;
    this.onInput = undefined;
    this.onResize = undefined;
    this.queued = [];
    this.queuedBytes = this.unframedBytes = 0;
    if (!this.closed) this.fail(abortError("Terminal stopped"));
  }
  dispose() {
    this.closed = true;
    this.stop();
  }
  async drainInput() {
    this.buffer?.clear();
    this.queued = [];
    this.queuedBytes = this.unframedBytes = 0;
  }
  write(data: string) {
    if (!this.closed) this.output(data);
  }
  moveBy(lines: number) {
    if (lines !== 0)
      this.write(`\x1b[${Math.abs(lines)}${lines < 0 ? "A" : "B"}`);
  }
  hideCursor() {
    this.write("\x1b[?25l");
  }
  showCursor() {
    this.write("\x1b[?25h");
  }
  clearLine() {
    this.write("\x1b[2K");
  }
  clearFromCursor() {
    this.write("\x1b[0J");
  }
  clearScreen() {
    this.write("\x1b[2J\x1b[H");
  }
  setTitle(title: string) {
    // biome-ignore lint/suspicious/noControlCharactersInRegex: Strip OSC terminators/control injection.
    this.write(`\x1b]0;${title.replace(/[\x00-\x1f\x7f-\x9f]/g, "")}\x07`);
  }
  setProgress(active: boolean) {
    this.write(`\x1b]9;4;${active ? 3 : 0}\x07`);
  }
  setProgramStatus(status: ProgramStatus) {
    this.write(formatProgramStatus(status));
  }
}

/** Real SDK scheduling/composition, with scheduled render exceptions contained. */
class HostedTui extends TuiAltScreen {
  private released = false;
  private started = false;
  // The base constructor subscribes through overrides before fields initialize.
  private declare subscriptions: Set<() => void> | undefined;
  constructor(
    terminal: Terminal,
    private readonly fail: (error: unknown) => void,
  ) {
    super(terminal, false, undefined, { mouse: true, copyOnSelect: false });
  }
  protected override doRender() {
    if (this.released) return;
    try {
      super.doRender();
    } catch (error) {
      this.fail(error);
    }
  }
  override start() {
    if (this.released || this.started) return;
    this.started = true;
    super.start();
  }
  override requestRender(force?: boolean) {
    if (!this.released) super.requestRender(force);
  }
  override stop() {
    if (!this.released) this.fail(abortError("Terminal UI stopped"));
  }
  override addInputListener(listener: TuiInputListener) {
    return this.released
      ? () => {}
      : this.track(super.addInputListener(listener));
  }
  override onTerminalColorSchemeChange(
    listener: (scheme: TerminalColorScheme) => void,
  ) {
    return this.released
      ? () => {}
      : this.track(super.onTerminalColorSchemeChange(listener));
  }
  private track(unsubscribe: () => void) {
    const cleanup = () => {
      unsubscribe();
      this.subscriptions?.delete(cleanup);
    };
    this.subscriptions ??= new Set();
    this.subscriptions.add(cleanup);
    return cleanup;
  }
  override async queryTerminalColors(): Promise<TerminalColors> {
    return {};
  }
  release() {
    if (this.released) return;
    this.released = true;
    for (const unsubscribe of this.subscriptions ?? []) {
      try {
        unsubscribe();
      } catch {
        /* Continue releasing owned resources. */
      }
    }
    this.subscriptions?.clear();
    try {
      super.stop({ preserveScreen: true });
    } finally {
      try {
        while (this.hasOverlayEntries) this.hideOverlay();
        this.setFocus(null);
      } finally {
        this.clear();
        this.setLayoutRoot(undefined);
      }
    }
  }
}

type Pending = {
  addListener: (listener: TuiInputListener) => void;
  removeListener: (listener: TuiInputListener) => void;
  address: UIAddress;
  accept: (command: TerminalClientCommand) => void;
  cancel: (reason?: string) => void;
  awaitView: () => void;
  deferView: () => void;
};
export type TerminalUIHostOptions = {
  readyTimeoutMs?: number;
  ackTimeoutMs?: number;
  /** Capture the root broker's known invocation context, not an independent FIFO. */
  describe?: () => { title?: string; parentUiId?: string };
  onError?: (error: unknown, address: UIAddress) => void;
};

export class TerminalUIHost {
  private readonly pending = new Map<string, Pending>();
  private readonly inputListeners = new Set<TuiInputListener>();
  private disposed = false;
  private cancelling = false;
  constructor(
    readonly sessionId: string,
    readonly epoch: number,
    private readonly emit: (event: TerminalHostEvent) => void,
    private readonly options: TerminalUIHostOptions = {},
  ) {
    if (!environment)
      throw new Error("Call configureTerminalUI once before creating a host");
    if (!validAddress({ sessionId, epoch, uiId: "validation" }))
      throw new TypeError("Invalid terminal host address");
    for (const timeout of [options.readyTimeoutMs, options.ackTimeoutMs]) {
      if (
        timeout !== undefined &&
        (!Number.isFinite(timeout) || timeout <= 0 || timeout > 300_000)
      )
        throw new RangeError("Invalid terminal transport timeout");
    }
  }
  get pendingCount(): number {
    return this.pending.size;
  }
  /** SDK onTerminalInput bridge: affects only this host's actual TUI input path. */
  addInputListener(listener: TuiInputListener): () => void {
    if (this.disposed) return () => {};
    this.inputListeners.add(listener);
    for (const request of this.pending.values()) request.addListener(listener);
    return () => {
      this.inputListeners.delete(listener);
      for (const request of this.pending.values())
        request.removeListener(listener);
    };
  }
  custom: ExtensionUIContext["custom"] = <T>(
    factory: Factory<T>,
    options?: Options,
  ): Promise<T> => {
    if (this.disposed || this.cancelling)
      return Promise.reject(abortError("Terminal UI host unavailable"));
    if (this.pending.size >= LIMIT.openRequests)
      return Promise.reject(new RangeError("Too many terminal UI requests"));
    const address: UIAddress = {
      sessionId: this.sessionId,
      epoch: this.epoch,
      uiId: crypto.randomUUID(),
    };
    const shared = environment;
    if (!shared)
      return Promise.reject(new Error("Terminal UI environment unavailable"));
    return new Promise<T>((resolve, reject) => {
      let settled = false;
      let ready = false;
      let terminal: VirtualTerminal | undefined;
      let tui: HostedTui | undefined;
      let component: CustomComponent | undefined;
      let readyTimer: ReturnType<typeof setTimeout> | undefined;
      let ackTimer: ReturnType<typeof setTimeout> | undefined;
      let outputSeq = 0;
      let ackSeq = 0;
      let inputSeq = 0;
      let pendingBytes = 0;
      const output = new Map<number, { bytes: number; at: number }>();
      const commands = new TerminalRateLimit(LIMIT.commandsPerSecond);
      const resizes = new TerminalRateLimit(LIMIT.resizesPerSecond);
      const writes = new TerminalRateLimit(LIMIT.outputEventsPerSecond);
      const inputSubscriptions = new Map<TuiInputListener, () => void>();
      const addListener = (listener: TuiInputListener) => {
        if (tui && !settled && !inputSubscriptions.has(listener))
          inputSubscriptions.set(listener, tui.addInputListener(listener));
      };
      const removeListener = (listener: TuiInputListener) => {
        inputSubscriptions.get(listener)?.();
        inputSubscriptions.delete(listener);
      };
      const disposedComponents = new WeakSet<CustomComponent>();
      const disposeComponent = (value: CustomComponent) => {
        if (disposedComponents.has(value)) return;
        disposedComponents.add(value);
        try {
          value.dispose?.();
        } catch {
          /* Disposer must not strand the Promise. */
        }
      };
      const finish = (
        outcome: { value: T } | { error: unknown; cancelled?: boolean },
      ) => {
        if (settled) return;
        settled = true;
        clearTimeout(readyTimer);
        clearTimeout(ackTimer);
        for (const unsubscribe of inputSubscriptions.values()) {
          try {
            unsubscribe();
          } catch {
            /* Continue cleanup. */
          }
        }
        inputSubscriptions.clear();
        this.pending.delete(address.uiId);
        output.clear();
        pendingBytes = 0;
        // Suppress teardown output: the browser closes this whole surface.
        try {
          terminal?.dispose();
        } catch {
          /* Continue remaining cleanup. */
        }
        try {
          tui?.release();
        } catch {
          /* Continue remaining cleanup. */
        }
        if (component) disposeComponent(component);
        const reason =
          "value" in outcome
            ? "done"
            : outcome.cancelled
              ? "cancelled"
              : "failed";
        try {
          this.emit({ ...address, type: "close", reason });
        } catch (error) {
          if ("value" in outcome) outcome = { error };
        }
        if ("error" in outcome) {
          try {
            this.options.onError?.(outcome.error, address);
          } catch {
            /* Diagnostics are advisory. */
          }
          reject(outcome.error);
        } else resolve(outcome.value);
      };
      const fail = (error: unknown) =>
        finish({
          error,
          cancelled:
            error instanceof DOMException && error.name === "AbortError",
        });
      const armAck = () => {
        clearTimeout(ackTimer);
        const first = output.values().next().value;
        if (!first || settled) return;
        const timeout = this.options.ackTimeoutMs ?? LIMIT.ackTimeoutMs;
        ackTimer = setTimeout(
          () => fail(new Error("Terminal output acknowledgement timed out")),
          Math.max(1, first.at + timeout - performance.now()),
        );
      };
      const write = (data: string) => {
        if (settled || !data) return;
        const bytes = utf8Bytes(data);
        if (
          bytes > LIMIT.outputChunkBytes ||
          pendingBytes + bytes > LIMIT.pendingOutputBytes ||
          output.size >= LIMIT.pendingEvents ||
          !writes.accept()
        ) {
          fail(new RangeError("Terminal output limit exceeded"));
          return;
        }
        const seq = ++outputSeq;
        pendingBytes += bytes;
        output.set(seq, { bytes, at: performance.now() });
        if (output.size === 1) armAck();
        try {
          this.emit({ ...address, type: "data", seq, data });
        } catch (error) {
          fail(error);
        }
      };
      const mount = (value: CustomComponent) => {
        if (settled) {
          disposeComponent(value);
          return;
        }
        component = value;
        if (!tui) return;
        if (options?.overlay) {
          const width = (
            value as CustomComponent & { width?: OverlayOptions["width"] }
          ).width;
          // SDK 1.5.0 evaluates this OUTER callback once. visible()/percent sizes remain dynamic in TUI.
          const overlayOptions =
            typeof options.overlayOptions === "function"
              ? options.overlayOptions()
              : (options.overlayOptions ?? (width ? { width } : undefined));
          if (settled) return;
          const handle = tui.showOverlay(value, overlayOptions);
          options.onHandle?.(handle);
        } else {
          tui.addChild(value);
          tui.setFocus(value);
          if (options?.blocked)
            terminal?.setProgramStatus({
              state: "blocked",
              ...options.blocked,
            });
        }
        if (!settled) {
          terminal?.resumeInput();
          tui.requestRender();
        }
      };
      const deferView = () => {
        clearTimeout(readyTimer);
        readyTimer = undefined;
      };
      const awaitView = () => {
        if (ready || settled) return;
        deferView();
        readyTimer = setTimeout(
          () => fail(new Error("Terminal view readiness timed out")),
          this.options.readyTimeoutMs ?? LIMIT.readyTimeoutMs,
        );
      };
      const start = (cols: number, rows: number) => {
        ready = true;
        deferView(); // No human-input deadline after readiness.
        terminal = new VirtualTerminal(cols, rows, write, fail);
        try {
          tui = new HostedTui(terminal, fail);
          for (const listener of this.inputListeners) addListener(listener);
          tui.start();
          if (settled) return;
          const value = factory(
            tui,
            shared.theme,
            shared.keybindings as unknown as SDKKeybindingsManager,
            (result) => finish({ value: result }),
          );
          // Observe even synchronous done and cancellation from inside factory.
          Promise.resolve(value).then(mount).catch(fail);
        } catch (error) {
          fail(error);
        }
      };
      const request: Pending = {
        address,
        awaitView,
        deferView,
        addListener,
        removeListener,
        cancel: (reason) =>
          finish({ error: abortError(reason), cancelled: true }),
        accept: (command) => {
          if (settled) return;
          // Always permit cancellation, even following a flood.
          if (command.type === "cancel") {
            request.cancel();
            return;
          }
          if (!commands.accept()) {
            fail(new RangeError("Terminal command rate exceeded"));
            return;
          }
          switch (command.type) {
            case "ready":
              if (!ready && validDimensions(command.cols, command.rows))
                start(command.cols, command.rows);
              break;
            case "resize":
              if (ready && validDimensions(command.cols, command.rows)) {
                if (!resizes.accept())
                  fail(new RangeError("Terminal resize rate exceeded"));
                else terminal?.resize(command.cols, command.rows);
              }
              break;
            case "input": {
              if (
                !ready ||
                !validSequence(command.inputSeq) ||
                typeof command.data !== "string" ||
                (command.encoding !== "text" && command.encoding !== "binary")
              )
                return;
              if (command.inputSeq <= inputSeq) return;
              if (command.inputSeq !== inputSeq + 1) {
                fail(new Error("Terminal input sequence gap"));
                return;
              }
              try {
                const bytes = inputBytes(command.data, command.encoding);
                if (bytes > LIMIT.inputBytes)
                  throw new RangeError("Terminal input packet exceeded");
                inputSeq = command.inputSeq;
                // Binary is a Latin-1 byte string, not decoded/re-encoded as UTF-8.
                terminal?.input(command.data, bytes);
              } catch (error) {
                fail(error);
              }
              break;
            }
            case "ack":
              if (
                !validSequence(command.seq) ||
                command.seq <= ackSeq ||
                command.seq > outputSeq
              )
                return;
              ackSeq = command.seq;
              for (const [seq, item] of output) {
                if (seq > ackSeq) break;
                pendingBytes -= item.bytes;
                output.delete(seq);
              }
              armAck();
              break;
          }
        },
      };
      this.pending.set(address.uiId, request);
      awaitView();
      try {
        const metadata = this.options.describe?.();
        this.emit({ ...metadata, ...address, type: "open" });
      } catch (error) {
        fail(error);
      }
    });
  };
  private find(address: UIAddress): Pending | undefined {
    if (
      !validAddress(address) ||
      address.sessionId !== this.sessionId ||
      address.epoch !== this.epoch
    )
      return;
    const request = this.pending.get(address.uiId);
    return request && sameAddress(request.address, address)
      ? request
      : undefined;
  }
  accept(command: TerminalClientCommand): void {
    this.find(command)?.accept(command);
  }
  /** Root broker parks queued requests without charging human queue time as startup failure. */
  deferView(address: UIAddress): void {
    this.find(address)?.deferView();
  }
  /** Arm bounded readiness when the broker actually offers this surface to the WebView. */
  awaitView(address: UIAddress): void {
    this.find(address)?.awaitView();
  }
  cancelAll(reason?: string): void {
    if (this.cancelling) return;
    this.cancelling = true;
    try {
      for (const request of [...this.pending.values()]) request.cancel(reason);
    } finally {
      this.cancelling = false;
    }
  }
  disconnect(): void {
    this.cancelAll(
      "Terminal WebView disconnected; live UI resume is unavailable",
    );
  }
  dispose(): void {
    this.inputListeners.clear();
    if (this.disposed) return;
    this.disposed = true;
    this.cancelAll("Terminal UI host disposed");
  }
}
