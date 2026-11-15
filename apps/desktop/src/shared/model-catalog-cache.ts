import type { ModelInfo } from "./rpc-schema";

/** Share equal display catalogs, never SDK runtimes or account credentials.
 * Weak entries cannot keep closed chats' catalogs alive. */
export function createModelCatalogCache() {
  const entries = new Map<number, WeakRef<ModelInfo[]>>();
  const owned = new WeakSet<ModelInfo[]>();
  return (catalog: ModelInfo[]): ModelInfo[] => {
    if (owned.has(catalog)) return catalog;
    const serialized = JSON.stringify(catalog);
    let hash = 2166136261;
    for (let index = 0; index < serialized.length; index++)
      hash = Math.imul(hash ^ serialized.charCodeAt(index), 16777619);
    const existing = entries.get(hash)?.deref();
    // The hash only selects a candidate; collisions never share different data.
    if (existing && JSON.stringify(existing) === serialized) return existing;
    for (const [key, reference] of entries)
      if (!reference.deref()) entries.delete(key);
    if (entries.size >= 64) {
      const oldest = entries.keys().next().value;
      if (oldest !== undefined) entries.delete(oldest);
    }
    const value = structuredClone(catalog);
    for (const model of value) {
      if (model.effortLevels) Object.freeze(model.effortLevels);
      if (model.thinkingLevels) Object.freeze(model.thinkingLevels);
      Object.freeze(model);
    }
    Object.freeze(value);
    owned.add(value);
    entries.set(hash, new WeakRef(value));
    return value;
  };
}
