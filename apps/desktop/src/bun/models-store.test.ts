import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createModels,
  createProvider,
  fauxProvider,
} from "@earendil-works/pi-ai";
import { FileModelsStore } from "./models-store";

test("app model catalogs persist across instances and restore during offline refresh", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pig-model-store-"));
  try {
    const store = new FileModelsStore(directory);
    const faux = fauxProvider();
    const model = { ...faux.provider.getModels()[0], provider: "catalog" };
    const entry = { models: [model], checkedAt: 123, etag: "test" };
    await store.write("catalog", entry);
    expect(await new FileModelsStore(directory).read("catalog")).toEqual(entry);
    const models = createModels({
      modelsStore: new FileModelsStore(directory),
    });
    models.setProvider(
      createProvider({
        id: "catalog",
        auth: faux.provider.auth,
        models: [],
        api: {
          stream: faux.provider.stream,
          streamSimple: faux.provider.streamSimple,
        },
        fetchModels: async () => {
          throw new Error("offline must not fetch");
        },
      }),
    );
    const result = await models.refresh({ allowNetwork: false });
    expect(result.errors.size).toBe(0);
    expect(models.getModels("catalog")).toHaveLength(1);
    await store.delete("catalog");
    expect(await store.read("catalog")).toBeUndefined();
    const signal = AbortSignal.abort();
    await expect(store.write("cancelled", entry, { signal })).rejects.toThrow();
    expect(await store.read("cancelled")).toBeUndefined();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("corrupt catalogs surface refresh errors without rejecting startup refresh", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pig-model-errors-"));
  try {
    const faux = fauxProvider();
    await writeFile(join(directory, "catalog.json"), "{broken");
    const models = createModels({
      modelsStore: new FileModelsStore(directory),
    });
    models.setProvider(
      createProvider({
        id: "catalog",
        auth: faux.provider.auth,
        models: [],
        api: {
          stream: faux.provider.stream,
          streamSimple: faux.provider.streamSimple,
        },
        fetchModels: async () => [],
      }),
    );
    expect(
      (await models.refresh({ allowNetwork: false })).errors.has("catalog"),
    ).toBe(true);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
