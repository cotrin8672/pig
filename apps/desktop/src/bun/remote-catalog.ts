import {
  type AnyModel,
  getModelType,
  isModelType,
  type ModelsStoreEntry,
  type Provider,
  type RefreshModelsContext,
} from "@earendil-works/pi-ai";

const DEFAULT_CATALOG_BASE_URL = "https://pi.dev";
export const REMOTE_CATALOG_REFRESH_INTERVAL_MS = 4 * 60 * 60 * 1000;
export const REMOTE_CATALOG_MODEL_TYPES = ["chat", "image", "classifier"];
const RETRYABLE_STATUS_CODES = new Set([408, 425, 429, 500, 502, 503, 504]);

/** Three immediate attempts, each bounded to 4s; caller cancellation is terminal. */
async function requestCatalog(
  providerId: string,
  baseUrl: string,
  parent: AbortSignal,
  validator?: string,
): Promise<Response> {
  const url = new URL(
    `/api/models/providers/${encodeURIComponent(providerId)}`,
    baseUrl,
  );
  url.searchParams.set("types", REMOTE_CATALOG_MODEL_TYPES.join(","));
  for (let attempt = 0; ; attempt++) {
    parent.throwIfAborted();
    const timeout = AbortSignal.timeout(4_000);
    try {
      const response = await fetch(url, {
        headers: {
          accept: "application/json",
          "User-Agent": "pig/1.0",
          ...(validator ? { "if-none-match": validator } : {}),
        },
        signal: AbortSignal.any([parent, timeout]),
      });
      if (!RETRYABLE_STATUS_CODES.has(response.status) || attempt >= 2)
        return response;
      try {
        await response.body?.cancel();
      } catch {
        /* Discarded retry response. */
      }
    } catch (error) {
      if (
        parent.aborted ||
        (error instanceof Error &&
          error.name === "AbortError" &&
          !timeout.aborted) ||
        attempt >= 2
      )
        throw error;
    }
  }
}
function mergeModels(
  baseline: readonly AnyModel[],
  dynamic: readonly AnyModel[],
): AnyModel[] {
  return [
    ...new Map(
      [...baseline, ...dynamic].map((model) => [
        `${getModelType(model)}\0${model.id}`,
        model,
      ]),
    ).values(),
  ];
}
function parseCatalog(provider: string, value: unknown): AnyModel[] {
  const entries = Array.isArray(value)
    ? value
    : typeof value === "object" && value !== null
      ? "models" in value && Array.isArray(value.models)
        ? value.models
        : Object.values(value)
      : undefined;
  if (!entries)
    throw new Error(`Invalid model catalog for provider "${provider}"`);
  return entries
    .filter(
      (entry): entry is Record<string, unknown> =>
        typeof entry === "object" && entry !== null && "id" in entry,
    )
    .filter(
      (model) =>
        model.type === undefined ||
        (typeof model.type === "string" &&
          REMOTE_CATALOG_MODEL_TYPES.includes(model.type)),
    )
    .map((model) => ({ ...model, provider }) as unknown as AnyModel);
}
async function readCatalog(providerId: string, response: Response) {
  const lastModified = Date.parse(response.headers.get("last-modified") ?? "");
  return {
    models: parseCatalog(providerId, await response.json()),
    lastModified: Number.isNaN(lastModified) ? 0 : lastModified,
    etag: response.headers.get("etag") ?? undefined,
  };
}
function isNewer(lastModified: number | undefined, localGeneratedAt?: number) {
  return (
    localGeneratedAt === undefined ||
    (lastModified !== undefined && lastModified > localGeneratedAt)
  );
}
function remoteModels(
  entry: Readonly<ModelsStoreEntry> | undefined,
  localGeneratedAt?: number,
): readonly AnyModel[] {
  return entry && isNewer(entry.lastModified, localGeneratedAt)
    ? entry.models
    : [];
}
/** Persisted remote overlay, applied before models.json composition. */
export function withRemoteCatalog(
  provider: Provider,
  catalogBaseUrl = DEFAULT_CATALOG_BASE_URL,
  localGeneratedAt?: number,
): Provider {
  let dynamicModels: readonly AnyModel[] = [];
  return {
    ...provider,
    getModels: () =>
      mergeModels(
        provider.getModels(),
        dynamicModels.filter((model) => isModelType(model, "chat")),
      ).filter((model) => isModelType(model, "chat")),
    getAllModels: () =>
      mergeModels(
        provider.getAllModels?.() ?? provider.getModels(),
        dynamicModels,
      ),
    refreshModels: async (context) => {
      const stored = context.stored;
      const restored = remoteModels(stored, localGeneratedAt).filter(
        (model) => model.provider === provider.id,
      );
      if (
        !(await context.publish({
          update: () => {
            dynamicModels = restored;
          },
        }))
      )
        return;
      if (!context.allowNetwork || context.signal.aborted) return;
      if (
        !context.force &&
        stored?.checkedAt !== undefined &&
        stored.lastModified !== undefined &&
        Date.now() - stored.checkedAt < REMOTE_CATALOG_REFRESH_INTERVAL_MS
      )
        return;
      const validator =
        stored && stored.models.length > 0 ? stored.etag : undefined;
      const response = await requestCatalog(
        provider.id,
        catalogBaseUrl,
        context.signal,
        validator,
      );
      if (context.signal.aborted) return;
      const checkedAt = Date.now();
      if (response.status === 304 && stored) {
        await context.publish({ persist: { ...stored, checkedAt } });
        return;
      }
      if (response.status === 404 || response.status === 501) {
        await context.publish({
          persist: {
            ...(stored ?? { models: [] }),
            checkedAt,
            lastModified: 0,
            etag: undefined,
          },
        });
        return;
      }
      if (!response.ok) {
        await context.publish({
          persist: { ...(stored ?? { models: [] }), checkedAt },
        });
        throw new Error(
          `Model catalog request failed for ${provider.id}: ${response.status}`,
        );
      }
      const catalog = await readCatalog(provider.id, response);
      if (context.signal.aborted) return;
      const entry = { ...catalog, checkedAt };
      const published = remoteModels(entry, localGeneratedAt);
      await context.publish({
        persist: entry,
        update: () => {
          dynamicModels = published;
        },
      });
    },
  };
}
/** Personalized lists replace, rather than overlay, the baseline (also offline). */
export function withPersonalizedCatalog(
  provider: Provider,
  personalize: (
    models: readonly AnyModel[],
    context: RefreshModelsContext,
  ) => Promise<readonly AnyModel[]>,
  catalogBaseUrl = DEFAULT_CATALOG_BASE_URL,
  localGeneratedAt?: number,
): Provider {
  let personalModels: readonly AnyModel[] = [];
  const builtinModels = () => provider.getAllModels?.() ?? provider.getModels();
  const getAllModels = () =>
    personalModels.length > 0 ? personalModels : builtinModels();
  return {
    ...provider,
    getModels: () =>
      getAllModels().filter((model) => isModelType(model, "chat")),
    getAllModels,
    refreshModels: async (context) => {
      const restored = (context.stored?.models ?? []).filter(
        (model) => model.provider === provider.id,
      );
      if (
        !(await context.publish({
          update: () => {
            personalModels = restored;
          },
        }))
      )
        return;
      if (!context.allowNetwork || context.signal.aborted) return;
      const response = await requestCatalog(
        provider.id,
        catalogBaseUrl,
        context.signal,
      );
      if (context.signal.aborted) return;
      let remote: readonly AnyModel[] = [];
      if (response.status !== 404 && response.status !== 501) {
        if (!response.ok)
          throw new Error(
            `Model catalog request failed for ${provider.id}: ${response.status}`,
          );
        const catalog = await readCatalog(provider.id, response);
        if (isNewer(catalog.lastModified, localGeneratedAt))
          remote = catalog.models;
      }
      const personalized = await personalize(
        mergeModels(builtinModels(), remote),
        context,
      );
      if (context.signal.aborted) return;
      await context.publish({
        persist: { models: personalized, checkedAt: Date.now() },
        update: () => {
          personalModels = personalized;
        },
      });
    },
  };
}
