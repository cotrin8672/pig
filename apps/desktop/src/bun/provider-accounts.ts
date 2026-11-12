import { readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  AuthOperationOptions,
  Credential,
  CredentialStore,
  OAuthCredential,
} from "@earendil-works/pi-ai";
import {
  type ProviderAccount,
  type SessionAccounts,
  validateAccountId,
  validateProviderId,
  validateSessionAccounts,
} from "../shared/provider-accounts";
import { desktopConfigDir } from "./desktop-config";
import { withFileLock } from "./file-lock";

/** Locked, atomic storage for pig-only accounts; never rewrites pi's auth.json. */
class AuthFile<T> {
  constructor(
    private readonly file: string,
    private readonly parse: (value: unknown) => T,
  ) {}
  async read(options?: AuthOperationOptions): Promise<T> {
    options?.signal?.throwIfAborted();
    let value: unknown = {};
    try {
      const text = await readFile(this.file, {
        encoding: "utf8",
        signal: options?.signal,
      });
      // Do not include JSON syntax errors: they may quote a token.
      try {
        value = JSON.parse(text.replace(/^\uFEFF/, ""));
      } catch {
        throw new Error("Invalid credential file JSON; original preserved.");
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    options?.signal?.throwIfAborted();
    return this.parse(value);
  }
  async use<R>(
    fn: (data: T) => Promise<{ result: R; save?: boolean }>,
    options?: AuthOperationOptions,
  ): Promise<R> {
    return withFileLock(this.file, options?.signal, async () => {
      const data = await this.read();
      const { result, save } = await fn(data);
      if (save) {
        const temporary = `${this.file}.${crypto.randomUUID()}.tmp`;
        try {
          // Once a refresh starts, persist even if its caller was cancelled.
          await writeFile(temporary, JSON.stringify(data), { mode: 0o600 });
          await rename(temporary, this.file);
        } finally {
          await rm(temporary, { force: true });
        }
      }
      return result;
    });
  }
}
function record(value: unknown): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid credential file; original preserved.");
}
function credential(value: unknown): asserts value is OAuthCredential {
  record(value);
  if (value.type === "oauth") {
    if (
      typeof value.access === "string" &&
      typeof value.refresh === "string" &&
      typeof value.expires === "number" &&
      Number.isFinite(value.expires)
    )
      return;
  }
  throw new Error("Invalid credential; original preserved.");
}
function label(value: unknown): string {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.trim().length > 80 ||
    /[\p{Cc}]/u.test(value)
  )
    throw new Error("Choose an account name of 1–80 characters.");
  return value.trim();
}

type StoredAccount = {
  provider: string;
  label: string;
  credential?: OAuthCredential;
};
function info(id: string, account: StoredAccount): ProviderAccount {
  return {
    id,
    provider: account.provider,
    label: account.label,
    configured: !!account.credential,
  };
}
/** Metadata and tokens commit together; no orphan tokens or stale refresh resurrection. */
export class ProviderAccountStore {
  private readonly file: AuthFile<Record<string, StoredAccount>>;
  private readonly names: AuthFile<Record<string, string>>;
  constructor(path: string) {
    this.names = new AuthFile(`${path}.names.json`, (value) => {
      record(value);
      for (const [provider, name] of Object.entries(value)) {
        validateProviderId(provider);
        label(name);
      }
      return value as Record<string, string>;
    });
    this.file = new AuthFile(path, (value) => {
      record(value);
      for (const [id, entry] of Object.entries(value)) {
        validateAccountId(id);
        record(entry);
        validateProviderId(entry.provider);
        label(entry.label);
        if (entry.credential !== undefined) credential(entry.credential);
      }
      return value as Record<string, StoredAccount>;
    });
  }
  private account(
    data: Record<string, StoredAccount>,
    id: string,
    provider: string,
  ) {
    validateAccountId(id);
    validateProviderId(provider);
    const account = Object.hasOwn(data, id) ? data[id] : undefined;
    if (!account || account.provider !== provider)
      throw new Error("Account not found for this provider.");
    return account;
  }
  async list(options?: AuthOperationOptions): Promise<ProviderAccount[]> {
    // Atomic replacement makes reads consistent without contending with a refresh.
    const data = await this.file.read(options);
    return Object.entries(data).map(([id, entry]) => info(id, entry));
  }
  async create(provider: string, name: string): Promise<ProviderAccount> {
    validateProviderId(provider);
    const account: StoredAccount = { provider, label: label(name) };
    const id = crypto.randomUUID();
    return this.file.use(async (data) => {
      data[id] = account;
      return { result: info(id, account), save: true };
    });
  }
  defaultNames() {
    return this.names.read();
  }
  async renameDefault(provider: string, name: string) {
    validateProviderId(provider);
    const next = label(name);
    await this.names.use(async (data) => {
      data[provider] = next;
      return { result: undefined, save: true };
    });
  }
  /** Publish a new account only after OAuth succeeded. Reserve 1 for standard pi auth. */
  add(
    provider: string,
    providerName: string,
    value: OAuthCredential,
    options?: AuthOperationOptions,
  ) {
    validateProviderId(provider);
    credential(value);
    const base = label(providerName);
    return this.file.use(async (data) => {
      options?.signal?.throwIfAborted();
      let n = 2;
      const used = Object.values(data).filter(
        (entry) => entry.provider === provider,
      );
      while (used.some((entry) => entry.label === `${base} ${n}`)) n++;
      const id = crypto.randomUUID();
      const account = {
        provider,
        label: label(`${base} ${n}`),
        credential: value,
      };
      data[id] = account;
      return { result: info(id, account), save: true };
    }, options);
  }
  rename(id: string, provider: string, name: string) {
    const next = label(name);
    return this.file.use(async (data) => {
      const account = this.account(data, id, provider);
      account.label = next;
      return { result: info(id, account), save: true };
    });
  }
  async read(id: string, provider: string, options?: AuthOperationOptions) {
    return this.account(await this.file.read(options), id, provider).credential;
  }
  modify(
    id: string,
    provider: string,
    fn: (current: Credential | undefined) => Promise<Credential | undefined>,
    options?: AuthOperationOptions,
  ) {
    return this.file.use(async (data) => {
      const account = this.account(data, id, provider);
      const next = await fn(account.credential);
      if (next !== undefined) {
        credential(next);
        account.credential = next;
      }
      return { result: account.credential, save: next !== undefined };
    }, options);
  }
  async logout(id: string, provider: string) {
    await this.file.use(async (data) => {
      delete this.account(data, id, provider).credential;
      return { result: undefined, save: true };
    });
  }
  async remove(id: string, provider: string) {
    await this.file.use(async (data) => {
      this.account(data, id, provider);
      delete data[id];
      return { result: undefined, save: true };
    });
  }
}

/** Each runtime owns its selection, while every runtime shares the locked files. */
export class AccountCredentials implements CredentialStore {
  private selected: SessionAccounts;
  constructor(
    private readonly defaults: CredentialStore,
    private readonly accounts: ProviderAccountStore,
    selected: SessionAccounts = {},
  ) {
    this.selected = validateSessionAccounts(selected);
  }
  selection(): SessionAccounts {
    return { ...this.selected };
  }
  select(provider: string, accountId: string | null) {
    validateProviderId(provider);
    if (accountId !== null) validateAccountId(accountId);
    const next = { ...this.selected };
    if (accountId === null) delete next[provider];
    else next[provider] = accountId;
    this.selected = next;
  }
  async read(provider: string, options?: AuthOperationOptions) {
    const id = this.selected[provider];
    if (!id) return this.defaults.read(provider, options);
    const stored = await this.accounts.read(id, provider, options);
    // Undefined would make pi-ai try ambient credentials for a different identity.
    if (!stored)
      throw new Error("Selected account is signed out. Sign in again.");
    return stored;
  }
  async list(options?: AuthOperationOptions) {
    options?.signal?.throwIfAborted();
    const selected = this.selection();
    if (!Object.keys(selected).length) return this.defaults.list(options);
    const entries = (await this.defaults.list(options)).filter(
      (entry) => !selected[entry.providerId],
    );
    const saved = await this.accounts.list(options);
    options?.signal?.throwIfAborted();
    for (const [providerId, id] of Object.entries(selected)) {
      if (
        saved.some(
          (entry) =>
            entry.id === id &&
            entry.provider === providerId &&
            entry.configured,
        )
      )
        entries.push({ providerId, type: "oauth" });
    }
    return entries;
  }
  modify(
    provider: string,
    fn: (current: Credential | undefined) => Promise<Credential | undefined>,
    options?: AuthOperationOptions,
  ) {
    // Capture before waiting for a lock; a later selection cannot redirect this write.
    const id = this.selected[provider];
    return id
      ? this.accounts.modify(id, provider, fn, options)
      : this.defaults.modify(provider, fn, options);
  }
  delete(provider: string, options?: AuthOperationOptions) {
    const id = this.selected[provider];
    options?.signal?.throwIfAborted();
    return id
      ? this.accounts.logout(id, provider)
      : this.defaults.delete(provider, options);
  }
}

export const providerAccounts = new ProviderAccountStore(
  join(desktopConfigDir, "provider-accounts.json"),
);
