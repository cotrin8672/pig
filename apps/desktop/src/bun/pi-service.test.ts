import { afterAll, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";
import { clearNotices, showNotice, useStore } from "../mainview/store";
import type { Notice } from "../shared/rpc-schema";
import { prepareDesktopConfig } from "./desktop-config";
import { DesktopStateStore } from "./desktop-state";
import { createCompletionTracker } from "./notifications";

// Isolate pi from the user's real auth.json and extensions before pi-service loads.
const agentDir = await mkdtemp(
  join(process.env.PI_SCRATCH_DIR ?? tmpdir(), "pi-service-"),
);
process.env.PI_CODING_AGENT_DIR = agentDir;
afterAll(() => rm(agentDir, { recursive: true, force: true }));

const extension = `export default function (pi) {
  pi.registerProvider("piris-test", {
    name: "Piris Test",
    baseUrl: "http://127.0.0.1:9/v1",
    api: "openai-completions",
    apiKey: "test-key",
    models: [{
      id: "m1", name: "Model One", reasoning: false, input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 1000, maxTokens: 100,
    }],
  });
}
`;

test("user extension providers are listed without a session and dropped on reload", async () => {
  const file = join(agentDir, "extensions", "piris-test.js");
  await mkdir(join(agentDir, "extensions"), { recursive: true });
  await writeFile(file, extension);
  const service = await import("./pi-service");

  await service.loadUserExtensionProviders();
  const providers = await service.listProviders();
  expect(providers.find((p) => p.id === "piris-test")).toMatchObject({
    name: "Piris Test",
    extension: true,
    configured: true,
  });
  // Built-ins come from pi's runtime rather than a hardcoded list.
  expect(providers.some((p) => p.id === "anthropic")).toBe(true);
  expect(providers.length).toBeGreaterThan(10);

  await rm(file);
  await service.loadUserExtensionProviders();
  expect(
    (await service.listProviders()).some((p) => p.id === "piris-test"),
  ).toBe(false);
}, 30_000);

test("model settings round-trip through pi's models.json and settings.json", async () => {
  const service = await import("./pi-service");
  const store = await import("./model-settings");
  const model = service.runtime
    .getModels("anthropic")
    .find((candidate) => candidate.reasoning);
  if (!model) throw new Error("expected a reasoning anthropic model");
  await store.writeModelOverride(
    model.provider,
    model.id,
    { name: "Fast", contextWindow: 123_000, input: ["text"] },
    store.modelsJsonPath(),
  );
  await store.writeDefaultEffort(model.provider, model.id, "high");
  await service.applyModelSettings();
  const fresh = service.runtime.getModel(model.provider, model.id);
  if (!fresh) throw new Error("model disappeared");
  expect(service.modelInfo(fresh)).toMatchObject({
    name: "Fast",
    contextWindow: 123_000,
    vision: false,
    defaultEffort: "high",
  });

  await store.writeModelOverride(model.provider, model.id, {});
  await store.writeDefaultEffort(model.provider, model.id, null);
  await service.applyModelSettings();
  const restored = service.runtime.getModel(model.provider, model.id);
  expect(restored?.name).toBe(model.name);
  expect(restored && service.modelInfo(restored).defaultEffort).toBeUndefined();
}, 30_000);

test("effort choices and inherited defaults follow each model's capabilities", async () => {
  const { modelInfo, runtime } = await import("./pi-service");
  const { settings } = await import("./model-settings");
  const base = runtime.getModels("anthropic")[0];
  const model = {
    ...base,
    id: "effort-test",
    reasoning: true,
    thinkingLevelMap: {
      off: null,
      minimal: null,
      low: "low",
      medium: null,
      high: "high",
      xhigh: null,
      max: null,
    },
  };
  const manager = settings();
  const previous = manager.getDefaultThinkingLevel();
  try {
    manager.setDefaultThinkingLevel("high");
    expect(modelInfo(model).effortLevels).toEqual(["low", "high"]);
    expect(modelInfo(model).effectiveDefaultEffort).toBe("high");
    manager.setModelThinkingLevel(model.provider, model.id, "low");
    expect(modelInfo(model).effectiveDefaultEffort).toBe("low");
    manager.setModelThinkingLevel(model.provider, model.id, "max");
    expect(modelInfo(model).effortLevels).toContain(
      modelInfo(model).effectiveDefaultEffort,
    );
    const plain = modelInfo({ ...model, reasoning: false });
    expect(plain.effortLevels).toEqual([]);
    expect(plain.effectiveDefaultEffort).toBe("off");
  } finally {
    manager.removeModelThinkingLevel(model.provider, model.id);
    manager.setDefaultThinkingLevel(previous ?? "medium");
    await manager.flush();
  }
});

test("extension notifications are wired before session_start and survive reload", async () => {
  const file = join(agentDir, "extensions", "notifications.js");
  await mkdir(join(agentDir, "extensions"), { recursive: true });
  await writeFile(
    file,
    `export default function (pi) {
    pi.on("session_start", async (_event, ctx) => {
      ctx.ui.notify(JSON.stringify({ hasUI: ctx.hasUI, mode: ctx.mode }));
      ctx.ui.notify("warning", "warning");
      ctx.ui.notify("error", "error");
      ctx.ui.notify("confirmed:" + await ctx.ui.confirm("Delete?", "Must not approve"));
    });
  }`,
  );
  const service = await import("./pi-service");
  const cwd = join(agentDir, "notification-project");
  await mkdir(cwd, { recursive: true });
  const notices: Notice[] = [];
  const errors: string[] = [];
  const unsubscribe = service.extensionDialogs.subscribe((_id, requests) => {
    for (const request of requests)
      if (request.kind === "confirm")
        service.extensionDialogs.answer({ ...request, value: false });
  });
  const snapshot = await service.openSession(
    { cwd },
    () => {},
    [],
    (message) => errors.push(message),
    (notice) => notices.push(notice),
  );
  try {
    expect(errors).toEqual([]);
    expect(notices.map(({ message, level }) => [message, level])).toEqual([
      ['{"hasUI":true,"mode":"rpc"}', "info"],
      ["warning", "warning"],
      ["error", "error"],
      ["confirmed:false", "info"],
    ]);
    expect(
      notices.every(
        (notice) =>
          notice.session?.id === snapshot.info.id && notice.session.cwd === cwd,
      ),
    ).toBe(true);
    const original = [...notices];
    notices.length = 0;
    await service.getSession(snapshot.info.id).reload();
    expect(notices).toEqual(original);
    const ui = service
      .getSession(snapshot.info.id)
      .extensionRunner.getUIContext();
    for (const result of [
      ui.select("Choose", ["one"]),
      ui.input("Input"),
      ui.editor("Edit"),
    ]) {
      const request = service.extensionDialogs.list(snapshot.info.id)[0];
      expect(request).toBeDefined();
      const reopened = await service.openSession(
        { cwd, id: snapshot.info.id },
        () => {},
      );
      expect(reopened.pendingDialogs).toEqual(
        service.extensionDialogs.list(snapshot.info.id),
      );
      service.extensionDialogs.answer({ ...request, cancelled: true });
      expect(await result).toBeUndefined();
    }
    await expect(
      ui.custom(() => {
        throw new Error("must not run TUI factory");
      }),
    ).rejects.toThrow("TUI components are not supported");
  } finally {
    unsubscribe();
    await service.closeSession(snapshot.info.id);
    await rm(file);
  }
}, 30_000);

test("real SDK prompts settle once and reach toast/history across repeated runs", async () => {
  const service = await import("./pi-service");
  const provider = "notification-test";
  service.runtime.registerProvider(provider, {
    baseUrl: "http://127.0.0.1:9",
    api: "openai-completions",
    apiKey: "test-only",
    models: [
      {
        id: "fixed",
        name: "Fixed",
        reasoning: false,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 100000,
        maxTokens: 100,
      },
    ],
    streamSimple(model) {
      const stream = createAssistantMessageEventStream();
      queueMicrotask(() => {
        stream.push({
          type: "done",
          reason: "stop",
          message: {
            role: "assistant",
            content: [{ type: "text", text: "Done" }],
            api: model.api,
            provider,
            model: model.id,
            stopReason: "stop",
            timestamp: Date.now(),
            usage: {
              input: 1,
              output: 1,
              cacheRead: 0,
              cacheWrite: 0,
              totalTokens: 2,
              cost: {
                input: 0,
                output: 0,
                cacheRead: 0,
                cacheWrite: 0,
                total: 0,
              },
            },
          },
        });
      });
      return stream;
    },
  });
  const config = join(agentDir, "desktop");
  await prepareDesktopConfig(join(agentDir, "legacy"), config);
  const cwd = join(config, "general");
  const desktop = new DesktopStateStore(join(config, "desktop.json"));
  const completion = createCompletionTracker();
  const events: string[] = [];
  clearNotices();
  const snapshot = await service.openSession({ cwd }, (id, event) => {
    events.push(event.type);
    const outcome = completion(event);
    if (event.type === "agent_start") void desktop.clearCompletion(id);
    if (outcome) {
      void desktop.completeSession(id, outcome);
      showNotice({ message: "Finished", level: outcome, session: { id, cwd } });
    }
  });
  try {
    const model = service.runtime.getModel(provider, "fixed");
    if (!model) throw new Error("test model missing");
    const session = service.getSession(snapshot.info.id);
    await session.setModel(model);
    await service.promptSession(snapshot.info.id, "first");
    expect(events).toContain("agent_start");
    expect(events).toContain("agent_settled");
    expect(useStore.getState().notices).toHaveLength(1);
    expect(useStore.getState().noticeHistory).toHaveLength(1);
    await desktop.settled();
    const firstCompletion =
      desktop.value.sessions[snapshot.info.id].completion?.id;
    expect(firstCompletion).toBeDefined();
    await service.promptSession(snapshot.info.id, "second");
    expect(events.filter((event) => event === "agent_settled")).toHaveLength(2);
    expect(useStore.getState().notices).toHaveLength(2);
    expect(
      useStore
        .getState()
        .noticeHistory.every(
          (n) => n.level === "success" && n.session?.id === snapshot.info.id,
        ),
    ).toBe(true);
    await desktop.settled();
    expect(desktop.value.sessions[snapshot.info.id].completion?.id).not.toBe(
      firstCompletion,
    );
    const fork = await service.openSession(
      service.forkSession(
        snapshot.info.id,
        session.messages.find((m) => m.role === "assistant")?.timestamp ?? 0,
      ),
      () => {},
    );
    expect(fork.info.cwd).toBe(cwd);
    expect(fork.info.id).not.toBe(snapshot.info.id);
    await service.renameSession(fork.info, "General fork");
    await service.closeSession(fork.info.id);
    const stored = (await service.listSessions(cwd)).find(
      (s) => s.id === fork.info.id,
    );
    expect(stored?.title).toBe("General fork");
    if (!stored) throw new Error("missing fork");
    const reopened = await service.openSession(
      { cwd, id: stored.id, path: stored.path },
      () => {},
    );
    expect(reopened.info.id).toBe(stored.id);
    const waiting = service
      .getSession(stored.id)
      .extensionRunner.getUIContext()
      .input("Pending on close");
    await service.closeSession(stored.id);
    expect(await waiting).toBeUndefined();
    expect(service.extensionDialogs.list(stored.id)).toEqual([]);
    await service.deleteSession(stored);
    expect(
      (await service.listSessions(cwd)).some((s) => s.id === stored.id),
    ).toBe(false);
    expect(
      (await service.listSessions(cwd)).some((s) => s.id === snapshot.info.id),
    ).toBe(true);
  } finally {
    await service.closeSession(snapshot.info.id);
    service.runtime.unregisterProvider(provider);
    clearNotices();
  }
}, 30_000);

test("utility catalogs expose safe available models and all classifier providers", async () => {
  const { runtime, utilityModels, listProviders } = await import(
    "./pi-service"
  );
  const provider = "utility-catalog-test";
  const image = runtime.getModelsOfType("image")[0];
  const classifier = runtime.getModelsOfType("classifier")[0];
  if (!image || !classifier) throw new Error("expected SDK utility models");
  let configured = false;
  const models = [
    {
      ...image,
      provider,
      id: "image-test",
      name: "Test Image",
      headers: { Authorization: "secret" },
    },
    {
      ...classifier,
      provider,
      id: "classifier-test",
      name: "Test Classifier",
      headers: { Authorization: "secret" },
    },
  ];
  runtime.registerNativeProvider({
    id: provider,
    name: "Utility Catalog Test",
    headers: { Authorization: "provider-secret" },
    auth: {
      apiKey: {
        name: "Fake auth",
        async check() {
          return configured ? { type: "api_key" as const } : undefined;
        },
        async resolve() {
          throw new Error("catalog must not resolve request credentials");
        },
      },
    },
    getModels: () => [],
    getAllModels: () => models,
    stream() {
      throw new Error("must not call API");
    },
    streamSimple() {
      throw new Error("must not call API");
    },
  });
  try {
    const unavailable = await utilityModels();
    expect(unavailable.imageModels.some((m) => m.provider === provider)).toBe(
      false,
    );
    expect(
      unavailable.classificationModels.some((m) => m.provider === provider),
    ).toBe(false);
    expect(unavailable.classificationProviders).toContain(provider);
    expect(unavailable.classificationProviders).toContain("typesafe");
    expect(new Set(unavailable.classificationProviders).size).toBe(
      unavailable.classificationProviders.length,
    );
    expect(
      (await listProviders()).find((p) => p.id === provider),
    ).toMatchObject({ configured: false });
    expect((await listProviders()).some((p) => p.id === "typesafe")).toBe(true);
    expect(runtime.getModels(provider)).toEqual([]);
    configured = true;
    const available = await utilityModels();
    expect(
      available.imageModels.filter((m) => m.provider === provider),
    ).toEqual([{ provider, id: "image-test", name: "Test Image" }]);
    expect(
      available.classificationModels.filter((m) => m.provider === provider),
    ).toEqual([{ provider, id: "classifier-test", name: "Test Classifier" }]);
    expect(
      (await listProviders()).find((p) => p.id === provider),
    ).toMatchObject({ configured: true });
  } finally {
    runtime.unregisterProvider(provider);
  }
});

test("terminal custom UI works before session registration and is cancelled on close", async () => {
  const service = await import("./pi-service");
  const { withPackageLock } = await import("./package-queue");
  const file = join(agentDir, "extensions", "terminal-startup.js");
  await mkdir(join(agentDir, "extensions"), { recursive: true });
  await writeFile(
    file,
    `export default function (pi) {
    pi.on("session_start", async (_event, ctx) => {
      if (ctx.mode !== "tui") return;
      const result = await ctx.ui.custom((_tui, _theme, _keys, done) => ({
        render() { return ["Startup terminal"]; },
        invalidate() {},
        handleInput(data) { if (data === "\\r") done({ value: "ok" }); }
      }));
      ctx.ui.notify("terminal:" + result.value);
    });
  }`,
  );
  const cwd = join(agentDir, "terminal-project");
  await mkdir(cwd, { recursive: true });
  const notices: Notice[] = [];
  const replied = new Set<string>();
  let sessionId: string | undefined;
  let currentId = "";
  try {
    const snapshot = await service.openSession(
      { cwd },
      () => {},
      [],
      () => {},
      (notice) => notices.push(notice),
      (event) => {
        if (event.type === "open") {
          sessionId = event.sessionId;
          currentId = event.id;
          queueMicrotask(() =>
            service.acceptTerminalUI({
              type: "ready",
              id: event.id,
              cols: 80,
              rows: 24,
            }),
          );
        } else if (
          event.type === "data" &&
          event.data.includes("Startup terminal") &&
          !replied.has(event.id)
        ) {
          replied.add(event.id);
          queueMicrotask(() =>
            service.acceptTerminalUI({
              type: "input",
              id: event.id,
              data: "\r",
            }),
          );
        }
      },
    );
    expect(notices.map((n) => n.message)).toEqual(["terminal:ok"]);
    expect(
      await withPackageLock(() => service.reloadPackageSessions()),
    ).toEqual([]);
    expect(notices.filter((n) => n.message === "terminal:ok")).toHaveLength(2);
    const pending = service
      .getSession(snapshot.info.id)
      .extensionRunner.getUIContext()
      .custom(() => ({
        render: () => ["Waiting"],
        invalidate() {},
      }));
    const cancelled = pending.catch((error) => error);
    await service.closeSession(snapshot.info.id);
    expect(await cancelled).toMatchObject({ name: "AbortError" });
    // Late messages from the destroyed surface cannot reach a new session.
    service.acceptTerminalUI({ type: "input", id: currentId, data: "stale" });
  } finally {
    if (sessionId) await service.closeSession(sessionId);
    await rm(file);
  }
}, 30_000);
