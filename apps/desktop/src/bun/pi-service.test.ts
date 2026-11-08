import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Isolate the application's homedir-based config and module-level Harness from other tests.
test("application service uses pig storage, publishes Durable snapshots and persists model/login settings", async () => {
  const home = await mkdtemp(join(tmpdir(), "pig-app-durable-"));
  try {
    const script = `
      import { expect } from "bun:test";
      import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";
      import { fauxProvider, fauxAssistantMessage } from "@earendil-works/pi-ai";
      import * as app from ${JSON.stringify(new URL("./pi-service.ts", import.meta.url).href)};
      expect((await app.utilityModels()).imageModels.some(m => m.provider === "openai-codex")).toBe(false);
      await app.credentials.modify("openai-codex", async () => ({type: "oauth", access: "test-only", refresh: "test-only", expires: Date.now() + 3600000, accountId: "test-account"}));
      expect((await app.utilityModels()).imageModels.filter(m => m.provider === "openai-codex")).toEqual([
        {provider: "openai-codex", id: "gpt-image-2.5", name: "gpt-image-2.5"},
        {provider: "openai-codex", id: "gpt-image-2", name: "gpt-image-2"},
      ]);
      expect(app.runtime.getModelsOfType("image", "openai").some(m => m.id === "gpt-image-2.5")).toBe(false);
      await app.credentials.delete("openai-codex");
      const faux = fauxProvider({tokensPerSecond: Infinity});
      const { withRemoteCatalog } = await import(${JSON.stringify(new URL("./remote-catalog.ts", import.meta.url).href)});
      const originalFetch = globalThis.fetch;
      globalThis.fetch = async () => Response.json([{...faux.getModel(), type: "image", api: "openai-images", id: "remote-image", name: "Remote image"}]);
      app.runtime.clearProviders();
      app.runtime.setProvider(withRemoteCatalog(faux.provider));
      await app.runtime.refresh({allowNetwork: true});
      expect((await app.utilityModels()).imageModels).toEqual([{provider: faux.provider.id, id: "remote-image", name: "Remote image"}]);
      globalThis.fetch = originalFetch;
      app.runtime.clearProviders(); app.runtime.setProvider(faux.provider);
      const model = faux.getModel();
      const events = [];
      const chat = await app.openSession({cwd: ${JSON.stringify(home)}}, (id, event, contextUsage) => events.push({id, event, contextUsage}));
      if (!/^[1-9]\\d*$/.test(chat.info.id)) throw new Error("RPC ID must be a numeric string");
      faux.setResponses([fauxAssistantMessage("App answer")]);
      const accepted = await app.promptSession(chat.info.id, "App hello", "app-1");
      if (accepted.disposition !== "started") throw new Error("Not accepted");
      const service = await app.durable();
      await service.harness.waitForIdle(context);
      await new Promise(resolve => setTimeout(resolve, 20));
      if (!events.some(({event}) => event.transcript.turns.some(({message}) => message.role === "assistant"))) throw new Error("Missing streamed snapshot");
      expect(events.some(item => item.contextUsage?.contextWindow > 0)).toBe(true);
      expect((await app.openSession({cwd: ${JSON.stringify(home)}, id: chat.info.id}, () => {})).info.title).toBe("App hello");
      expect(app.modelInfo({...model, api: "anthropic-messages", compat: {forceAdaptiveThinking: true}}).adaptiveThinking).toBe(true);
      expect(app.modelInfo({...model, api: "anthropic-messages", compat: {forceAdaptiveThinking: false}}).adaptiveThinking).toBe(false);
      const renamed = await app.renameSession(chat.info, "Renamed");
      if (!(await app.listSessions(${JSON.stringify(home)})).some(item => item.title === "Renamed")) throw new Error("Missing name");
      await app.setSessionModel(chat.info.id, model.provider, model.id);
      await app.runtime.login(model.provider, "api_key", {notify() {}, async prompt() {return "test-only";}}).catch(() => {});
      await app.credentials.modify(model.provider, async () => ({type: "api_key", key: "test-only"}));
      if (!(await app.credentials.list()).length) throw new Error("Missing stored auth");
      let rejected = false;
      try { await app.promptSession(chat.info.id, "", "bad"); } catch { rejected = true; }
      if (!rejected) throw new Error("Failed admission reported success");
      // Controlled watches exercise open races without relying on scheduler timing.
      await app.closeSession(chat.info.id);
      const originalHistory = service.history.bind(service);
      const originalWatch = service.watch.bind(service);
      const originalList = service.list.bind(service);
      const originalAbort = service.abort.bind(service);
      let aborted = 0;
      service.abort = async () => { aborted++; };
      service.list = async () => [chat.info];
      const deferred = () => {
        let resolve;
        const promise = new Promise(r => { resolve = r; });
        return {promise, resolve};
      };
      const entry = id => ({id, conversationId: Number(chat.info.id), kind: "pi.user", model: [{role: "user", content: "entry-" + id, timestamp: id}]});
      let attached = 0, stopped = 0, listener;
      let ready = deferred(), release = deferred();
      service.watch = async () => {
        attached++;
        return {value: {entries: [entry(1)], docs: {}}, start(callback) {listener = callback;}, async stop() {expect(aborted).toBeGreaterThan(stopped); stopped++;}};
      };
      service.history = async () => {
        expect(listener).toBeDefined();
        ready.resolve();
        await release.promise;
        return [entry(1), entry(2)];
      };
      const input = {cwd: ${JSON.stringify(home)}, id: chat.info.id};
      const first = app.openSession(input, (id, event) => events.push({id, event}));
      const second = app.openSession(input, () => {});
      await ready.promise;
      // More than a watch window is committed while history is in flight.
      for (let id = 3; id <= 65; id++) await listener({kind: "value", value: {entries: [entry(id)], docs: {}}});
      release.resolve();
      const snapshots = await Promise.all([first, second]);
      expect(attached).toBe(1);
      expect(snapshots[0].transcript.turns).toHaveLength(65);
      expect(snapshots[1]).toEqual(snapshots[0]);
      expect(snapshots[0].info.title).toBe("entry-1");
      await listener({kind: "value", value: {entries: [{id: 66, kind: "pig.name", data: "Watch renamed"}], docs: {"pi.live": {runFailure: {reason: "faulted", detail: "Real failure detail"}}}}});
      expect(events.at(-1).event.failure).toBe("Real failure detail");
      const renamedSnapshot = await app.openSession(input, () => {});
      expect(renamedSnapshot.info.title).toBe("Watch renamed");
      expect(renamedSnapshot.info.modified).toBeGreaterThan(0);
      await app.closeSession(chat.info.id);
      expect(stopped).toBe(1);

      // Close cancels an open after attachment, including its eventual completion.
      ready = deferred(); release = deferred(); listener = undefined;
      const cancelled = app.openSession(input, () => {}).then(() => "opened", error => error.message);
      await ready.promise;
      await app.closeSession(chat.info.id);
      expect(stopped).toBe(2);
      release.resolve();
      expect(await cancelled).toBe("Chat closed.");
      expect(stopped).toBe(2);

      // A watch returned after close is stopped as soon as attachment resolves.
      ready = deferred(); release = deferred();
      const fakeWatch = {value: {entries: [], docs: {}}, start() {}, async stop() {stopped++;}};
      service.watch = async () => { ready.resolve(); await release.promise; return fakeWatch; };
      const late = app.openSession(input, () => {}).then(() => "opened", error => error.message);
      await ready.promise;
      await app.closeSession(chat.info.id);
      release.resolve();
      expect(await late).toBe("Chat closed.");
      expect(stopped).toBe(3);

      // History failure tears down the attached watch and allows a retry.
      service.watch = async () => fakeWatch;
      service.history = async () => { throw new Error("history failed"); };
      await expect(app.openSession(input, () => {})).rejects.toThrow("history failed");
      expect(stopped).toBe(4);
      service.history = async () => [];
      await app.openSession(input, () => {});
      await app.closeSession(chat.info.id);
      expect(stopped).toBe(5);
      service.history = originalHistory;
      service.watch = originalWatch;
      service.list = originalList;
      service.abort = originalAbort;
      await app.disposeSessions();
    `;
    const child = Bun.spawn([process.execPath, "--eval", script], {
      cwd: join(import.meta.dir, "../.."),
      env: { ...process.env, HOME: home, USERPROFILE: home, PI_OFFLINE: "1" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [code, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    expect({ code, stdout, stderr }).toMatchObject({ code: 0 });
    if (code !== 0) throw new Error(stderr);
    expect(existsSync(join(home, ".config", "pig", "durable"))).toBe(true);
    expect(existsSync(join(home, ".config", "pig", "auth.json"))).toBe(true);
    expect(existsSync(join(home, ".pi", "agent"))).toBe(false);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
}, 15_000);

test("provider status, availability and requests ignore ambient credentials", async () => {
  const home = await mkdtemp(join(tmpdir(), "pig-app-auth-"));
  try {
    // A subprocess isolates process.env and the module-level app runtime; the
    // parent's environment is never changed and the child's dies on exit.
    const script = `
      import { expect } from "bun:test";
      import { mkdir, writeFile } from "node:fs/promises";
      import { join } from "node:path";
      const home = ${JSON.stringify(home)};
      await mkdir(join(home, ".config/gcloud"), {recursive: true});
      await writeFile(join(home, ".config/gcloud/application_default_credentials.json"), "{}");
      process.env.OPENAI_API_KEY = "ambient-openai";
      process.env.ANTHROPIC_API_KEY = "ambient-anthropic";
      process.env.AWS_ACCESS_KEY_ID = "ambient-aws";
      process.env.AWS_SECRET_ACCESS_KEY = "ambient-secret";
      process.env.GOOGLE_CLOUD_PROJECT = "ambient-project";
      process.env.GOOGLE_CLOUD_LOCATION = "us-central1";
      const app = await import(${JSON.stringify(new URL("./pi-service.ts", import.meta.url).href)});
      expect(await app.credentials.list()).toEqual([]);
      expect((await app.listProviders()).find(p => p.id === "openai")).toMatchObject({name: "OpenAI ChatGPT", apiKey: false, oauth: {label: "Sign in with ChatGPT"}});
      expect((await app.listProviders()).find(p => p.id === "openai-api")).toMatchObject({name: "OpenAI API", apiKey: true, oauth: undefined});
      const mirror = () => {
        const upstream = app.runtime.getAllModels("openai");
        expect(app.runtime.getAllModels("openai-api")).toEqual(upstream.map(m => ({...m, provider: "openai-api"})));
      };
      mirror();
      // Mock the catalog transport, including utility types absent from the baseline.
      const base = app.runtime.getModels("openai")[0];
      const remote = [base, {...base, type: "image", api: "openai-images", id: "split-image"}, {...base, type: "classifier", api: "openai-decisions", id: "split-classifier"}];
      const requests = [];
      const originalFetch = globalThis.fetch;
      globalThis.fetch = async url => {
        requests.push(String(url));
        return Response.json(remote, {headers: {"last-modified": "Thu, 01 Jan 2099 00:00:00 GMT"}});
      };
      await app.credentials.modify("openai-api", async () => ({type: "api_key", key: "catalog-test"}));
      try {
        const result = await app.refreshModels({providers: ["openai-api"], allowNetwork: true, force: true});
        expect(result.errors.size).toBe(0);
        expect(requests).toHaveLength(1);
        expect(new URL(requests[0]).pathname).toBe("/api/models/providers/openai");
      } finally { globalThis.fetch = originalFetch; }
      mirror();
      expect(app.runtime.getAllModels("openai-api").map(m => m.id)).toContain("split-image");
      expect(app.runtime.getAllModels("openai-api").map(m => m.id)).toContain("split-classifier");
      await app.refreshModels({allowNetwork: false});
      mirror();
      expect(app.runtime.getProvider("openai-api").auth.oauth).toBeUndefined();
      const configFile = join(home, ".config", "pig", "models.json");
      await writeFile(configFile, JSON.stringify({providers: {"openai-api": {modelOverrides: {[base.id]: {name: "API-only override"}}}}}));
      await app.refreshModels({providers: ["openai-api"], allowNetwork: false});
      expect(app.runtime.getModel("openai-api", base.id).name).toBe("API-only override");
      expect(app.runtime.getModel("openai", base.id).name).toBe(base.name);
      await writeFile(configFile, "{}");
      await app.refreshModels({allowNetwork: false});
      mirror();
      await app.credentials.delete("openai-api");
      const ids = ["openai-api", "anthropic", "amazon-bedrock", "google-vertex"];
      for (const id of ids) {
        expect((await app.listProviders()).find(p => p.id === id)).toMatchObject({configured: false, stored: false});
        expect(await app.runtime.checkAuth(id)).toBeUndefined();
        expect(await app.runtime.getAuth(id)).toBeUndefined();
        expect(await app.runtime.getAllAvailable(id)).toEqual([]);
        // Unavailable catalog models must not dispatch, even if selected by ID.
        const provider = app.runtime.getProvider(id);
        const model = app.runtime.getModels(id)[0];
        expect(model).toBeDefined();
        let dispatched = 0;
        const dispatch = (_model, _context, options) => {
          dispatched++;
          expect(options.apiKey).toBe("stored-" + id);
          throw new Error("test dispatch reached");
        };
        app.runtime.setProvider({...provider, stream: dispatch, streamSimple: dispatch});
        const context = {messages: []};
        for (const complete of [app.runtime.complete.bind(app.runtime), app.runtime.completeSimple.bind(app.runtime)]) {
          const result = await complete(model, context);
          expect(result.stopReason).toBe("error");
          expect(result.errorMessage).toContain("Provider is not configured");
        }
        expect(dispatched).toBe(0);
        // The same runtime observes credentials saved by the app without restart.
        await app.credentials.modify(id, async () => ({type: "api_key", key: "stored-" + id}));
        expect((await app.listProviders()).find(p => p.id === id)).toMatchObject({configured: true, stored: true});
        expect(await app.runtime.checkAuth("openai")).toBeUndefined();
        expect(await app.runtime.getAllAvailable("openai")).toEqual([]);
        expect(await app.runtime.checkAuth(id)).toMatchObject({type: "api_key"});
        expect((await app.runtime.getAvailable(id)).length).toBeGreaterThan(0);
        expect((await app.runtime.getAuth(id)).auth.apiKey).toBe("stored-" + id);
        for (const complete of [app.runtime.complete.bind(app.runtime), app.runtime.completeSimple.bind(app.runtime)]) {
          const result = await complete(model, context);
          expect(result.errorMessage).toContain("test dispatch reached");
        }
        expect(dispatched).toBe(2);
        await app.credentials.delete(id);
        expect(await app.runtime.checkAuth(id)).toBeUndefined();
      }
    `;
    const child = Bun.spawn([process.execPath, "--eval", script], {
      cwd: join(import.meta.dir, "../.."),
      env: { ...process.env, HOME: home, USERPROFILE: home, PI_OFFLINE: "1" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [code, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    expect({ code, stdout, stderr }).toMatchObject({ code: 0 });
  } finally {
    await rm(home, { recursive: true, force: true });
  }
}, 15_000);

test("models.json composes app configuration and malformed config reports an error without crashing startup", async () => {
  for (const invalid of [false, true]) {
    const home = await mkdtemp(join(tmpdir(), "pig-app-model-config-"));
    try {
      const script = `
        import { expect } from "bun:test";
        import { mkdir, writeFile } from "node:fs/promises";
        import { join } from "node:path";
        const dir = join(${JSON.stringify(home)}, ".config", "pig");
        await mkdir(dir, {recursive: true});
        const config = {providers: {local: {api: "openai-completions", baseUrl: "http://localhost:1234", apiKey: "literal", models: [{id: "custom"}]}}};
        await writeFile(join(dir, "models.json"), ${invalid} ? '{"providers":[]}' : '// JSONC is supported\\n' + JSON.stringify(config));
        const app = await import(${JSON.stringify(new URL("./pi-service.ts", import.meta.url).href)});
        if (${invalid}) {
          expect(app.modelErrors.some(e => e.includes("models.json"))).toBe(true);
          expect(app.runtime.getProviders().length).toBeGreaterThan(0);
        } else {
          expect(app.runtime.getModel("local", "custom").baseUrl).toBe("http://localhost:1234");
          expect((await app.runtime.getAuth("local")).auth.apiKey).toBe("literal");
          await writeFile(join(dir, "models.json"), '{}');
          await app.applyModelSettings();
          expect(app.runtime.getProvider("local")).toBeUndefined();
        }
        const {fauxProvider} = await import("@earendil-works/pi-ai");
        const {provider} = fauxProvider();
        app.runtime.setProvider({...provider, refreshModels: async () => {throw new Error("catalog failure");}});
        await app.refreshModels({allowNetwork: false});
        expect(app.modelErrors.some(e => e.includes("catalog failure"))).toBe(true);
      `;
      const child = Bun.spawn([process.execPath, "--eval", script], {
        cwd: join(import.meta.dir, "../.."),
        env: { ...process.env, HOME: home, USERPROFILE: home, PI_OFFLINE: "1" },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [code, stdout, stderr] = await Promise.all([
        child.exited,
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
      ]);
      expect({ code, stdout, stderr }).toMatchObject({ code: 0 });
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  }
}, 15_000);
