import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** The parent may run under a Pi harness; children must resolve the default profile. */
function piEnv() {
  const env = { ...process.env };
  delete env.PI_CODING_AGENT_DIR;
  delete env.PI_CODING_AGENT_SESSION_DIR;
  return env;
}

// Subprocess isolation is required before importing profile/bootstrap/catalog.
test("application uses the standard Pi profile and preserves model/auth helpers", async () => {
  const home = await mkdtemp(join(tmpdir(), "pig-app-sdk-"));
  try {
    const script = `
      import { expect } from "bun:test";
      import { join } from "node:path";

/** The parent may run under a Pi harness; children must resolve the default profile. */
function piEnv() {
  const env = { ...process.env };
  delete env.PI_CODING_AGENT_DIR;
  delete env.PI_CODING_AGENT_SESSION_DIR;
  return env;
}
      import { fauxProvider, fauxAssistantMessage } from "@earendil-works/pi-ai";
      import * as app from ${JSON.stringify(new URL("./pi-service.ts", import.meta.url).href)};
      import { SessionHost } from ${JSON.stringify(new URL("./session-host.ts", import.meta.url).href)};
      expect((await app.utilityModels()).imageModels.some(m => m.provider === "openai-codex")).toBe(false);
      await Bun.write(join(${JSON.stringify(home)}, ".pi/agent/auth.json"), JSON.stringify({"openai-codex": {type: "oauth", access: "test-only", refresh: "test-only", expires: Date.now() + 3600000, accountId: "test-account"}}));
      expect((await app.utilityModels()).imageModels.filter(m => m.provider === "openai-codex").length).toBe(2);
      await app.runtime.logout("openai-codex");
      const faux = fauxProvider({tokensPerSecond: Infinity});
      const events = [];
      const host = new SessionHost({modelInfo: app.modelInfo, emit: e => events.push(e), emitUI() {}, emitTerminal() {}, configureModels: models => {models.registerNativeProvider(faux.provider);}});
      const input = {cwd: ${JSON.stringify(home)}, openId: "open-1"};
      const first = host.openSession(input);
      expect(host.openSession(input)).toBe(first);
      const chat = await first;
      expect(chat.info.id).toBe(chat.address.sessionId);
      expect(chat.address.hostId).toBe(host.hostId);
      expect(chat.info.id).not.toMatch(/^\\d+$/);
      await host.setModel({...chat.address, provider: faux.getModel().provider, id: faux.getModel().id});
      faux.setResponses([fauxAssistantMessage("App answer")]);
      const send = {...chat.address, text: "App hello", requestId: "app-1", draftRevision: 0};
      expect(await host.prompt(send)).toEqual({disposition: "started"});
      await host.session(chat.info.id).waitForIdle();
      await host.receipts.settled();
      expect(host.getPromptReceipt(send).state).toBe("accepted");
      const snapshot = host.getSessionSnapshot(chat.address);
      expect(snapshot.transcript.records.some(r => r.kind === "message" && r.message.role === "assistant")).toBe(true);
      expect(snapshot.transcript.running).toBe(false);
      expect(snapshot.snapshotSeq).toBeGreaterThan(chat.snapshotSeq);
      expect(events.some(e => e.type === "snapshot")).toBe(true);
      await host.renameSession(chat.info, "Renamed");
      expect((await host.listSessions(input.cwd)).find(s => s.id === chat.info.id).title).toBe("Renamed");
      const model = faux.getModel();
      expect(app.modelInfo({...model, api: "anthropic-messages", compat: {forceAdaptiveThinking: true}}).adaptiveThinking).toBe(true);
      await expect(host.prompt({...send, text: "", requestId: "empty", draftRevision: host.drafts.read(chat.address).revision})).rejects.toThrow("empty");
      await host.closeSession(chat.address);
      expect(host.getPromptReceipt(send).state).toBe("accepted");
      const reopened = await host.openSession({...input, openId: "open-2", id: chat.info.id});
      expect(reopened.address.epoch).toBeGreaterThan(chat.address.epoch);
      expect(reopened.info.title).toBe("Renamed");
      expect(() => host.getSessionSnapshot(chat.address)).toThrow("STALE");
      const userEntry = reopened.transcript.records.find(r => r.kind === "message" && r.message.role === "user");
      await host.rewindSession({...reopened.address, entryId:userEntry.entryId});
      await host.closeSession(reopened.address);
      const rewound = await host.openSession({...input, openId:"rewound-reopen", id:chat.info.id});
      expect(rewound.transcript.records.filter(r => r.kind === "message")).toHaveLength(0);
      expect(rewound.info.title).toBe("Renamed");
      await host.deleteSession(reopened.info);
      expect(await host.listSessions(input.cwd)).toEqual([]);
      await host.dispose(); await app.disposeSessions();
    `;
    const child = Bun.spawn([process.execPath, "--eval", script], {
      cwd: join(import.meta.dir, "../.."),
      env: { ...piEnv(), HOME: home, USERPROFILE: home, PI_OFFLINE: "1" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [code, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    expect({ code, stdout, stderr }).toMatchObject({ code: 0 });
    expect(existsSync(join(home, ".pi", "agent", "sessions"))).toBe(true);
    expect(existsSync(join(home, ".pi", "agent", "auth.json"))).toBe(true);
    expect(existsSync(join(home, ".config", "pig", "auth.json"))).toBe(false);
    // pig must not create its own private Pi profile any more.
    expect(existsSync(join(home, ".config", "pig", "pi-agent"))).toBe(false);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
}, 30_000);

test("OpenAI API uses SDK credential precedence and mirrors the ChatGPT catalog", async () => {
  const home = await mkdtemp(join(tmpdir(), "pig-app-auth-"));
  try {
    // A subprocess isolates process.env and the module-level app runtime; the
    // parent's environment is never changed and the child's dies on exit.
    const script = `
      import { expect } from "bun:test";
      import { writeFile } from "node:fs/promises";
      import { join } from "node:path";

/** The parent may run under a Pi harness; children must resolve the default profile. */
function piEnv() {
  const env = { ...process.env };
  delete env.PI_CODING_AGENT_DIR;
  delete env.PI_CODING_AGENT_SESSION_DIR;
  return env;
}
      const home = ${JSON.stringify(home)};
      process.env.OPENAI_API_KEY = "ambient-openai";
      const app = await import(${JSON.stringify(new URL("./pi-service.ts", import.meta.url).href)});
      expect(await app.runtime.listCredentials()).toEqual([]);
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
      const apiStatus = async () => (await app.listProviders()).find(p => p.id === "openai-api");
      expect(await apiStatus()).toMatchObject({configured: true, stored: false});
      expect((await app.runtime.getAuth("openai-api")).auth.apiKey).toBe("ambient-openai");
      await app.runtime.login("openai-api", "api_key", {prompt: async () => "catalog-test", notify() {}});
      expect(await apiStatus()).toMatchObject({configured: true, stored: true});
      expect((await app.runtime.getAuth("openai-api")).auth.apiKey).toBe("catalog-test");
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
      const configFile = join(home, ".pi", "agent", "models.json");
      await writeFile(configFile, JSON.stringify({providers: {"openai-api": {modelOverrides: {[base.id]: {name: "API-only override"}}}}}));
      await app.refreshModels({providers: ["openai-api"], allowNetwork: false});
      expect(app.runtime.getModel("openai-api", base.id).name).toBe("API-only override");
      expect(app.runtime.getModel("openai", base.id).name).toBe(base.name);
      await writeFile(configFile, "{}");
      await app.refreshModels({allowNetwork: false});
      mirror();
      await app.runtime.logout("openai-api");
      expect(await apiStatus()).toMatchObject({configured: true, stored: false});
      expect((await app.runtime.getAuth("openai-api")).auth.apiKey).toBe("ambient-openai");
      expect(await app.runtime.checkAuth("openai")).toBeUndefined();
      delete process.env.OPENAI_API_KEY;
      expect(await app.runtime.checkAuth("openai-api")).toBeUndefined();
    `;
    const child = Bun.spawn([process.execPath, "--eval", script], {
      cwd: join(import.meta.dir, "../.."),
      env: { ...piEnv(), HOME: home, USERPROFILE: home, PI_OFFLINE: "1" },
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
}, 30_000);

test("models.json composes app configuration and malformed config reports an error without crashing startup", async () => {
  for (const invalid of [false, true]) {
    const home = await mkdtemp(join(tmpdir(), "pig-app-model-config-"));
    try {
      const script = `
        import { expect } from "bun:test";
        import { mkdir, writeFile } from "node:fs/promises";
        import { join } from "node:path";

/** The parent may run under a Pi harness; children must resolve the default profile. */
function piEnv() {
  const env = { ...process.env };
  delete env.PI_CODING_AGENT_DIR;
  delete env.PI_CODING_AGENT_SESSION_DIR;
  return env;
}
        const dir = join(${JSON.stringify(home)}, ".pi", "agent");
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
        app.runtime.registerNativeProvider({...provider, refreshModels: async () => {throw new Error("catalog failure");}});
        await app.refreshModels({allowNetwork: false});
        expect(app.modelErrors.some(e => e.includes("catalog failure"))).toBe(true);
      `;
      const child = Bun.spawn([process.execPath, "--eval", script], {
        cwd: join(import.meta.dir, "../.."),
        env: { ...piEnv(), HOME: home, USERPROFILE: home, PI_OFFLINE: "1" },
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
}, 30_000);
