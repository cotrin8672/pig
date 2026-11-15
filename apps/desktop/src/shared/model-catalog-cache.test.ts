import { expect, test } from "bun:test";
import { createModelCatalogCache } from "./model-catalog-cache";
import type { ModelInfo } from "./rpc-schema";

function catalog(): ModelInfo[] {
  return [
    {
      provider: "fixture",
      id: "model",
      name: "Model",
      contextWindow: 1000,
      effortLevels: ["off", "high"],
      thinkingLevels: ["off", "high"],
      effectiveDefaultEffort: "high",
    },
  ];
}

test("equal display catalogs share owned immutable arrays, including their model metadata", () => {
  const share = createModelCatalogCache();
  const source = catalog();
  const first = share(source);
  const second = share(structuredClone(source));
  expect(first).toBe(second);
  expect(first).not.toBe(source);
  expect(first[0]).not.toBe(source[0]);
  expect(share(first)).toBe(first);
  source[0].name = "changed producer";
  source[0].effortLevels?.push("max");
  expect(first[0].name).toBe("Model");
  expect(first[0].effortLevels).toEqual(["off", "high"]);
  expect(Object.isFrozen(first)).toBe(true);
  expect(Object.isFrozen(first[0])).toBe(true);
  expect(Object.isFrozen(first[0].effortLevels)).toBe(true);
});

test("account/project-specific models, limits, effort and ordering are never merged", () => {
  const share = createModelCatalogCache();
  const first = share(catalog());
  for (const patch of [
    { provider: "other" },
    { id: "other" },
    { name: "Project model" },
    { contextWindow: 2000 },
    { effortLevels: ["off"] as ModelInfo["effortLevels"] },
    { effectiveDefaultEffort: "off" as const },
  ])
    expect(share([{ ...catalog()[0], ...patch }])).not.toBe(first);
  const models = [...catalog(), { ...catalog()[0], id: "second" }];
  expect(share(models)).not.toBe(share([...models].reverse()));
  expect(first).toEqual(catalog());
});

test("cache entries do not retain released catalogs", async () => {
  const share = createModelCatalogCache();
  const reference = (() => new WeakRef(share(catalog())))();
  let collected = false;
  for (let attempt = 0; attempt < 10; attempt++) {
    await Bun.sleep(0);
    Bun.gc(true);
    if (!reference.deref()) {
      collected = true;
      break;
    }
  }
  expect(collected).toBe(true);
  expect(share(catalog())).toEqual(catalog());
});

test("a hash collision cannot substitute a different catalog", () => {
  const share = createModelCatalogCache();
  // These complete catalog JSON strings have the same FNV-1a hash.
  const first = [{ provider: "fixture", id: "model", name: "1xvzfed" }];
  const second = [{ provider: "fixture", id: "model", name: "xi1y5p" }];
  const one = share(first);
  const two = share(second);
  expect(two).not.toBe(one);
  expect(one).toEqual(first);
  expect(two).toEqual(second);
});
