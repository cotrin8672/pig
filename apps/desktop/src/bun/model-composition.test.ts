import { expect, spyOn, test } from "bun:test";
import {
  type ClassifierModel,
  createModels,
  fauxAssistantMessage,
  fauxProvider,
  type ImageModel,
  type Provider,
} from "@earendil-works/pi-ai";
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

test("configured protocols use the ten native 1.5 factories without a global API registry", () => {
  for (const api of [
    "anthropic-messages",
    "azure-openai-responses",
    "bedrock-converse-stream",
    "google-generative-ai",
    "google-vertex",
    "mistral-conversations",
    "openai-codex-responses",
    "openai-completions",
    "openai-responses",
    "pi-messages",
  ]) {
    const [provider] = composeProviders([], {
      providers: {
        local: {
          api,
          baseUrl: "http://fixture.invalid",
          models: [{ id: "custom" }],
        },
      },
    });
    expect(provider.getModels()[0].api).toBe(api);
  }
  for (const api of ["missing", "constructor", "__proto__"])
    expect(() =>
      composeProviders([], {
        providers: {
          local: {
            api,
            baseUrl: "http://fixture.invalid",
            models: [{ id: "custom" }],
          },
        },
      }),
    ).toThrow("unknown or missing api");
});

test("native configured streaming keeps explicit auth, model/provider headers and protocol flags", async () => {
  const requests: { headers: Headers; body: Record<string, unknown> }[] = [];
  const network = spyOn(globalThis, "fetch").mockImplementation(
    Object.assign(
      async (
        input: Parameters<typeof fetch>[0],
        init?: Parameters<typeof fetch>[1],
      ) => {
        const request = new Request(input, init);
        requests.push({
          headers: request.headers,
          body: (await request.json()) as Record<string, unknown>,
        });
        const chunks = [
          {
            id: "fixture",
            choices: [
              {
                index: 0,
                delta: { role: "assistant", content: "hello" },
                finish_reason: null,
              },
            ],
          },
          {
            id: "fixture",
            choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
            usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
          },
        ];
        return new Response(
          `${chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("")}data: [DONE]\n\n`,
          {
            headers: { "content-type": "text/event-stream" },
          },
        );
      },
      { preconnect: fetch.preconnect },
    ),
  );
  try {
    const [provider] = composeProviders([], {
      providers: {
        local: {
          api: "openai-completions",
          baseUrl: "http://fixture.invalid/v1",
          apiKey: "explicit-only",
          headers: { "X-Provider": "yes" },
          authHeader: true,
          compat: { supportsStore: false, supportsDeveloperRole: false },
          models: [{ id: "custom", headers: { "X-Model": "yes" } }],
        },
      },
    });
    const models = createModels({
      authContext: {
        env: async () => undefined,
        fileExists: async () => false,
      },
    });
    models.setProvider(provider);
    const model = provider.getModels()[0];
    const context = {
      messages: [{ role: "user" as const, content: "hi", timestamp: 0 }],
    };
    for (const result of [
      await models.complete(model, context),
      await models.completeSimple(model, context),
    ]) {
      expect(result.stopReason).toBe("stop");
      expect(result.content).toMatchObject([{ type: "text", text: "hello" }]);
    }
    expect(requests).toHaveLength(2);
    for (const request of requests) {
      expect(request.headers.get("authorization")).toBe("Bearer explicit-only");
      expect(request.headers.get("x-provider")).toBe("yes");
      expect(request.headers.get("x-model")).toBe("yes");
      expect(request.body).toMatchObject({ model: "custom", stream: true });
      expect(request.body.store).toBeUndefined();
    }
    const invalid = { ...model, api: "constructor" };
    expect(
      (await models.completeSimple(invalid, context)).errorMessage,
    ).toContain("Unknown API constructor");
    expect(requests).toHaveLength(2);
  } finally {
    network.mockRestore();
  }
});

test("builtin dispatch and utility image/classifier operations survive composition", async () => {
  const faux = fauxProvider();
  const chat = faux.models[0];
  const image: ImageModel<string> = {
    ...chat,
    type: "image",
    id: "image",
    output: ["image"],
  };
  const classifier: ClassifierModel<string> = {
    ...chat,
    type: "classifier",
    id: "classifier",
  };
  const builtin: Provider = {
    ...faux.provider,
    getAllModels: () => [chat, image, classifier],
    generateImages: async (model) => ({
      api: model.api,
      provider: model.provider,
      model: model.id,
      output: [],
      stopReason: "stop",
      timestamp: 0,
    }),
    classify: async (model) => ({
      api: model.api,
      provider: model.provider,
      model: model.id,
      answers: {},
      stopReason: "stop",
      timestamp: 0,
    }),
  };
  const [provider] = composeProviders([builtin], {
    providers: {
      [builtin.id]: {
        modelOverrides: {
          image: { name: "Image override" },
          classifier: { name: "Classifier override" },
        },
      },
    },
  });
  const models = createModels({
    authContext: { env: async () => undefined, fileExists: async () => false },
  });
  models.setProvider(provider);
  expect(models.getModels()).toHaveLength(1);
  expect(models.getModelOfType("image", builtin.id, "image")?.name).toBe(
    "Image override",
  );
  expect(
    models.getModelOfType("classifier", builtin.id, "classifier")?.name,
  ).toBe("Classifier override");
  faux.setResponses([fauxAssistantMessage("builtin-dispatch")]);
  expect((await models.completeSimple(chat, { messages: [] })).stopReason).toBe(
    "stop",
  );
  expect(faux.state.callCount).toBe(1);
  expect((await models.generateImages(image, { input: [] })).stopReason).toBe(
    "stop",
  );
  expect(
    (await models.classify(classifier, { state: {}, questions: {} }))
      .stopReason,
  ).toBe("stop");
  expect(
    builtin.getAllModels?.().find((model) => model.id === "image")?.name,
  ).not.toBe("Image override");
});

test("Radius gateway normalization retains native auth and rejects malformed provider flags", () => {
  for (const baseUrl of [
    "https://gateway.example",
    "https://gateway.example/v1",
    "https://gateway.example/v1/",
  ]) {
    const [provider] = composeProviders([], {
      providers: { gateway: { oauth: "radius", baseUrl } },
    });
    expect(provider.auth.apiKey?.name).toBe("Radius API key");
    expect(provider.auth.oauth?.login).toBeFunction();
    expect(provider.auth.oauth?.refresh).toBeFunction();
    expect(provider.auth.oauth?.toAuth).toBeFunction();
    expect(provider.refreshModels).toBeFunction();
  }
  for (const config of [
    { oauth: "other", baseUrl: "https://gateway.example" },
    { oauth: "radius", baseUrl: "" },
    { authHeader: "yes" },
    { compat: { supportsStore: "yes" } },
    { modelOverrides: { model: { thinkingLevelMap: { low: 2 } } } },
  ])
    expect(() =>
      composeProviders([], { providers: { gateway: config } }),
    ).toThrow();
});

test("Radius refresh uses the configured gateway and retains the learned model endpoint", async () => {
  const requests: Request[] = [];
  const model = fauxProvider().models[0];
  const network = spyOn(globalThis, "fetch").mockImplementation(
    Object.assign(
      async (
        input: Parameters<typeof fetch>[0],
        init?: Parameters<typeof fetch>[1],
      ) => {
        requests.push(new Request(input, init));
        return Response.json({
          baseUrl: "https://models.example/v1",
          models: [{ ...model, id: "learned" }],
        });
      },
      { preconnect: fetch.preconnect },
    ),
  );
  try {
    for (const baseUrl of [
      "https://gateway.example",
      "https://gateway.example/v1/",
    ]) {
      const [provider] = composeProviders([], {
        providers: {
          gateway: {
            oauth: "radius",
            baseUrl,
            apiKey: "fixture-key",
            modelOverrides: { learned: { name: "Configured" } },
          },
        },
      });
      const models = createModels({
        authContext: {
          env: async () => undefined,
          fileExists: async () => false,
        },
      });
      models.setProvider(provider);
      const result = await models.refresh({ allowNetwork: true });
      expect(result.errors.size).toBe(0);
      expect(models.getModel("gateway", "learned")).toMatchObject({
        api: "pi-messages",
        baseUrl: "https://models.example/v1",
        name: "Configured",
      });
    }
    expect(requests.map((request) => request.url)).toEqual([
      "https://gateway.example/v1/config",
      "https://gateway.example/v1/config",
    ]);
    for (const request of requests)
      expect(request.headers.get("authorization")).toBe("Bearer fixture-key");
  } finally {
    network.mockRestore();
  }
});
