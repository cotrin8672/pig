import { afterEach, expect, mock, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type AnyModel,
  createModels,
  fauxProvider,
  type RefreshModelsContext,
} from "@earendil-works/pi-ai";
import { composeProviders } from "./model-composition";
import { FileModelsStore } from "./models-store";
import {
  REMOTE_CATALOG_REFRESH_INTERVAL_MS,
  withPersonalizedCatalog,
  withRemoteCatalog,
} from "./remote-catalog";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});
function setup() {
  const base = fauxProvider().provider;
  const chat = base.getModels()[0];
  const image = {
    ...chat,
    type: "image",
    api: "openai-images",
    name: "Remote image",
  } as unknown as AnyModel;
  return { base, chat, image };
}
function respond(value: unknown, status = 200) {
  const fetch = mock(
    async () =>
      new Response(status === 304 ? null : JSON.stringify(value), {
        status,
        headers: {
          etag: '"catalog-v1"',
          "last-modified": "Wed, 01 Jul 2026 00:00:00 GMT",
        },
      }),
  );
  globalThis.fetch = fetch as unknown as typeof globalThis.fetch;
  return fetch;
}
test("remote merge is type-aware, persists ETag and Last-Modified, restores offline and revalidates 304", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pig-remote-"));
  try {
    const { base, chat, image } = setup();
    const store = new FileModelsStore(directory);
    const runtime = createModels({ modelsStore: store });
    runtime.setProvider(withRemoteCatalog(base));
    const fetch = respond({
      models: [
        { ...chat, name: "Updated" },
        image,
        { id: "unknown", type: "audio" },
      ],
    });
    expect((await runtime.refresh({ allowNetwork: true })).errors.size).toBe(0);
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0] as unknown as [URL, RequestInit];
    expect(url.searchParams.get("types")).toBe("chat,image,classifier");
    expect(new Headers(init.headers).get("User-Agent")).toStartWith("pig/");
    expect(runtime.getModel(base.id, chat.id)?.name).toBe("Updated");
    expect(await runtime.getAvailableOfType("image")).toHaveLength(1);
    const saved = await store.read(base.id);
    expect(saved?.etag).toBe('"catalog-v1"');
    expect(saved?.lastModified).toBe(Date.parse("2026-07-01"));
    const restored = createModels({
      modelsStore: new FileModelsStore(directory),
    });
    restored.setProvider(withRemoteCatalog(base));
    await restored.refresh({ allowNetwork: false });
    expect(restored.getModelsOfType("image")).toHaveLength(1);
    await restored.refresh({ allowNetwork: true });
    expect(fetch).toHaveBeenCalledTimes(1);
    const revalidate = respond(null, 304);
    await restored.refresh({ allowNetwork: true, force: true });
    const [, request] = revalidate.mock.calls[0] as unknown as [
      URL,
      RequestInit,
    ];
    expect(new Headers(request.headers).get("if-none-match")).toBe(
      saved?.etag ?? "",
    );
    expect(restored.getModelsOfType("image")).toHaveLength(1);
    expect((await store.read(base.id))?.checkedAt).toBeGreaterThanOrEqual(
      saved?.checkedAt ?? 0,
    );
    expect(REMOTE_CATALOG_REFRESH_INTERVAL_MS).toBe(14_400_000);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
test("remote catalogs older than builtins are saved but do not overlay them", async () => {
  const { base, image } = setup();
  const runtime = createModels();
  runtime.setProvider(
    withRemoteCatalog(base, undefined, Date.parse("2027-01-01")),
  );
  respond([image]);
  await runtime.refresh({ allowNetwork: true });
  expect(runtime.getModelsOfType("image")).toHaveLength(0);
});
test("models.json composition remains above remote catalogs for every model type", async () => {
  const { base, image } = setup();
  const runtime = createModels();
  const [provider] = composeProviders([withRemoteCatalog(base)], {
    providers: {
      [base.id]: {
        baseUrl: "https://example.test/v1",
        modelOverrides: { [image.id]: { name: "Configured" } },
      },
    },
  });
  runtime.setProvider(provider);
  respond([image]);
  await runtime.refresh({ allowNetwork: true });
  expect(runtime.getModelsOfType("image")[0]?.name).toBe("Configured");
  expect(runtime.getModelsOfType("image")[0]?.baseUrl).toBe(
    "https://example.test/v1",
  );
});
test("personalized catalogs replace and restore lists; empty stored lists fall back to builtins", async () => {
  const { base, image } = setup();
  const personalize = mock(async () => [image]);
  const provider = withPersonalizedCatalog(base, personalize);
  let stored: RefreshModelsContext["stored"];
  const refresh = async (allowNetwork: boolean) =>
    provider.refreshModels?.({
      allowNetwork,
      signal: new AbortController().signal,
      stored,
      publish: async (publication) => {
        if (publication.persist) stored = publication.persist;
        publication.update?.();
        return true;
      },
    });
  respond([image]);
  await refresh(true);
  expect(provider.getModels()).toHaveLength(0);
  expect(provider.getAllModels?.()).toEqual([image]);
  expect(stored?.models).toEqual([image]);
  await refresh(false);
  expect(personalize).toHaveBeenCalledTimes(1);
  stored = { models: [] };
  await refresh(false);
  expect(provider.getModels()).toEqual(base.getModels());
});
test("retryable status gets two immediate retries, 404 is cached, abort is terminal", async () => {
  const { base } = setup();
  const runtime = createModels();
  runtime.setProvider(withRemoteCatalog(base));
  const fetch = respond({}, 503);
  expect((await runtime.refresh({ allowNetwork: true })).errors.size).toBe(1);
  expect(fetch).toHaveBeenCalledTimes(3);
  const missing = respond({}, 404);
  await runtime.refresh({ allowNetwork: true, force: true });
  expect(missing).toHaveBeenCalledTimes(1);
  const controller = new AbortController();
  controller.abort();
  await runtime.refresh({
    allowNetwork: true,
    force: true,
    signal: controller.signal,
  });
  expect(missing).toHaveBeenCalledTimes(1);
});
