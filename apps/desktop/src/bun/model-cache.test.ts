import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fauxProvider } from "@earendil-works/pi-ai";
import { FileModelsStore } from "./models-store";

test("shared catalog cache avoids repeated disk loads, isolates callers, and follows writes and deletions", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pig-catalog-cache-"));
  try {
    const writer = new FileModelsStore(directory);
    const cache = new FileModelsStore(directory, true);
    const entry = {
      models: fauxProvider().provider.getModels(),
      checkedAt: 123,
    };
    await writer.write("p", entry);
    const first = await cache.read("p");
    if (!first) throw new Error("Missing cached catalog");
    const second = await cache.read("p");
    expect(second).not.toBe(first);
    expect(second?.models).not.toBe(first.models);
    await writer.delete("p");
    expect(await cache.read("p")).toEqual(entry);
    const next = { ...entry, checkedAt: 456 };
    await cache.write("p", next);
    expect(await cache.read("p")).toEqual(next);
    await cache.delete("p");
    expect(await cache.read("p")).toBeUndefined();
    await expect(
      cache.read("p", { signal: AbortSignal.abort() }),
    ).rejects.toThrow();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
