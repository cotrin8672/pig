import {
  type Api,
  createProvider,
  lazyStream,
  type Model,
  type Provider,
  type ProviderAuth,
  type ProviderStreams,
} from "@earendil-works/pi-ai";
import { anthropicMessagesApi } from "@earendil-works/pi-ai/api/anthropic-messages.lazy";
import { azureOpenAIResponsesApi } from "@earendil-works/pi-ai/api/azure-openai-responses.lazy";
import { bedrockConverseStreamApi } from "@earendil-works/pi-ai/api/bedrock-converse-stream.lazy";
import { googleGenerativeAIApi } from "@earendil-works/pi-ai/api/google-generative-ai.lazy";
import { googleVertexApi } from "@earendil-works/pi-ai/api/google-vertex.lazy";
import { mistralConversationsApi } from "@earendil-works/pi-ai/api/mistral-conversations.lazy";
import { openAICodexResponsesApi } from "@earendil-works/pi-ai/api/openai-codex-responses.lazy";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";
import { openAIResponsesApi } from "@earendil-works/pi-ai/api/openai-responses.lazy";
import { piMessagesApi } from "@earendil-works/pi-ai/api/pi-messages.lazy";
import { radiusProvider } from "@earendil-works/pi-ai/providers/radius";
import { resolveSavedValue } from "./config-value";

// Code-only factories, never a global registry or shared provider instances.
const apiFactories: ReadonlyMap<string, () => ProviderStreams> = new Map([
  ["anthropic-messages", anthropicMessagesApi],
  ["azure-openai-responses", azureOpenAIResponsesApi],
  ["bedrock-converse-stream", bedrockConverseStreamApi],
  ["google-generative-ai", googleGenerativeAIApi],
  ["google-vertex", googleVertexApi],
  ["mistral-conversations", mistralConversationsApi],
  ["openai-codex-responses", openAICodexResponsesApi],
  ["openai-completions", openAICompletionsApi],
  ["openai-responses", openAIResponsesApi],
  ["pi-messages", piMessagesApi],
]);

type ObjectValue = Record<string, unknown>;
function object(value: unknown): value is ObjectValue {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
/** Nested protocol flags, effort maps, cost and image limits must retain unspecified defaults. */
export function mergeModel<T>(base: T, override: unknown): T {
  if (!object(base) || !object(override)) return (override ?? base) as T;
  const result: ObjectValue = { ...base };
  for (const [key, value] of Object.entries(override)) {
    if (["__proto__", "constructor", "prototype"].includes(key))
      throw new Error("Invalid configuration property");
    result[key] = object(value) ? mergeModel(result[key], value) : value;
  }
  return result as T;
}
function validateModel(
  value: unknown,
  definition = false,
): asserts value is Partial<Model<Api>> & { id: string } {
  if (!object(value)) throw new Error("Model configuration must be an object");
  const allowed = new Set([
    "name",
    "reasoning",
    "thinkingLevelMap",
    "input",
    "inputLimits",
    "cost",
    "promptCache",
    "contextWindow",
    "maxTokens",
    "samplingParams",
    "samplingParamsByThinkingLevel",
    "headers",
    "compat",
    ...(definition ? ["id", "api", "baseUrl"] : []),
  ]);
  for (const key of Object.keys(value))
    if (!allowed.has(key))
      throw new Error(`Unknown model configuration field: ${key}`);
  if (definition && (typeof value.id !== "string" || !value.id))
    throw new Error("Custom model requires an id");
  for (const key of ["name", "api", "baseUrl"])
    if (value[key] !== undefined && typeof value[key] !== "string")
      throw new Error(`Invalid ${key}`);
  for (const key of ["contextWindow", "maxTokens"])
    if (
      value[key] !== undefined &&
      (typeof value[key] !== "number" ||
        !Number.isFinite(value[key]) ||
        value[key] <= 0)
    )
      throw new Error(`Invalid ${key}`);
  if (value.reasoning !== undefined && typeof value.reasoning !== "boolean")
    throw new Error("Invalid reasoning");
  if (
    value.input !== undefined &&
    (!Array.isArray(value.input) ||
      !value.input.length ||
      value.input.some((v) => v !== "text" && v !== "image"))
  )
    throw new Error("Invalid model input");
  for (const key of [
    "compat",
    "thinkingLevelMap",
    "cost",
    "headers",
    "inputLimits",
    "promptCache",
    "samplingParams",
    "samplingParamsByThinkingLevel",
  ])
    if (value[key] !== undefined && !object(value[key]))
      throw new Error(`Invalid ${key}`);
  if (object(value.cost))
    for (const key of ["input", "output", "cacheRead", "cacheWrite"])
      if (
        value.cost[key] !== undefined &&
        (typeof value.cost[key] !== "number" || value.cost[key] < 0)
      )
        throw new Error("Invalid model cost");
  if (object(value.thinkingLevelMap))
    for (const mapped of Object.values(value.thinkingLevelMap))
      if (mapped !== null && typeof mapped !== "string")
        throw new Error("Invalid thinking level mapping");
  if (object(value.compat)) validateCompat(value.compat);
  if (object(value.samplingParamsByThinkingLevel))
    for (const params of Object.values(value.samplingParamsByThinkingLevel))
      if (!object(params))
        throw new Error("Invalid thinking-level sampling parameters");
  validateHeaders(value.headers);
}
function validateHeaders(
  value: unknown,
): asserts value is Record<string, string> | undefined {
  if (
    value !== undefined &&
    (!object(value) || Object.values(value).some((v) => typeof v !== "string"))
  )
    throw new Error("Headers must contain string values");
}
function validateCompat(value: ObjectValue) {
  for (const [key, flag] of Object.entries(value)) {
    if (
      (key.startsWith("supports") ||
        key.startsWith("requires") ||
        key === "forceAdaptiveThinking") &&
      typeof flag !== "boolean"
    )
      throw new Error(`Invalid compat.${key}`);
    if (
      [
        "openRouterRouting",
        "vercelGatewayRouting",
        "chatTemplateKwargs",
        "chatTemplateArgs",
      ].includes(key) &&
      !object(flag)
    )
      throw new Error(`Invalid compat.${key}`);
  }
}
async function headers(
  value: Record<string, string> | undefined,
  signal?: AbortSignal,
) {
  return (
    value &&
    Object.fromEntries(
      await Promise.all(
        Object.entries(value).map(async ([key, value]) => [
          key,
          await resolveSavedValue(value, signal),
        ]),
      ),
    )
  );
}

/** Compose eagerly/transactionally, then expose dynamic builtin catalogs through closures. */
export function composeProviders(
  builtins: readonly Provider[],
  input: unknown,
): Provider[] {
  if (
    !object(input) ||
    (input.providers !== undefined && !object(input.providers))
  )
    throw new Error("models.json providers must be an object");
  const configs = input.providers ?? {};
  const ids = new Set([...builtins.map((p) => p.id), ...Object.keys(configs)]);
  return [...ids].map((id) => {
    let base = builtins.find((p) => p.id === id);
    const raw = configs[id];
    if (raw === undefined) {
      if (!base) throw new Error("Missing provider");
      return base;
    }
    if (!object(raw)) throw new Error(`Invalid provider ${id}`);
    for (const key of ["name", "baseUrl", "api", "apiKey"])
      if (raw[key] !== undefined && typeof raw[key] !== "string")
        throw new Error(`Provider ${id}: invalid ${key}`);
    if (raw.oauth !== undefined) {
      if (
        raw.oauth !== "radius" ||
        typeof raw.baseUrl !== "string" ||
        !raw.baseUrl
      )
        throw new Error(
          `Provider ${id}: oauth must be radius and requires baseUrl`,
        );
      base = radiusProvider({
        id,
        name: raw.name as string | undefined,
        gateway: raw.baseUrl.replace(/\/v1\/?$/u, ""),
      });
    }
    if (raw.authHeader !== undefined && typeof raw.authHeader !== "boolean")
      throw new Error("Invalid authHeader");
    if (raw.compat !== undefined && !object(raw.compat))
      throw new Error("Invalid provider compat");
    if (object(raw.compat)) validateCompat(raw.compat);
    validateHeaders(raw.headers);
    const providerHeaders = raw.headers;
    if (raw.models !== undefined && !Array.isArray(raw.models))
      throw new Error("models must be an array");
    if (raw.modelOverrides !== undefined && !object(raw.modelOverrides))
      throw new Error("modelOverrides must be an object");
    const definitions = raw.models ?? [];
    const overrides = raw.modelOverrides ?? {};
    for (const definition of definitions) validateModel(definition, true);
    for (const override of Object.values(overrides)) validateModel(override);
    if (
      !definitions.length &&
      !raw.baseUrl &&
      !raw.headers &&
      !raw.compat &&
      !Object.keys(overrides).length &&
      !raw.apiKey &&
      raw.authHeader === undefined
    )
      throw new Error(`Provider ${id}: no configuration specified`);
    const getModels = (): Model<Api>[] => {
      const models = (base?.getModels() ?? []).map((model) =>
        mergeModel(model, {
          ...(raw.baseUrl && raw.oauth !== "radius"
            ? { baseUrl: raw.baseUrl }
            : {}),
          ...(raw.compat ? { compat: raw.compat } : {}),
        }),
      );
      for (const definition of definitions) {
        validateModel(definition, true);
        const defaults =
          models.find((m) => m.id === definition.id) ??
          models.find((m) => m.api === (definition.api ?? raw.api)) ??
          models.find((m) => m.api === "openai-completions") ??
          models[0];
        const api = definition.api ?? raw.api ?? defaults?.api;
        const baseUrl = definition.baseUrl ?? raw.baseUrl ?? defaults?.baseUrl;
        if (typeof api !== "string" || !apiFactories.has(api))
          throw new Error(`Provider ${id}: unknown or missing api`);
        if (typeof baseUrl !== "string" || !baseUrl)
          throw new Error(`Provider ${id}: baseUrl is required`);
        const model = mergeModel(
          {
            id: definition.id,
            provider: id,
            api: api as Api,
            baseUrl,
            name: definition.id,
            reasoning: false,
            input: ["text"],
            contextWindow: 128000,
            maxTokens: 16384,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
            compat: raw.compat,
          } as Model<Api>,
          definition,
        );
        const index = models.findIndex((m) => m.id === model.id);
        if (index >= 0) models[index] = model;
        else models.push(model);
      }
      return models.map((model) => {
        const resolved = mergeModel(model, overrides[model.id]);
        const definition = definitions.find(
          (d) => object(d) && d.id === model.id,
        );
        if (object(definition) && object(definition.headers))
          resolved.headers = {
            ...resolved.headers,
            ...definition.headers,
          } as Record<string, string>;
        return resolved;
      });
    };
    getModels(); // Validation must happen before any runtime provider is replaced.
    const inherited = base?.auth.apiKey;
    const rawKey = raw.apiKey as string | undefined;
    const auth: ProviderAuth = {
      ...base?.auth,
      apiKey: {
        ...inherited,
        name: inherited?.name ?? "API key",
        login:
          inherited?.login ??
          (async (interaction) => ({
            type: "api_key",
            key: await interaction.prompt({
              type: "secret",
              message: "Enter API key",
            }),
          })),
        check: async (input) => {
          if (input.credential)
            return inherited?.check
              ? inherited.check(input)
              : input.credential.key
                ? { type: "api_key", source: "stored credential" }
                : undefined;
          if (rawKey !== undefined)
            return { type: "api_key", source: "configured API key" };
          return inherited?.check?.(input);
        },
        resolve: async (input) => {
          const credential =
            input.credential ??
            (rawKey !== undefined
              ? {
                  type: "api_key" as const,
                  key: await resolveSavedValue(rawKey, input.signal),
                }
              : undefined);
          const result = inherited
            ? await inherited.resolve({ ...input, credential })
            : credential?.key
              ? {
                  auth: { apiKey: credential.key },
                  source: "configured API key",
                }
              : undefined;
          if (!result) return undefined;
          return {
            ...result,
            auth: {
              ...result.auth,
              headers: {
                ...result.auth.headers,
                ...(await headers(providerHeaders, input.signal)),
                ...(raw.authHeader
                  ? { Authorization: `Bearer ${result.auth.apiKey}` }
                  : {}),
              },
            },
          };
        },
      },
      ...(base?.auth.oauth
        ? {
            oauth: {
              ...base.auth.oauth,
              toAuth: async (credential) => {
                const result = await base.auth.oauth?.toAuth(credential);
                return {
                  ...result,
                  headers: {
                    ...result?.headers,
                    ...(await headers(providerHeaders)),
                    ...(raw.authHeader
                      ? { Authorization: `Bearer ${result?.apiKey}` }
                      : {}),
                  },
                };
              },
            },
          }
        : {}),
    };
    if (!inherited && rawKey === undefined && base?.auth.oauth)
      delete auth.apiKey;
    const apis = new Map<string, ProviderStreams>();
    const dispatch = (model: Model<Api>): ProviderStreams => {
      const factory = apiFactories.get(model.api);
      if (!factory) throw new Error(`Unknown API ${model.api}`);
      let api = apis.get(model.api);
      if (!api) {
        api = factory();
        apis.set(model.api, api);
      }
      return api;
    };
    const custom = createProvider({
      id,
      name: raw.name as string | undefined,
      baseUrl: raw.baseUrl as string | undefined,
      auth,
      models: [],
      api: {
        stream: (m, c, o) => dispatch(m).stream(m, c, o),
        streamSimple: (m, c, o) => dispatch(m).streamSimple(m, c, o),
      },
    });
    return {
      ...custom,
      ...base,
      id,
      name: (raw.name as string | undefined) ?? base?.name ?? id,
      baseUrl: (raw.baseUrl as string | undefined) ?? base?.baseUrl,
      auth,
      getModels,
      stream: (m, c, o) =>
        lazyStream(m, async () => {
          const resolved = {
            ...o,
            headers: {
              ...o?.headers,
              ...(await headers(
                m.headers as Record<string, string> | undefined,
                o?.signal,
              )),
            },
          } as typeof o;
          return base?.getModels().some((b) => b.api === m.api)
            ? base.stream(m, c, resolved)
            : dispatch(m).stream(m, c, resolved);
        }),
      streamSimple: (m, c, o) =>
        lazyStream(m, async () => {
          const resolved = {
            ...o,
            headers: {
              ...o?.headers,
              ...(await headers(
                m.headers as Record<string, string> | undefined,
                o?.signal,
              )),
            },
          };
          return base?.getModels().some((b) => b.api === m.api)
            ? base.streamSimple(m, c, resolved)
            : dispatch(m).streamSimple(m, c, resolved);
        }),
      getAllModels: () => [
        ...getModels(),
        ...(base
          ?.getAllModels?.()
          .filter((m) => m.type === "image" || m.type === "classifier")
          .map((model) =>
            mergeModel(
              mergeModel(model, {
                ...(raw.baseUrl && raw.oauth !== "radius"
                  ? { baseUrl: raw.baseUrl }
                  : {}),
                ...(raw.compat ? { compat: raw.compat } : {}),
              }),
              overrides[model.id],
            ),
          ) ?? []),
      ],
    };
  });
}
