import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  ModelsStore,
  ModelsStoreEntry,
  ModelsStoreOperationOptions,
} from "@earendil-works/pi-ai";
import { withFileLock } from "./file-lock";

/** Each provider owns one catalog, independently atomically replaced. */
export class FileModelsStore implements ModelsStore {
  private cache = new Map<string, Promise<ModelsStoreEntry | undefined>>();
  constructor(
    private readonly directory: string,
    private readonly cached = false,
  ) {}
  private file(provider: string) {
    return join(this.directory, `${encodeURIComponent(provider)}.json`);
  }
  async read(
    provider: string,
    options?: ModelsStoreOperationOptions,
  ): Promise<ModelsStoreEntry | undefined> {
    options?.signal?.throwIfAborted();
    if (!this.cached) return this.readFile(provider, options);
    let entry = this.cache.get(provider);
    if (!entry) {
      entry = this.readFile(provider);
      this.cache.set(provider, entry);
      void entry.catch(() => {
        if (this.cache.get(provider) === entry) this.cache.delete(provider);
      });
    }
    const value = await entry;
    options?.signal?.throwIfAborted();
    return structuredClone(value);
  }
  private async readFile(
    provider: string,
    options?: ModelsStoreOperationOptions,
  ) {
    try {
      const value = JSON.parse(
        await readFile(this.file(provider), {
          encoding: "utf8",
          signal: options?.signal,
        }),
      );
      if (!value || !Array.isArray(value.models))
        throw new Error(`Invalid model catalog for ${provider}`);
      return value;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
  }
  async write(
    provider: string,
    entry: ModelsStoreEntry,
    options?: ModelsStoreOperationOptions,
  ) {
    await withFileLock(this.file(provider), options?.signal, async () => {
      await mkdir(this.directory, { recursive: true });
      const temporary = `${this.file(provider)}.${crypto.randomUUID()}.tmp`;
      try {
        await writeFile(temporary, JSON.stringify(entry), {
          mode: 0o600,
          signal: options?.signal,
        });
        options?.signal?.throwIfAborted();
        await rename(temporary, this.file(provider));
        this.cache.set(provider, Promise.resolve(structuredClone(entry)));
      } finally {
        await rm(temporary, { force: true });
      }
    });
  }
  async delete(provider: string, options?: ModelsStoreOperationOptions) {
    await withFileLock(this.file(provider), options?.signal, async () => {
      await rm(this.file(provider), { force: true });
      this.cache.set(provider, Promise.resolve(undefined));
    });
  }
}
