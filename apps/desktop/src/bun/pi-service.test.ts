import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { isolatedP0Env } from "../../scripts/durable-p0";
import { runCommand } from "./command-executor";

const service = JSON.stringify(
  new URL("./pi-service.ts", import.meta.url).href,
);

// Native/bootstrap imports must happen AFTER the RTK child receives isolated HOME.
async function runServiceScript(script: string) {
  const scratch = process.env.PI_SCRATCH_DIR;
  if (!scratch) throw new Error("PI_SCRATCH_DIR required");
  const home = await mkdtemp(join(scratch, "pig-app-native-"));
  try {
    const result = await runCommand(process.execPath, ["--eval", script], {
      cwd: import.meta.dir,
      env: { ...isolatedP0Env(home), PI_OFFLINE: "1" },
      timeout: 25_000,
    });
    expect(result, `${result.stdout}\n${result.stderr}`).toMatchObject({
      exitCode: 0,
    });
    expect(result.stderr).not.toContain("Unhandled");
  } finally {
    await rm(home, { recursive: true, force: true });
  }
}

test("native application preserves service exports, model/auth helpers and metadata-only reopen", async () => {
  await runServiceScript(`
    import { expect } from "bun:test";
    import { existsSync } from "node:fs";
    import { join } from "node:path";
    import { fauxProvider } from "@earendil-works/pi-ai";
    const app = await import(${service});
    try {
      expect(app.application.host).toBe(app.host);
      const events = [];
      app.configureApplication({runtime: e => events.push(e), ui() {}});
      expect((await app.utilityModels()).imageModels.some(m => m.provider === "openai-codex")).toBe(false);
      await app.credentials.modify("openai-codex", async () => ({type: "oauth", access: "test-only", refresh: "test-only", expires: Date.now() + 3600000, accountId: "test-account"}));
      expect((await app.utilityModels()).imageModels.filter(m => m.provider === "openai-codex").length).toBe(2);
      await app.credentials.delete("openai-codex");
      const model = fauxProvider().getModel();
      expect(app.modelInfo({...model, api: "anthropic-messages", compat: {forceAdaptiveThinking: true}}).adaptiveThinking).toBe(true);
      await app.initializeApplication([process.env.HOME]);
      await app.application.connect({clientId: "root"});
      const chat = await app.openSession({cwd: process.env.HOME, openId: "first"});
      await app.application.ready(chat.address);
      expect(chat.info.id).toMatch(/^d2_[a-f0-9]{32}_[1-9][0-9]*$/);
      expect(chat.info.id).toBe(chat.address.sessionId);
      expect(chat.address.hostId).toBe(app.host.hostId);
      await app.renameSession(chat.info, "Native metadata only");
      await app.closeSession(chat.address);
      const reopened = await app.openSession({cwd: process.env.HOME, id: chat.info.id, openId: "reopen"});
      expect(reopened.address.epoch).toBeGreaterThan(chat.address.epoch);
      expect(reopened.info.title).toBe("Native metadata only");
      expect(reopened.transcript.records.filter(r => r.kind === "message")).toHaveLength(0);
      await expect(app.host.getSnapshot(chat.address)).rejects.toThrow("STALE_SESSION_ADDRESS");
      expect((await app.listSessions(process.env.HOME)).map(s => s.id)).toEqual([chat.info.id]);
      expect(events.some(e => e.type === "ready")).toBe(true);
      expect(existsSync(join(process.env.HOME, ".config", "pig", "auth.json"))).toBe(true);
      expect(existsSync(join(process.env.HOME, ".config", "pig", "pi-agent"))).toBe(false);
      expect(existsSync(join(process.env.HOME, ".pi", "agent"))).toBe(false);
    } finally { await app.disposeSessions(); }
  `);
}, 30_000);

test("provider status, availability and requests ignore ambient credentials", async () => {
  await runServiceScript(`
    import { expect } from "bun:test";
    import { mkdir, writeFile } from "node:fs/promises";
    import { join } from "node:path";
    const home = process.env.HOME;
    await mkdir(join(home, ".config/gcloud"), {recursive: true});
    await writeFile(join(home, ".config/gcloud/application_default_credentials.json"), "{}");
    process.env.OPENAI_API_KEY = "ambient-openai";
    process.env.ANTHROPIC_API_KEY = "ambient-anthropic";
    process.env.AWS_ACCESS_KEY_ID = "ambient-aws";
    process.env.AWS_SECRET_ACCESS_KEY = "ambient-secret";
    process.env.GOOGLE_CLOUD_PROJECT = "ambient-project";
    process.env.GOOGLE_CLOUD_LOCATION = "us-central1";
    const app = await import(${service});
    try {
      expect(await app.credentials.list()).toEqual([]);
      expect((await app.listProviders()).find(p => p.id === "openai")).toMatchObject({name: "OpenAI ChatGPT", apiKey: false, oauth: {label: "Sign in with ChatGPT"}});
      expect((await app.listProviders()).find(p => p.id === "openai-api")).toMatchObject({name: "OpenAI API", apiKey: true, oauth: undefined});
      const subscription = structuredClone(app.runtime.getAllModels("openai"));
      expect(app.runtime.getAllModels("openai-api")).toEqual(subscription.map(m => ({...m, provider: "openai-api"})));
      // Mock catalog transport, including utility types absent from the baseline.
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
      const published = structuredClone(app.runtime.getAllModels("openai-api"));
      const catalogUnchanged = () => {
        expect(app.runtime.getAllModels("openai")).toEqual(subscription);
        expect(app.runtime.getAllModels("openai-api")).toEqual(published);
      };
      catalogUnchanged();
      expect(app.runtime.getAllModels("openai-api").map(m => m.id)).toContain("split-image");
      expect(app.runtime.getAllModels("openai-api").map(m => m.id)).toContain("split-classifier");
      await app.refreshModels({allowNetwork: false});
      catalogUnchanged();
      expect(app.runtime.getProvider("openai-api").auth.oauth).toBeUndefined();
      const configFile = join(home, ".config", "pig", "models.json");
      await writeFile(configFile, JSON.stringify({providers: {"openai-api": {modelOverrides: {[base.id]: {name: "API-only override"}}}}}));
      await app.refreshModels({providers: ["openai-api"], allowNetwork: false});
      expect(app.runtime.getModel("openai-api", base.id).name).toBe("API-only override");
      expect(app.runtime.getModel("openai", base.id).name).toBe(base.name);
      await writeFile(configFile, "{}");
      await app.refreshModels({allowNetwork: false});
      catalogUnchanged();
      await app.credentials.delete("openai-api");
      for (const id of ["openai-api", "anthropic", "amazon-bedrock", "google-vertex"]) {
        expect((await app.listProviders()).find(p => p.id === id)).toMatchObject({configured: false, stored: false});
        expect(await app.runtime.checkAuth(id)).toBeUndefined();
        expect(await app.runtime.getAuth(id)).toBeUndefined();
        expect(await app.runtime.getAllAvailable(id)).toEqual([]);
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
    } finally { await app.disposeSessions(); }
  `);
}, 30_000);

test("models.json composes app configuration and malformed config reports an error without crashing startup", async () => {
  for (const invalid of [false, true]) {
    await runServiceScript(`
      import { expect } from "bun:test";
      import { mkdir, writeFile } from "node:fs/promises";
      import { join } from "node:path";
      const dir = join(process.env.HOME, ".config", "pig");
      await mkdir(dir, {recursive: true});
      const config = {providers: {local: {api: "openai-completions", baseUrl: "http://localhost:1234", apiKey: "literal", models: [{id: "custom"}]}}};
      await writeFile(join(dir, "models.json"), ${invalid} ? '{"providers":[]}' : '// JSONC is supported\\n' + JSON.stringify(config));
      const app = await import(${service});
      try {
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
      } finally { await app.disposeSessions(); }
    `);
  }
}, 30_000);
