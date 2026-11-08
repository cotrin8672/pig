import { expect, test } from "bun:test";
import { createModels, fauxProvider } from "@earendil-works/pi-ai";
import { composeProviders, mergeModel } from "./model-composition";

test("provider composition upserts custom models, applies overrides last and resolves explicit auth/headers", async () => {
  const models = createModels({
    authContext: { env: async () => undefined, fileExists: async () => false },
  });
  const [provider] = composeProviders([], {
    providers: {
      local: {
        name: "Local",
        api: "openai-completions",
        baseUrl: "http://localhost:1234/v1",
        apiKey: "saved-key",
        authHeader: true,
        headers: { "X-App": "pig" },
        compat: { supportsStore: false },
        models: [{ id: "custom", headers: { "X-Model": "yes" } }],
        modelOverrides: {
          custom: {
            contextWindow: 4096,
            compat: { supportsDeveloperRole: false },
          },
        },
      },
    },
  });
  models.setProvider(provider);
  const model = models.getModel("local", "custom");
  expect(model).toMatchObject({
    provider: "local",
    name: "custom",
    api: "openai-completions",
    baseUrl: "http://localhost:1234/v1",
    contextWindow: 4096,
    compat: { supportsStore: false, supportsDeveloperRole: false },
    headers: { "X-Model": "yes" },
  });
  expect(await models.checkAuth("local")).toMatchObject({ type: "api_key" });
  expect((await models.getAuth("local"))?.auth).toMatchObject({
    apiKey: "saved-key",
    headers: { "X-App": "pig", Authorization: "Bearer saved-key" },
  });
  expect(await models.getAvailable()).toHaveLength(1);
});

test("nested overrides retain protocol flags, routing and effort defaults without mutating builtin", () => {
  const base = {
    compat: {
      supportsStore: true,
      openRouterRouting: { order: ["one"], only: ["two"] },
    },
    thinkingLevelMap: { low: "low", high: "high" },
    cost: { input: 1, output: 2 },
    inputLimits: { images: { resize: { width: 100, height: 100 } } },
  };
  const merged = mergeModel(base, {
    compat: {
      forceAdaptiveThinking: true,
      openRouterRouting: { order: ["three"] },
    },
    thinkingLevelMap: { low: "medium" },
    cost: { output: 3 },
    inputLimits: { images: { resize: { width: 50 } } },
  });
  expect(merged).toMatchObject({
    compat: {
      supportsStore: true,
      forceAdaptiveThinking: true,
      openRouterRouting: { order: ["three"], only: ["two"] },
    },
    thinkingLevelMap: { low: "medium", high: "high" },
    cost: { input: 1, output: 3 },
    inputLimits: { images: { resize: { width: 50, height: 100 } } },
  });
  expect(base.thinkingLevelMap.low).toBe("low");
});

test("provider override preserves builtin catalog, supports added models, rejects malformed configuration eagerly", () => {
  const { provider } = fauxProvider();
  const builtin = provider.getModels()[0];
  const [composed] = composeProviders([provider], {
    providers: {
      [provider.id]: {
        baseUrl: "http://local",
        models: [{ id: "added", api: "openai-completions" }],
        modelOverrides: { [builtin.id]: { name: "Edited" } },
      },
    },
  });
  expect(composed.getModels().find((m) => m.id === builtin.id)?.name).toBe(
    "Edited",
  );
  expect(composed.getModels().find((m) => m.id === "added")?.baseUrl).toBe(
    "http://local",
  );
  for (const config of [
    null,
    { providers: [] },
    { providers: { bad: null } },
    { providers: { bad: { models: [{}] } } },
    { providers: { bad: { modelOverrides: { id: { contextWindow: -1 } } } } },
    { providers: { bad: { headers: { secret: 2 } } } },
    {
      providers: {
        bad: { models: [{ id: "a", api: "missing", baseUrl: "http://local" }] },
      },
    },
  ])
    expect(() => composeProviders([provider], config)).toThrow();
});

test("custom Radius gateways retain OAuth methods and reject missing gateway configuration", () => {
  const [provider] = composeProviders([], {
    providers: {
      gateway: { oauth: "radius", baseUrl: "https://gateway.example" },
    },
  });
  expect(provider.id).toBe("gateway");
  expect(provider.auth.oauth).toBeDefined();
  expect(provider.refreshModels).toBeDefined();
  expect(() =>
    composeProviders([], { providers: { gateway: { oauth: "radius" } } }),
  ).toThrow("requires baseUrl");
  expect(() =>
    composeProviders([], {
      providers: { bad: { compat: { forceAdaptiveThinking: "yes" } } },
    }),
  ).toThrow("compat");
  expect(() =>
    composeProviders([], {
      providers: { bad: { modelOverrides: { id: { provider: "other" } } } },
    }),
  ).toThrow("Unknown model");
});
