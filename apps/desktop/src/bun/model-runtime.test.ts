import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type ApiKeyAuth,
  type AuthContext,
  type ClassifierModel,
  createModels,
  fauxAssistantMessage,
  fauxProvider,
  type ImageModel,
  type MutableModels,
  type Provider,
} from "@earendil-works/pi-ai";
import { CODEX_IMAGE_MODEL_IDS } from "./codex-images";
import { FileCredentials } from "./credentials";
import { composeProviders } from "./model-composition";
import {
  appAuthContext,
  applyRuntimeModelSettings,
  createModelRuntime,
  isExtensionProvider,
  modelRuntimeErrors,
  refreshAllModelRuntimes,
  releaseModelRuntime,
  setRuntimeProviders,
} from "./model-runtime";
import { FileModelsStore } from "./models-store";

let root: string;
let runtimes: MutableModels[];
let network: ReturnType<typeof spyOn<typeof globalThis, "fetch">>;
beforeEach(async () => {
  root = await mkdtemp(
    join(process.env.PI_SCRATCH_DIR ?? tmpdir(), "pig-native-models-"),
  );
  runtimes = [];
  network = spyOn(globalThis, "fetch").mockImplementation(
    Object.assign(
      () => {
        throw new Error("Unexpected model network request");
      },
      { preconnect: fetch.preconnect },
    ),
  );
});
afterEach(async () => {
  for (const runtime of runtimes) releaseModelRuntime(runtime);
  network.mockRestore();
  await rm(root, { recursive: true, force: true });
});
async function collection(directory = root) {
  await mkdir(directory, { recursive: true });
  const credentials = new FileCredentials(join(directory, "auth.json"));
  const models = await createModelRuntime(credentials, directory);
  runtimes.push(models);
  return { models, credentials };
}
function fixture(id: string, model = "fixture") {
  return fauxProvider({ provider: id, models: [{ id: model }] });
}

function dynamic(id: string, model: string) {
  const faux = fixture(id, model);
  const phases: boolean[] = [];
  const provider: Provider = {
    ...faux.provider,
    refreshModels: async (context) => {
      phases.push(context.allowNetwork);
      await context.publish({ update() {} });
    },
  };
  return { provider, phases };
}

test("native collections isolate add/remove/refresh for catalog, same-root and different-root workspaces", async () => {
  const { models: catalog } = await collection(join(root, "catalog"));
  const { models: a } = await collection(join(root, "a"));
  const { models: same } = await collection(join(root, "a"));
  const { models: b } = await collection(join(root, "b"));
  expect(Object.getPrototypeOf(a)).toBe(Object.getPrototypeOf(createModels()));
  for (const other of [catalog, same, b]) {
    expect(a).not.toBe(other);
    for (const id of ["openai", "openai-api", "openrouter", "radius"])
      expect(a.getProvider(id)).not.toBe(other.getProvider(id));
  }
  const fixtures = [a, same, b].map((runtime, index) => {
    const entry = dynamic("workspace", `model-${index}`);
    setRuntimeProviders(runtime, [entry.provider]);
    return entry;
  });
  expect(catalog.getProvider("workspace")).toBeUndefined();
  expect(isExtensionProvider(a, "workspace")).toBe(true);
  expect(isExtensionProvider(a, "openai-api")).toBe(false);
  expect(isExtensionProvider(a, "missing")).toBe(false);
  const results = await refreshAllModelRuntimes({ providers: ["workspace"] });
  expect(results).toHaveLength(4);
  expect(
    results.every((result) => !result.aborted && result.errors.size === 0),
  ).toBe(true);
  for (const entry of fixtures) expect(entry.phases).toEqual([false]);
  a.deleteProvider("workspace");
  a.deleteProvider("openai-api");
  await a.refresh({ allowNetwork: false, providers: ["workspace"] });
  expect(a.getModels("workspace")).toHaveLength(0);
  expect(same.getModel("workspace", "model-1")).toBeDefined();
  expect(b.getModel("workspace", "model-2")).toBeDefined();
  expect(same.getProvider("openai-api")).toBeDefined();
  releaseModelRuntime(a);
  releaseModelRuntime(a);
  expect(
    await refreshAllModelRuntimes({ providers: ["workspace"] }),
  ).toHaveLength(3);
  expect(fixtures.map((entry) => entry.phases.length)).toEqual([1, 2, 2]);
  expect(network).not.toHaveBeenCalled();
});

test("config replacement restores current app providers without clearing unrelated registrations", async () => {
  const file = join(root, "models.json");
  const config = (name: string) => ({
    providers: {
      local: {
        api: "openai-completions",
        baseUrl: "http://fixture.invalid",
        apiKey: "app-only",
        models: [{ id: "app", name }],
      },
    },
  });
  await writeFile(file, JSON.stringify(config("Before")));
  const { models: a } = await collection();
  const { models: same } = await collection();
  const { models: b } = await collection(join(root, "other"));
  const first = fixture("local", "config-first").provider;
  const second = fixture("local", "config-second").provider;
  const other = fixture("local", "other-workspace").provider;
  const unrelated = fixture("direct").provider;
  a.setProvider(unrelated);
  setRuntimeProviders(a, [first]);
  setRuntimeProviders(b, [other]);
  expect(isExtensionProvider(a, "local")).toBe(true);
  expect(() => setRuntimeProviders(a, [second, second])).toThrow(
    "Duplicate provider",
  );
  expect(a.getProvider("local")).toBe(first);
  setRuntimeProviders(a, [second]);
  expect(a.getModel("local", "config-first")).toBeUndefined();
  await writeFile(file, JSON.stringify(config("After")));
  await applyRuntimeModelSettings(a);
  expect(a.getProvider("local")).toBe(second);
  setRuntimeProviders(a, []);
  expect(a.getModel("local", "app")?.name).toBe("After");
  expect(isExtensionProvider(a, "local")).toBe(false);
  expect(a.getProvider("direct")).toBe(unrelated);
  expect(same.getModel("local", "app")?.name).toBe("Before");
  expect(b.getProvider("local")).toBe(other);
  expect(a.getProvider("openai-api")).toBeDefined();
  const managed = fixture("replaced").provider;
  const direct = fixture("replaced", "direct-replacement").provider;
  setRuntimeProviders(a, [managed]);
  a.setProvider(direct);
  setRuntimeProviders(a, []);
  expect(a.getProvider("replaced")).toBe(direct);
  await writeFile(file, "{}");
  await applyRuntimeModelSettings(a, ["openai-api"]);
  expect(a.getProvider("local")).toBeDefined();
  await applyRuntimeModelSettings(a, ["local"]);
  expect(a.getProvider("local")).toBeUndefined();
  expect(a.getProvider("direct")).toBe(unrelated);
  expect(() => setRuntimeProviders(createModels(), [])).toThrow(
    "not app-owned",
  );
});

test("removing a config provider supersedes only its native in-flight refresh", async () => {
  const { models: a } = await collection();
  const { models: b } = await collection();
  let enter!: () => void;
  const entered = new Promise<void>((resolve) => {
    enter = resolve;
  });
  let finish!: () => void;
  const gate = new Promise<void>((resolve) => {
    finish = resolve;
  });
  let settle!: () => void;
  const settled = new Promise<void>((resolve) => {
    settle = resolve;
  });
  let updated = false;
  let superseded = false;
  const stale = fixture("pending").provider;
  setRuntimeProviders(a, [
    {
      ...stale,
      refreshModels: async (context) => {
        enter();
        await gate;
        try {
          superseded = !(await context.publish({
            update() {
              updated = true;
            },
          }));
        } catch (error) {
          if (!context.signal.aborted) throw error;
          superseded = true;
        } finally {
          settle();
        }
      },
    },
  ]);
  const other = dynamic("pending", "other");
  setRuntimeProviders(b, [other.provider]);
  const refresh = a.refresh({ allowNetwork: false, providers: ["pending"] });
  await entered;
  setRuntimeProviders(a, []);
  finish();
  expect((await refresh).errors.size).toBe(0);
  await b.refresh({ allowNetwork: false, providers: ["pending"] });
  await settled;
  expect(superseded).toBe(true);
  expect(updated).toBe(false);
  expect(a.getProvider("pending")).toBeUndefined();
  expect(b.getModel("pending", "other")).toBeDefined();
  expect(other.phases).toEqual([false]);
});

test("appAuthContext identity reaches checks, fallback resolution, refresh, requests and composed providers", async () => {
  const { models, credentials } = await collection();
  const faux = fixture("auth");
  const contexts: AuthContext[] = [];
  const auth: ApiKeyAuth = {
    name: "Fixture only",
    check: async ({ ctx, credential }) => {
      contexts.push(ctx);
      expect(await ctx.env("OPENAI_API_KEY")).toBeUndefined();
      expect(await ctx.fileExists(join(root, "auth.json"))).toBe(false);
      return credential?.key ? { type: "api_key" } : undefined;
    },
    resolve: async ({ ctx, credential }) => {
      contexts.push(ctx);
      expect(await ctx.env("OPENAI_API_KEY")).toBeUndefined();
      expect(await ctx.fileExists(join(root, "auth.json"))).toBe(false);
      return credential?.key ? { auth: { apiKey: credential.key } } : undefined;
    },
  };
  const image: ImageModel<string> = {
    ...faux.models[0],
    type: "image",
    id: "image",
    output: ["image"],
  };
  const classifier: ClassifierModel<string> = {
    ...faux.models[0],
    type: "classifier",
    id: "classifier",
  };
  const phases: boolean[] = [];
  const provider: Provider = {
    ...faux.provider,
    auth: { apiKey: auth },
    getAllModels: () => [...faux.models, image, classifier],
    refreshModels: async (context) => {
      phases.push(context.allowNetwork);
    },
    generateImages: async (model, _context, options) => {
      expect(options?.apiKey).toBe("saved-only");
      return {
        api: model.api,
        model: model.id,
        provider: model.provider,
        output: [],
        stopReason: "stop",
        timestamp: 0,
      };
    },
    classify: async (model, _context, options) => {
      expect(options?.apiKey).toBe("saved-only");
      return {
        api: model.api,
        model: model.id,
        provider: model.provider,
        answers: {},
        stopReason: "stop",
        timestamp: 0,
      };
    },
  };
  setRuntimeProviders(models, [provider]);
  expect(await models.checkAuth("auth")).toBeUndefined();
  expect(await models.getAuth("auth")).toBeUndefined();
  await models.refresh({ providers: ["auth"], allowNetwork: true });
  expect(phases).toEqual([false]);
  await credentials.modify("auth", async () => ({
    type: "api_key",
    key: "saved-only",
  }));
  expect(await models.checkAuth("auth")).toEqual({ type: "api_key" });
  expect((await models.getAuth("auth"))?.auth.apiKey).toBe("saved-only");
  expect((await models.getAuth(faux.models[0]))?.auth.apiKey).toBe(
    "saved-only",
  );
  expect(
    (await models.getAuth("auth", { apiKey: "explicit" }))?.auth.apiKey,
  ).toBe("explicit");
  expect(await models.getAvailable("auth")).toHaveLength(1);
  expect(await models.getAllAvailable("auth")).toHaveLength(3);
  expect(await models.getAvailableOfType("image", "auth")).toHaveLength(1);
  await models.refresh({ providers: ["auth"], allowNetwork: true });
  expect(phases).toEqual([false, false, true]);
  faux.setResponses([
    fauxAssistantMessage("normal"),
    fauxAssistantMessage("simple"),
  ]);
  expect(
    (await models.complete(faux.models[0], { messages: [] })).stopReason,
  ).toBe("stop");
  expect(
    (await models.completeSimple(faux.models[0], { messages: [] })).stopReason,
  ).toBe("stop");
  expect((await models.generateImages(image, { input: [] })).stopReason).toBe(
    "stop",
  );
  expect(
    (await models.classify(classifier, { state: {}, questions: {} }))
      .stopReason,
  ).toBe("stop");
  const { check: _check, ...fallback } = auth;
  setRuntimeProviders(models, [{ ...provider, auth: { apiKey: fallback } }]);
  expect(await models.checkAuth("auth")).toEqual({
    type: "api_key",
    source: undefined,
  });
  const [composed] = composeProviders([provider], {
    providers: { auth: { headers: { "X-Fixture": "yes" } } },
  });
  setRuntimeProviders(models, [composed]);
  expect(await models.checkAuth("auth")).toEqual({ type: "api_key" });
  expect((await models.getAuth("auth"))?.auth.headers).toEqual({
    "X-Fixture": "yes",
  });
  await models.refresh({ providers: ["auth"], allowNetwork: true });
  expect(contexts.length).toBeGreaterThan(15);
  expect(contexts.every((context) => context === appAuthContext)).toBe(true);
  expect(network).not.toHaveBeenCalled();
});

test("ambient env, CLI credentials and ADC files are ignored; FileCredentials reads stay authoritative", async () => {
  const cli = join(root, ".pi", "agent");
  const adc = join(
    root,
    ".config",
    "gcloud",
    "application_default_credentials.json",
  );
  await mkdir(cli, { recursive: true });
  await mkdir(join(root, ".config", "gcloud"), { recursive: true });
  await writeFile(
    join(cli, "auth.json"),
    JSON.stringify({ anthropic: { type: "api_key", key: "cli-only" } }),
  );
  await writeFile(adc, JSON.stringify({ access_token: "ambient-only" }));
  const env = {
    HOME: root,
    USERPROFILE: root,
    OPENAI_API_KEY: "ambient-only",
    ANTHROPIC_API_KEY: "ambient-only",
    GOOGLE_APPLICATION_CREDENTIALS: adc,
    GOOGLE_CLOUD_PROJECT: "fixture",
    GOOGLE_CLOUD_LOCATION: "fixture",
    AWS_PROFILE: "fixture",
    AWS_ACCESS_KEY_ID: "fixture",
    AWS_SECRET_ACCESS_KEY: "fixture",
  };
  const previous = Object.fromEntries(
    Object.keys(env).map((key) => [key, process.env[key]]),
  );
  try {
    Object.assign(process.env, env);
    const { models, credentials } = await collection();
    for (const id of [
      "openai",
      "openai-api",
      "openai-codex",
      "anthropic",
      "google-vertex",
      "amazon-bedrock",
      "github-copilot",
    ]) {
      expect(await models.checkAuth(id)).toBeUndefined();
      expect(await models.getAuth(id)).toBeUndefined();
    }
    await credentials.modify("anthropic", async () => ({
      type: "api_key",
      key: "saved-$$literal",
    }));
    expect((await models.getAuth("anthropic"))?.auth.apiKey).toBe(
      "saved-$literal",
    );
    await credentials.modify("anthropic", async () => ({
      type: "api_key",
      key: "$ANTHROPIC_API_KEY",
    }));
    expect(await credentials.list()).toEqual([
      { providerId: "anthropic", type: "api_key" },
    ]);
    await expect(models.getAuth("anthropic")).rejects.toThrow(
      "Credential store read failed",
    );
    await credentials.delete("anthropic");
    expect(await models.getAuth("anthropic")).toBeUndefined();
    expect(network).not.toHaveBeenCalled();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("native OAuth refresh uses only the app store, preserves failure and never falls back to API auth", async () => {
  const { models, credentials } = await collection();
  const faux = fixture("oauth-fixture");
  let apiCalls = 0;
  let refreshes = 0;
  let fail = false;
  setRuntimeProviders(models, [
    {
      ...faux.provider,
      auth: {
        apiKey: {
          name: "Forbidden fallback",
          resolve: async () => {
            apiCalls++;
            return undefined;
          },
        },
        oauth: {
          name: "Fixture OAuth",
          login: async () => ({
            type: "oauth",
            access: "login",
            refresh: "refresh",
            expires: 0,
          }),
          refresh: async (credential, signal) => {
            expect(signal).toBeInstanceOf(AbortSignal);
            refreshes++;
            if (fail) throw new Error("Fixture failure");
            return {
              ...credential,
              access: "refreshed",
              expires: Date.now() + 3_600_000,
            };
          },
          toAuth: async (credential) => ({ apiKey: credential.access }),
        },
      },
      refreshModels: async () => {},
    },
  ]);
  await models.login("oauth-fixture", "oauth", {
    prompt: async () => "",
    notify() {},
  });
  expect(await models.checkAuth("oauth-fixture")).toEqual({
    type: "oauth",
    source: "OAuth",
  });
  expect(refreshes).toBe(0);
  expect((await models.getAuth("oauth-fixture"))?.auth.apiKey).toBe(
    "refreshed",
  );
  expect((await credentials.read("oauth-fixture"))?.type).toBe("oauth");
  await credentials.modify("oauth-fixture", async (credential) =>
    credential?.type === "oauth" ? { ...credential, expires: 0 } : undefined,
  );
  await models.refresh({ providers: ["oauth-fixture"], allowNetwork: true });
  expect(refreshes).toBe(2);
  await credentials.modify("oauth-fixture", async (credential) =>
    credential?.type === "oauth" ? { ...credential, expires: 0 } : undefined,
  );
  fail = true;
  await expect(models.getAuth("oauth-fixture")).rejects.toThrow(
    "OAuth refresh failed",
  );
  expect((await credentials.read("oauth-fixture"))?.type).toBe("oauth");
  expect(apiCalls).toBe(0);
  await models.logout("oauth-fixture");
  expect(await credentials.read("oauth-fixture")).toBeUndefined();
});

test("offline catalogs retain personalization, utility models, overrides, Codex images and OpenAI auth separation", async () => {
  const store = new FileModelsStore(join(root, "model-catalogs"));
  const chat = {
    ...fixture("anthropic", "cached").models[0],
    reasoning: true,
    thinkingLevelMap: { low: "low", high: "high" },
  };
  const image: ImageModel<string> = {
    ...chat,
    type: "image",
    id: "utility-image",
    output: ["image"],
  };
  const classifier: ClassifierModel<string> = {
    ...chat,
    type: "classifier",
    id: "utility-classifier",
  };
  await store.write("anthropic", {
    models: [chat, image, classifier],
    lastModified: Number.MAX_SAFE_INTEGER,
  });
  await store.write("openrouter", {
    models: [{ ...chat, provider: "openrouter", id: "personal" }],
  });
  for (const [provider, id] of [
    ["openai", "subscription-only"],
    ["openai-api", "api-only"],
  ])
    await store.write(provider, {
      models: [{ ...chat, provider, id }],
      lastModified: Number.MAX_SAFE_INTEGER,
    });
  await writeFile(
    join(root, "models.json"),
    JSON.stringify({
      providers: {
        anthropic: {
          modelOverrides: {
            cached: { name: "Configured", thinkingLevelMap: { low: "medium" } },
            "utility-image": { name: "Configured image" },
          },
        },
      },
    }),
  );
  const { models: a, credentials } = await collection();
  const { models: same } = await collection();
  expect(a.getModel("anthropic", "cached")).toMatchObject({
    name: "Configured",
    thinkingLevelMap: { low: "medium", high: "high" },
  });
  expect(a.getModelOfType("image", "anthropic", "utility-image")?.name).toBe(
    "Configured image",
  );
  expect(
    a.getModelOfType("classifier", "anthropic", "utility-classifier"),
  ).toBeDefined();
  expect(a.getModels("openrouter").map((model) => model.id)).toEqual([
    "personal",
  ]);
  for (const id of CODEX_IMAGE_MODEL_IDS)
    expect(a.getModelOfType("image", "openai-codex", id)).toBeDefined();
  expect(a.getModel("openai-api", "api-only")?.provider).toBe("openai-api");
  expect(a.getModel("openai", "api-only")).toBeUndefined();
  expect(a.getModel("openai", "subscription-only")).toBeDefined();
  expect(a.getModel("openai-api", "subscription-only")).toBeUndefined();
  expect(a.getProvider("openai")?.auth.apiKey).toBeUndefined();
  expect(a.getProvider("openai")?.auth.oauth?.isSubscription).toBe(true);
  expect(a.getProvider("openai-api")?.auth.oauth).toBeUndefined();
  expect(a.getModelsOfType("classifier", "openai-api").length).toBeGreaterThan(
    0,
  );
  await credentials.modify("openai-api", async () => ({
    type: "api_key",
    key: "api-key-only",
  }));
  expect((await a.getAuth("openai-api"))?.auth.apiKey).toBe("api-key-only");
  expect(await a.getAuth("openai")).toBeUndefined();
  await credentials.modify("openai", async () => ({
    type: "api_key",
    key: "wrong-credential-type",
  }));
  expect(await a.getAuth("openai")).toBeUndefined();
  await store.write("openrouter", {
    models: [{ ...chat, provider: "openrouter", id: "new-personal" }],
  });
  await a.refresh({ allowNetwork: false, providers: ["openrouter"] });
  expect(a.getModels("openrouter").map((model) => model.id)).toEqual([
    "new-personal",
  ]);
  expect(same.getModels("openrouter").map((model) => model.id)).toEqual([
    "personal",
  ]);
  const errorCount = modelRuntimeErrors.length;
  await writeFile(join(root, "models.json"), "{invalid");
  await applyRuntimeModelSettings(a);
  expect(modelRuntimeErrors.length).toBe(errorCount + 1);
  expect(a.getProvider("anthropic")).toBeDefined();
  modelRuntimeErrors.splice(errorCount);
  expect(network).not.toHaveBeenCalled();
});

test("OpenAI API remote publication persists the alias without mutating subscription or sibling catalogs", async () => {
  const { models, credentials } = await collection();
  const { models: same } = await collection();
  const requested: string[] = [];
  network.mockImplementation(
    Object.assign(
      async (input: Parameters<typeof fetch>[0]) => {
        requested.push(String(input));
        return Response.json(
          { models: [fixture("openai", "api-remote").models[0]] },
          { headers: { "last-modified": "Wed, 01 Jan 2031 00:00:00 GMT" } },
        );
      },
      { preconnect: fetch.preconnect },
    ),
  );
  await credentials.modify("openai-api", async () => ({
    type: "api_key",
    key: "fixture-only",
  }));
  const result = await models.refresh({
    providers: ["openai-api"],
    allowNetwork: true,
  });
  expect(result.errors.size).toBe(0);
  expect(requested).toHaveLength(1);
  expect(new URL(requested[0]).pathname).toBe("/api/models/providers/openai");
  expect(models.getModel("openai-api", "api-remote")?.provider).toBe(
    "openai-api",
  );
  expect(models.getModel("openai", "api-remote")).toBeUndefined();
  expect(same.getModel("openai-api", "api-remote")).toBeUndefined();
  const entry = await new FileModelsStore(join(root, "model-catalogs")).read(
    "openai-api",
  );
  expect(entry?.models).toMatchObject([
    { id: "api-remote", provider: "openai-api" },
  ]);
});
