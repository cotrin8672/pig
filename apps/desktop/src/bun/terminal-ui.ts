import {
  type KeybindingsManager as AppKeybindingsManager,
  type ExtensionUIContext,
  getSelectListTheme,
  initTheme,
  type Theme,
} from "@earendil-works/pi-coding-agent";
import {
  type Component,
  formatProgramStatus,
  type Keybinding,
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
import type { TerminalUICommand, TerminalUIEvent } from "../shared/terminal-ui";

// shortcut: component-based TUI only; add a PTY transport for extensions that own stdout.
type CustomComponent = Component & { dispose?(): void };
type Factory<T> = (
  tui: TUI,
  theme: Theme,
  keybindings: AppKeybindingsManager,
  done: (result: T) => void,
) => CustomComponent | Promise<CustomComponent>;
type Options = Parameters<ExtensionUIContext["custom"]>[1];
const MAX_INPUT = 64 * 1024;
const MAX_BUFFERED_INPUT = 1024 * 1024;

const definitions = {
  ...TUI_KEYBINDINGS,
  "app.interrupt": { defaultKeys: "escape" },
  "app.clear": { defaultKeys: "ctrl+c" },
  "app.exit": { defaultKeys: "ctrl+d" },
} as const;

// The SDK manager is type-only and has a private configPath. Implement its public
// surface without loading private internals or reading/writing user keymaps.
class BrowserKeybindings extends KeybindingsManager {
  constructor() {
    super(definitions);
  }
  reload() {
    this.setUserBindings({});
  }
  getEffectiveConfig() {
    return this.getResolvedBindings();
  }
  override getDefinition(id: Keybinding) {
    return Object.hasOwn(definitions, id)
      ? super.getDefinition(id)
      : { defaultKeys: [] };
  }
}
const keybindings = new BrowserKeybindings();
let globalsInitialized = false;
function initializeGlobals() {
  if (globalsInitialized) return;
  setCapabilities({ images: null, trueColor: true, hyperlinks: true });
  setKittyProtocolActive(false);
  setKeybindings(keybindings);
  try {
    getSelectListTheme().selectedText("");
  } catch {
    initTheme("dark", false);
  }
  globalsInitialized = true;
}

function abortError(reason = "Terminal UI cancelled") {
  return new DOMException(reason, "AbortError");
}
function validDimensions(cols: number, rows: number) {
  return (
    Number.isInteger(cols) &&
    Number.isInteger(rows) &&
    cols >= 2 &&
    cols <= 500 &&
    rows >= 2 &&
    rows <= 200
  );
}

/** Browser byte transport, deliberately unrelated to ProcessTerminal. */
class VirtualTerminal implements Terminal {
  readonly kittyProtocolActive = false;
  private buffer?: StdinBuffer;
  private onInput?: (data: string) => void;
  private onResize?: () => void;
  private closed = false;
  private inputReady = false;
  private queuedInput: string[] = [];
  private queuedChars = 0;
  private unframedChars = 0;

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
    buffer.on("data", (data) => {
      this.unframedChars = Math.max(0, this.unframedChars - data.length);
      this.deliver(data);
    });
    buffer.on("paste", (data) => {
      this.unframedChars = Math.max(0, this.unframedChars - data.length - 12);
      this.deliver(`\x1b[200~${data}\x1b[201~`);
    });
    this.write("\x1b[?2004h");
  }
  private deliver(data: string) {
    try {
      this.onInput?.(data);
    } catch (error) {
      this.fail(error);
    }
  }
  input(data: string) {
    if (this.closed) return;
    if (!this.inputReady) {
      this.queuedChars += data.length;
      if (
        this.queuedChars > MAX_BUFFERED_INPUT ||
        this.queuedInput.length >= 1024
      ) {
        this.fail(new RangeError("Terminal input buffer exceeded"));
        return;
      }
      this.queuedInput.push(data);
      return;
    }
    this.unframedChars += data.length;
    if (this.unframedChars > MAX_BUFFERED_INPUT) {
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
    const queued = this.queuedInput;
    this.queuedInput = [];
    this.queuedChars = 0;
    for (const data of queued) this.input(data);
  }
  resize(cols: number, rows: number) {
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
    this.queuedInput = [];
    this.queuedChars = this.unframedChars = 0;
    if (!this.closed) this.fail(abortError("Terminal stopped"));
  }
  dispose() {
    this.closed = true;
    this.stop();
  }
  async drainInput() {
    this.buffer?.clear();
    this.queuedInput = [];
    this.queuedChars = this.unframedChars = 0;
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
    // biome-ignore lint/suspicious/noControlCharactersInRegex: Strip OSC terminators/control injection from titles.
    this.write(`\x1b]0;${title.replace(/[\x00-\x1f\x7f-\x9f]/g, "")}\x07`);
  }
  setProgress(active: boolean) {
    // One-shot advisory OSC, not an OS progress animation/timer.
    this.write(`\x1b]9;4;${active ? 3 : 0}\x07`);
  }
  setProgramStatus(status: ProgramStatus) {
    this.write(formatProgramStatus(status));
  }
}

/** Keep SDK scheduling/composition, but contain errors from scheduled renders. */
class HostedTui extends TuiAltScreen {
  private released = false;
  private started = false;
  // Lazy: the base constructor subscribes through our override before fields initialize.
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
    if (this.released) return () => {};
    return this.track(super.addInputListener(listener));
  }
  override onTerminalColorSchemeChange(
    listener: (scheme: TerminalColorScheme) => void,
  ) {
    if (this.released) return () => {};
    return this.track(super.onTerminalColorSchemeChange(listener));
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
    // No browser palette is advertised. Avoid SDK query timers surviving close.
    return {};
  }
  release() {
    if (this.released) return;
    this.released = true;
    for (const unsubscribe of this.subscriptions ?? []) unsubscribe();
    this.subscriptions?.clear();
    // preserveScreen avoids a final component render (especially after errors).
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
  ready: boolean;
  start: (cols: number, rows: number) => void;
  input: (data: string) => void;
  resize: (cols: number, rows: number) => void;
  cancel: (reason?: string) => void;
};

export class TerminalUIHost {
  private readonly pending = new Map<string, Pending>();
  private disposed = false;
  private cancelling = false;
  constructor(
    private readonly sessionId: string,
    private readonly theme: Theme,
    private readonly emit: (event: TerminalUIEvent) => void,
  ) {
    initializeGlobals();
  }

  custom: ExtensionUIContext["custom"] = <T>(
    factory: Factory<T>,
    options?: Options,
  ): Promise<T> => {
    if (this.disposed)
      return Promise.reject(abortError("Terminal UI host disposed"));
    if (this.cancelling) return Promise.reject(abortError());
    const id = crypto.randomUUID();
    return new Promise<T>((resolve, reject) => {
      let settled = false;
      let terminal: VirtualTerminal | undefined;
      let tui: HostedTui | undefined;
      let component: CustomComponent | undefined;
      const disposedComponents = new WeakSet<CustomComponent>();
      const disposeComponent = (value: CustomComponent) => {
        if (disposedComponents.has(value)) return;
        disposedComponents.add(value);
        try {
          value.dispose?.();
        } catch {
          /* A disposer must not prevent settlement. */
        }
      };
      const finish = (outcome: { value: T } | { error: unknown }) => {
        if (settled) return;
        settled = true;
        this.pending.delete(id);
        try {
          tui?.release();
        } catch {
          /* Finish remaining cleanup even if focus throws. */
        }
        terminal?.dispose();
        if (component) disposeComponent(component);
        try {
          this.emit({ type: "close", id });
        } catch (error) {
          if (!("error" in outcome)) outcome = { error };
        }
        if ("error" in outcome) reject(outcome.error);
        else resolve(outcome.value);
      };
      const fail = (error: unknown) => finish({ error });
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
      const request: Pending = {
        ready: false,
        start: (cols, rows) => {
          if (settled) return;
          request.ready = true;
          terminal = new VirtualTerminal(
            cols,
            rows,
            (data) => this.emit({ type: "data", id, data }),
            fail,
          );
          try {
            tui = new HostedTui(terminal, fail);
            tui.start();
            if (settled) return;
            const value = factory(
              tui,
              this.theme,
              keybindings as unknown as AppKeybindingsManager,
              (result) => finish({ value: result }),
            );
            // Always observe the returned component, even when done/cancel ran inside the factory.
            Promise.resolve(value).then(mount).catch(fail);
          } catch (error) {
            fail(error);
          }
        },
        input: (data) => terminal?.input(data),
        resize: (cols, rows) => terminal?.resize(cols, rows),
        cancel: (reason) => fail(abortError(reason)),
      };
      this.pending.set(id, request);
      try {
        this.emit({ type: "open", id, sessionId: this.sessionId });
      } catch (error) {
        fail(error);
      }
    });
  };

  accept(command: TerminalUICommand): void {
    if (!command || typeof command.id !== "string") return;
    const request = this.pending.get(command.id);
    if (!request) return;
    switch (command.type) {
      case "ready":
        if (!request.ready && validDimensions(command.cols, command.rows))
          request.start(command.cols, command.rows);
        break;
      case "resize":
        if (request.ready && validDimensions(command.cols, command.rows))
          request.resize(command.cols, command.rows);
        break;
      case "input":
        if (
          request.ready &&
          typeof command.data === "string" &&
          command.data.length > 0 &&
          command.data.length <= MAX_INPUT
        )
          request.input(command.data);
        break;
      case "cancel":
        request.cancel();
        break;
    }
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
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.cancelAll("Terminal UI host disposed");
  }
}
