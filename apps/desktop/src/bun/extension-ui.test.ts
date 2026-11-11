import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Theme } from "@earendil-works/pi-coding-agent";
import { Text, TuiAltScreen } from "@earendil-works/pi-tui";
import type { ExtensionUIEvent, UIRequest } from "../shared/extension-ui";
import type { SessionAddress, UIAddress } from "../shared/runtime-contract";
import type { TerminalHostEvent } from "../shared/terminal-ui";
import { ComposerBridge } from "./composer-bridge";
import {
  configureExtensionUI,
  createExtensionUIHost,
  type ExtensionUIHost,
} from "./extension-ui";
import { TerminalKeybindings } from "./terminal-ui";
import { UIRequestBroker } from "./ui-request-broker";

// Theme/keybindings are deliberately process-wide in production. Run this suite
// in its own process so terminal-ui.test.ts can independently verify its profile.
if (process.env.PIG_EXTENSION_UI_TEST_CHILD !== "1") {
  test("Extension UI integration in an isolated process", async () => {
    const home = mkdtempSync(
      join(process.env.PI_SCRATCH_DIR ?? tmpdir(), "extension-ui-test-"),
    );
    const env = { ...process.env };
    for (const name of Object.keys(env)) {
      if (
        /(API.?KEY|TOKEN|SECRET|CREDENTIAL|PASSWORD|^AWS_|^AZURE_|^GOOGLE_|^GCLOUD_|^OPENAI_|^ANTHROPIC_|^GEMINI_|^MISTRAL_|^GROQ_|^COHERE_|^HF_|^HUGGING|^CLOUDFLARE_|^VERTEX_|^BEDROCK_|^PI_|^PIG_)/i.test(
          name,
        )
      )
        delete env[name];
    }
    Object.assign(env, {
      HOME: home,
      USERPROFILE: home,
      APPDATA: home,
      LOCALAPPDATA: home,
      XDG_CONFIG_HOME: home,
      XDG_CACHE_HOME: home,
      TEMP: home,
      TMP: home,
      TMPDIR: home,
      PI_CODING_AGENT_DIR: home,
      PI_OFFLINE: "1",
      PIG_EXTENSION_UI_TEST_CHILD: "1",
    });
    try {
      const child = Bun.spawn([process.execPath, "test", import.meta.path], {
        env,
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, code] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
      ]);
      console.log(stdout + stderr);
      expect(code).toBe(0);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  }, 30_000);
} else {
  const theme = new Theme(
    {
      accent: "#abcdef",
      muted: "#888888",
      text: "",
      thinkingXhigh: "#abcdef",
    } as ConstructorParameters<typeof Theme>[0],
    { selectedBg: "#333333" } as ConstructorParameters<typeof Theme>[1],
    "truecolor",
  );
  configureExtensionUI(
    theme,
    new TerminalKeybindings({ "app.interrupt": "ctrl+g" }),
  );
  const a: SessionAddress = { hostId: "host", sessionId: "opaque-a", epoch: 1 };
  const b: SessionAddress = { ...a, sessionId: "opaque-b" };
  const hosts: ExtensionUIHost[] = [];
  afterEach(() => {
    for (const host of hosts.splice(0)) host.dispose();
  });
  const blank = () => ({ render: () => ["component"], invalidate() {} });
  const observe = <T>(promise: Promise<T>) => {
    void promise.catch(() => {});
    return promise;
  };
  async function turn() {
    await Promise.resolve();
    await Promise.resolve();
  }
  function fixture(available = true) {
    const events: ExtensionUIEvent[] = [];
    const terminals: (TerminalHostEvent & { hostId: string })[] = [];
    const emit = (event: ExtensionUIEvent) => {
      events.push(event);
    };
    const broker = new UIRequestBroker(emit);
    broker.setAvailable(available);
    const drafts = new ComposerBridge(emit);
    const create = (address = a) => {
      const host = createExtensionUIHost({
        address,
        broker,
        drafts,
        emit,
        emitTerminal: (event) => {
          terminals.push(event as TerminalHostEvent & { hostId: string });
          if (event.type === "data")
            host.handleTerminal({ ...event, type: "ack" });
        },
      });
      hosts.push(host);
      return host;
    };
    const request = (kind?: UIRequest["kind"]) => {
      const request = broker
        .pending()
        .find((request) => !kind || request.kind === kind);
      if (!request) throw new Error("No request");
      return request;
    };
    const ready = (host: ExtensionUIHost, address: UIAddress) =>
      host.handleTerminal({ ...address, type: "ready", cols: 80, rows: 24 });
    return { events, terminals, broker, drafts, create, request, ready };
  }

  test("startup native UI works before ready; stable facade rotates and stale replies cannot affect new epoch", async () => {
    const f = fixture();
    const host = f.create();
    const ui = host.uiContext;
    const startup = ui.confirm("Startup", "Allow startup?");
    const old = f.request();
    host.rotate({ ...a, epoch: 2 });
    expect(await startup).toBe(false);
    expect(host.uiContext).toBe(ui);
    const nextStartup = ui.input("Reload startup", "name");
    const next = f.request();
    expect(next).toMatchObject({
      hostId: a.hostId,
      sessionId: a.sessionId,
      epoch: 2,
    });
    expect(() =>
      f.broker.resolve({ ...old, kind: "confirm", value: true }),
    ).toThrow();
    f.broker.resolve({ ...next, kind: "input", value: "new epoch" });
    expect(await nextStartup).toBe("new epoch");
  });

  test("Permission fixture deny/cancel/abort/timeout/disconnect/unavailable execute zero tools", async () => {
    for (const mode of [
      "deny",
      "cancel",
      "abort",
      "timeout",
      "disconnect",
      "unavailable",
    ] as const) {
      const f = fixture(mode !== "unavailable");
      const host = f.create();
      let executions = 0;
      const signal = new AbortController();
      // Mirrors an extension tool_call guard: only a positive UI result admits the tool.
      const invocation = (async () => {
        const allowed = await host.uiContext.confirm(
          "Permission",
          "Execute fixture tool?",
          {
            signal: signal.signal,
            timeout: mode === "timeout" ? 5 : undefined,
          },
        );
        if (allowed) executions++;
        return allowed;
      })();
      if (mode === "deny")
        f.broker.resolve({ ...f.request(), kind: "confirm", value: false });
      if (mode === "cancel") host.cancelAll("stop");
      if (mode === "abort") signal.abort();
      if (mode === "disconnect") f.broker.setAvailable(false);
      expect(await invocation).toBe(false);
      expect(executions).toBe(0);
      host.dispose();
    }
  });

  test("native cancellation maps SDK values; editor and select validated; no UI custom rejects AbortError", async () => {
    const f = fixture();
    const host = f.create();
    const select = host.uiContext.select("Select", ["one", "two"]);
    f.broker.resolve({ ...f.request(), kind: "select", value: "two" });
    expect(await select).toBe("two");
    const editor = host.uiContext.editor("Edit", "prefill");
    expect(f.request()).toMatchObject({
      kind: "editor",
      initialValue: "prefill",
    });
    f.broker.resolve({ ...f.request(), kind: "cancel" });
    expect(await editor).toBeUndefined();
    f.broker.setAvailable(false);
    expect(await host.uiContext.input("No UI")).toBeUndefined();
    await expect(host.uiContext.custom(() => blank())).rejects.toMatchObject({
      name: "AbortError",
    });
  });

  test("actual terminal custom uses unified broker, host boundary, arbitrary Bun result, resolve once", async () => {
    const f = fixture();
    const host = f.create();
    let calls = 0;
    const value = { fn: () => 42, map: new Map([["bun-only", 1]]) };
    const custom = host.uiContext.custom<typeof value>(
      (tui, passedTheme, kb, done) => {
        calls++;
        expect(tui).toBeInstanceOf(TuiAltScreen);
        expect(passedTheme).toBe(theme);
        expect(kb.getEffectiveConfig()["app.interrupt"]).toEqual("ctrl+g");
        done(value);
        done({ fn: () => 0, map: new Map() });
        return new Text("real component", 0, 0);
      },
    );
    const request = f.request("terminal");
    expect(f.terminals[0]).toMatchObject({ type: "open", hostId: a.hostId });
    const wrongHostCommand = {
      ...request,
      hostId: "wrong-host",
      type: "ready" as const,
      cols: 80,
      rows: 24,
    };
    host.handleTerminal(wrongHostCommand);
    const { hostId: _host, ...hostless } = request;
    host.handleTerminal({ ...hostless, type: "ready", cols: 80, rows: 24 });
    host.handleTerminal({
      ...request,
      epoch: 0,
      type: "ready",
      cols: 80,
      rows: 24,
    });
    expect(calls).toBe(0);
    f.ready(host, request);
    expect(await custom).toBe(value);
    expect(calls).toBe(1);
    expect(f.broker.pending()).toHaveLength(0);
    expect(f.terminals.filter((event) => event.type === "close")).toHaveLength(
      1,
    );
    expect(
      f.events.some(
        (event) => event.type === "requestEnd" && event.reason === "done",
      ),
    ).toBe(true);
  });

  test("terminal factory child native prompt foregrounds; independent session stays queued and Stop isolates", async () => {
    const f = fixture();
    const one = f.create();
    const two = f.create(b);
    const custom = observe(
      one.uiContext.custom(async () => {
        const answer = await one.uiContext.confirm("Nested", "Allow child?");
        expect(answer).toBe(false);
        return blank();
      }),
    );
    const parent = f.request("terminal");
    f.ready(one, parent);
    await turn();
    const child = f.request("confirm");
    expect(child.parentUiId).toBe(parent.uiId);
    const independent = two.uiContext.input("Other session startup");
    expect(f.broker.pending()[0]?.uiId).toBe(child.uiId);
    expect(
      f.broker.pending().find((request) => request.sessionId === b.sessionId)
        ?.parentUiId,
    ).toBeUndefined();
    f.broker.resolve({ ...child, kind: "confirm", value: false });
    await turn();
    expect(f.broker.pending()[0]?.uiId).toBe(parent.uiId);
    one.cancelAll("stop");
    await expect(custom).rejects.toMatchObject({ name: "AbortError" });
    const remaining = f.request();
    expect(remaining.sessionId).toBe(b.sessionId);
    f.broker.resolve({ ...remaining, kind: "input", value: "B survived" });
    expect(await independent).toBe("B survived");
  });

  test("independent custom nesting fails explicitly; separate-session terminal queues until first closes", async () => {
    const f = fixture();
    const one = f.create();
    const two = f.create(b);
    const first = observe(one.uiContext.custom(() => blank()));
    await expect(one.uiContext.custom(() => blank())).rejects.toThrow(
      "no parent scope",
    );
    let secondStarted = false;
    const second = observe(
      two.uiContext.custom(() => {
        secondStarted = true;
        return blank();
      }),
    );
    const queued = f.broker
      .pending()
      .find((request) => request.sessionId === b.sessionId);
    if (!queued) throw new Error("Missing queued UI");
    expect(secondStarted).toBe(false);
    one.cancelAll("stop");
    await expect(first).rejects.toMatchObject({ name: "AbortError" });
    f.ready(two, queued);
    expect(secondStarted).toBe(true);
    f.broker.setAvailable(false);
    await expect(second).rejects.toMatchObject({ name: "AbortError" });
  });

  test("Composer/status/string widgets/labels/notify are addressed and unsupported components diagnose and throw", () => {
    const f = fixture();
    const one = f.create();
    const two = f.create(b);
    const ui = one.uiContext;
    ui.setEditorText("extension text");
    ui.pasteToEditor(" pasted");
    expect(ui.getEditorText()).toBe("extension text pasted");
    expect(two.uiContext.getEditorText()).toBe("");
    ui.setStatus("test", "active");
    ui.setWidget("above", ["one"]);
    ui.setWidget("below", ["two"], { placement: "belowEditor" });
    ui.setTitle("Extension title");
    ui.setWorkingMessage("Working");
    ui.setWorkingIndicator({ frames: ["●"] });
    ui.setHiddenThinkingLabel("Thinking hidden");
    ui.notify("fixture notice", "warning");
    expect(one.getStatus()).toMatchObject({
      statuses: [{ key: "test", text: "active" }],
      widgets: [{ placement: "aboveEditor" }, { placement: "belowEditor" }],
      title: "Extension title",
      workingMessage: "Working",
      workingSymbol: "●",
      hiddenThinkingLabel: "Thinking hidden",
    });
    expect(two.getStatus()).toEqual({ statuses: [], widgets: [] });
    const snapshot = one.getStatus();
    snapshot.statuses.length = 0;
    expect(one.getStatus().statuses).toHaveLength(1);
    expect(() => ui.setWidget("component", () => blank())).toThrow(
      "unsupported",
    );
    expect(() => ui.setEditorComponent(undefined)).toThrow("unsupported");
    expect(() => ui.addAutocompleteProvider((current) => current)).toThrow(
      "unsupported",
    );
    expect(() => ui.setHeader(undefined)).toThrow("unsupported");
    expect(() => ui.setFooter(undefined)).toThrow("unsupported");
    expect(ui.setTheme("other").success).toBe(false);
    one.reportUnsupported("registerShortcut", "fixture-extension");
    expect(f.events).toContainEqual(
      expect.objectContaining({
        type: "capability",
        api: "registerShortcut",
        supported: false,
      }),
    );
    one.rotate({ ...a, epoch: 2 });
    expect(one.getStatus()).toEqual({ statuses: [], widgets: [] });
  });

  test("terminal permission cancellation never guesses an approval value or executes the fixture tool", async () => {
    const f = fixture();
    const host = f.create();
    let executions = 0;
    const permission = (async () => {
      if (await host.uiContext.custom<boolean>(() => blank())) executions++;
    })();
    const outcome = observe(permission);
    f.broker.resolve({ ...f.request("terminal"), kind: "cancel" });
    await expect(outcome).rejects.toMatchObject({ name: "AbortError" });
    expect(executions).toBe(0);
    expect(f.broker.pending()).toHaveLength(0);
  });

  test("terminal input listeners survive Stop for future custom UI, unsubscribe and rotate release them", async () => {
    const f = fixture();
    const host = f.create();
    const inputs: string[] = [];
    const unsubscribe = host.uiContext.onTerminalInput((data) => {
      inputs.push(data);
      return undefined;
    });
    const first = observe(host.uiContext.custom(() => blank()));
    const firstAddress = f.request("terminal");
    f.ready(host, firstAddress);
    await turn();
    host.handleTerminal({
      ...firstAddress,
      type: "input",
      inputSeq: 1,
      encoding: "text",
      data: "a",
    });
    host.cancelAll("stop");
    await expect(first).rejects.toMatchObject({ name: "AbortError" });
    const second = observe(host.uiContext.custom(() => blank()));
    const secondAddress = f.request("terminal");
    f.ready(host, secondAddress);
    await turn();
    host.handleTerminal({
      ...secondAddress,
      type: "input",
      inputSeq: 1,
      encoding: "text",
      data: "b",
    });
    expect(inputs).toEqual(["a", "b"]);
    unsubscribe();
    host.handleTerminal({
      ...secondAddress,
      type: "input",
      inputSeq: 2,
      encoding: "text",
      data: "c",
    });
    expect(inputs).toEqual(["a", "b"]);
    host.rotate({ ...a, epoch: 2 });
    await expect(second).rejects.toMatchObject({ name: "AbortError" });
    const third = observe(host.uiContext.custom(() => blank()));
    const thirdAddress = f.request("terminal");
    f.ready(host, thirdAddress);
    await turn();
    host.handleTerminal({
      ...thirdAddress,
      type: "input",
      inputSeq: 1,
      encoding: "text",
      data: "d",
    });
    expect(inputs).toEqual(["a", "b"]);
    host.dispose();
    host.dispose();
    await expect(third).rejects.toMatchObject({ name: "AbortError" });
  });

  test("explicit Root terminal selection does not require a second focus RPC", async () => {
    const f = fixture();
    const one = f.create();
    const two = f.create(b);
    const first = observe(one.uiContext.custom(() => blank()));
    let secondStarted = false;
    const second = observe(
      two.uiContext.custom(() => {
        secondStarted = true;
        return blank();
      }),
    );
    const queued = f.broker
      .pending()
      .find((request) => request.sessionId === b.sessionId);
    if (!queued) throw new Error("Missing second session terminal");
    expect(secondStarted).toBe(false);
    expect(f.broker.pending()[0]?.sessionId).toBe(a.sessionId);
    f.ready(two, queued);
    expect(secondStarted).toBe(true);
    expect(f.broker.isForeground(queued)).toBe(true);
    one.cancelAll("stop");
    two.cancelAll("stop");
    await expect(first).rejects.toMatchObject({ name: "AbortError" });
    await expect(second).rejects.toMatchObject({ name: "AbortError" });
  });

  test("known AsyncLocalStorage scope supports actual nested terminal factories with Bun-local values", async () => {
    const f = fixture();
    const host = f.create();
    const value = { localFunction: () => 42 };
    let finishParent: ((value: string) => void) | undefined;
    const parentPromise = host.uiContext.custom<string>(
      async (_tui, _theme, _kb, done) => {
        finishParent = done;
        const returned = await host.uiContext.custom<typeof value>(
          (_childTui, _childTheme, _childKeys, childDone) => {
            childDone(value);
            return blank();
          },
        );
        expect(returned).toBe(value);
        return blank();
      },
    );
    const parent = f.request("terminal");
    f.ready(host, parent);
    await turn();
    const child = f.broker.pending()[0];
    if (!child || child.uiId === parent.uiId)
      throw new Error("Missing nested terminal");
    expect(child.parentUiId).toBe(parent.uiId);
    f.ready(host, child);
    await turn();
    expect(f.broker.isForeground(parent)).toBe(true);
    if (!finishParent) throw new Error("Parent factory not started");
    finishParent("parent done");
    expect(await parentPromise).toBe("parent done");
    expect(f.broker.pending()).toHaveLength(0);
  });
}
