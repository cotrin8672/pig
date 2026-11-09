import { readFile, rename, rm, writeFile } from "node:fs/promises";
import type {
  AuthOperationOptions,
  Credential,
  CredentialStore,
} from "@earendil-works/pi-ai";
import { resolveSavedValue } from "./config-value";
import { withFileLock } from "./file-lock";

/** App-owned auth store; never opens or mutates the CLI's auth.json. */
export class FileCredentials implements CredentialStore {
  private queue = Promise.resolve();
  constructor(private readonly file: string) {}
  private async load(): Promise<Record<string, Credential>> {
    try {
      const value = JSON.parse(await readFile(this.file, "utf8"));
      if (!value || typeof value !== "object" || Array.isArray(value))
        throw new Error("Invalid credentials file");
      return value;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
      throw error;
    }
  }
  private async resolve(value: Credential | undefined, signal?: AbortSignal) {
    return value?.type === "api_key" && value.key !== undefined
      ? { ...value, key: await resolveSavedValue(value.key, signal) }
      : value;
  }
  async read(provider: string, options?: AuthOperationOptions) {
    await this.queue;
    options?.signal?.throwIfAborted();
    return this.resolve((await this.load())[provider], options?.signal);
  }
  async list(options?: AuthOperationOptions) {
    await this.queue;
    options?.signal?.throwIfAborted();
    return Object.entries(await this.load()).map(
      ([providerId, credential]) => ({ providerId, type: credential.type }),
    );
  }
  private change<T>(
    fn: (values: Record<string, Credential>) => Promise<T>,
    options?: AuthOperationOptions,
  ) {
    const run = this.queue.then(() =>
      withFileLock(this.file, options?.signal, async () => {
        options?.signal?.throwIfAborted();
        const values = await this.load();
        const result = await fn(values);
        options?.signal?.throwIfAborted();
        const temporary = `${this.file}.${crypto.randomUUID()}.tmp`;
        try {
          await writeFile(temporary, JSON.stringify(values, null, 2), {
            mode: 0o600,
          });
          // Windows may briefly deny replacing a file while another runtime's
          // availability check holds a read handle. Keep atomic replacement;
          // never unlink the credential store to work around sharing violations.
          for (let attempt = 0; ; attempt++) {
            options?.signal?.throwIfAborted();
            try {
              await rename(temporary, this.file);
              break;
            } catch (error) {
              if (
                process.platform !== "win32" ||
                attempt >= 8 ||
                !["EPERM", "EACCES", "EBUSY"].includes(
                  (error as NodeJS.ErrnoException).code ?? "",
                )
              )
                throw error;
              await Bun.sleep(10 * (attempt + 1));
            }
          }
        } finally {
          await rm(temporary, { force: true });
        }
        return result;
      }),
    );
    this.queue = run.then(
      () => {},
      () => {},
    );
    return run;
  }
  modify(
    provider: string,
    fn: (current: Credential | undefined) => Promise<Credential | undefined>,
    options?: AuthOperationOptions,
  ) {
    return this.change(async (values) => {
      const current = values[provider];
      options?.signal?.throwIfAborted();
      const next = await fn(current);
      if (next !== undefined) values[provider] = next;
      return next ?? current;
    }, options);
  }
  delete(provider: string, options?: AuthOperationOptions) {
    return this.change(async (values) => {
      delete values[provider];
    }, options);
  }
}
