import { afterEach, expect, test } from "bun:test";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createModels,
  fauxProvider,
  InMemoryCredentialStore,
  type OAuthCredential,
} from "@earendil-works/pi-ai";
import { AccountCredentials, ProviderAccountStore } from "./provider-accounts";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});
async function fixture() {
  const home = await mkdtemp(join(tmpdir(), "pig-accounts-"));
  directories.push(home);
  const file = join(home, "accounts.json");
  return { file, store: new ProviderAccountStore(file) };
}
const token = (
  access: string,
  expires = Date.now() + 3_600_000,
): OAuthCredential => ({
  type: "oauth",
  access,
  refresh: `refresh-${access}`,
  expires,
});

test("accounts have stable identities; metadata never contains tokens and logout keeps the label", async () => {
  const { file, store } = await fixture();
  const account = await store.create("anthropic", " Work ");
  await store.modify(account.id, account.provider, async () =>
    token("work-secret"),
  );
  const renamed = await store.rename(
    account.id,
    account.provider,
    "Claude Work",
  );
  expect(renamed).toEqual({
    ...account,
    label: "Claude Work",
    configured: true,
  });
  expect(JSON.stringify(await store.list())).not.toContain("work-secret");
  expect(await new ProviderAccountStore(file).list()).toEqual([renamed]);
  await store.logout(account.id, account.provider);
  expect(await store.list()).toEqual([{ ...renamed, configured: false }]);
  expect(await readFile(file, "utf8")).not.toContain("work-secret");
  await store.remove(account.id, account.provider);
  expect(await store.list()).toEqual([]);
});

test("per-runtime selections isolate private/work and keep the standard credentials untouched", async () => {
  const { store } = await fixture();
  const defaults = new InMemoryCredentialStore();
  await defaults.modify("anthropic", async () => token("default"));
  const work = await store.create("anthropic", "Work");
  const personal = await store.create("anthropic", "Private");
  await store.modify(work.id, "anthropic", async () => token("work"));
  await store.modify(personal.id, "anthropic", async () => token("private"));
  const a = new AccountCredentials(defaults, store, { anthropic: work.id });
  const b = new AccountCredentials(defaults, store, { anthropic: personal.id });
  expect(await a.read("anthropic")).toMatchObject({
    type: "oauth",
    access: "work",
  });
  await a.modify("anthropic", async () => token("work-rotated"));
  expect(((await b.read("anthropic")) as OAuthCredential).access).toBe(
    "private",
  );
  expect(((await defaults.read("anthropic")) as OAuthCredential).access).toBe(
    "default",
  );
  a.select("anthropic", null);
  expect(((await a.read("anthropic")) as OAuthCredential).access).toBe(
    "default",
  );
});

test("refresh captures its account before waiting, persists after cancellation and cannot overwrite another account", async () => {
  const { file, store } = await fixture();
  const defaults = new InMemoryCredentialStore();
  const a = await store.create("anthropic", "A");
  const b = await store.create("anthropic", "B");
  await store.modify(a.id, "anthropic", async () => token("old-a"));
  await store.modify(b.id, "anthropic", async () => token("old-b"));
  const credentials = new AccountCredentials(defaults, store, {
    anthropic: a.id,
  });
  const started = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const controller = new AbortController();
  const refresh = credentials.modify(
    "anthropic",
    async () => {
      started.resolve();
      await release.promise;
      return token("new-a");
    },
    { signal: controller.signal },
  );
  await started.promise;
  controller.abort();
  credentials.select("anthropic", b.id);
  release.resolve();
  await refresh;
  expect(
    (await new ProviderAccountStore(file).read(a.id, "anthropic"))?.access,
  ).toBe("new-a");
  expect(
    ((await credentials.read("anthropic")) as OAuthCredential).access,
  ).toBe("old-b");
});

test("concurrent SDK auth resolutions share a locked refresh; signed-out/deleted accounts never fall back to ambient auth", async () => {
  const { file, store } = await fixture();
  const account = await store.create("anthropic", "Work");
  await store.modify(account.id, "anthropic", async () => token("expired", 0));
  let refreshed = 0;
  let ambient = 0;
  const base = fauxProvider().provider;
  const provider = {
    ...base,
    id: "anthropic",
    auth: {
      apiKey: {
        name: "ambient",
        resolve: async () => {
          ambient++;
          return { auth: { apiKey: "wrong" } };
        },
      },
      oauth: {
        name: "Subscription",
        isSubscription: true,
        login: async () => token("login"),
        refresh: async () => {
          refreshed++;
          await Bun.sleep(20);
          return token("refreshed");
        },
        toAuth: async (current: OAuthCredential) => ({
          apiKey: current.access,
        }),
      },
    },
  };
  const defaults = new InMemoryCredentialStore();
  const models = [store, new ProviderAccountStore(file)].map((accounts) => {
    const models = createModels({
      credentials: new AccountCredentials(defaults, accounts, {
        anthropic: account.id,
      }),
    });
    models.setProvider(provider);
    return models;
  });
  const results = await Promise.all(
    models.map((models) => models.getAuth("anthropic")),
  );
  expect(results.map((result) => result?.auth.apiKey)).toEqual([
    "refreshed",
    "refreshed",
  ]);
  expect(refreshed).toBe(1);
  const [first, second] = models;
  if (!first || !second) throw new Error("Missing model collections");
  await store.logout(account.id, "anthropic");
  await expect(first.getAuth("anthropic")).rejects.toThrow();
  await store.remove(account.id, "anthropic");
  await expect(second.getAuth("anthropic")).rejects.toThrow();
  expect(ambient).toBe(0);
});

test("logout/delete wait for refresh; late refresh cannot resurrect a removed account", async () => {
  for (const remove of [false, true]) {
    const { store } = await fixture();
    const account = await store.create("openai-codex", "Work");
    await store.modify(account.id, account.provider, async () => token("old"));
    const started = Promise.withResolvers<void>(),
      release = Promise.withResolvers<void>();
    const refresh = store.modify(account.id, account.provider, async () => {
      started.resolve();
      await release.promise;
      return token("late");
    });
    await started.promise;
    const clearing = remove
      ? store.remove(account.id, account.provider)
      : store.logout(account.id, account.provider);
    release.resolve();
    await Promise.all([refresh, clearing]);
    if (remove) {
      await expect(
        store.modify(account.id, account.provider, async () =>
          token("resurrect"),
        ),
      ).rejects.toThrow("Account not found");
      expect(await store.list()).toEqual([]);
    } else
      expect(await store.read(account.id, account.provider)).toBeUndefined();
  }
});

test("invalid input and failed refresh leave credentials unchanged", async () => {
  const { file, store } = await fixture();
  const account = await store.create("anthropic", "Work");
  await store.modify(account.id, account.provider, async () => token("saved"));
  const original = await readFile(file, "utf8");
  await expect(store.create("anthropic", "\nBad")).rejects.toThrow();
  await expect(store.create("__proto__", "Bad")).rejects.toThrow();
  await expect(
    store.rename(account.id, "openai-codex", "Wrong provider"),
  ).rejects.toThrow();
  await expect(
    store.modify(account.id, account.provider, async () => ({
      type: "api_key",
      key: "no",
    })),
  ).rejects.toThrow();
  await expect(
    store.modify(account.id, account.provider, async () => {
      throw new Error("refresh failed");
    }),
  ).rejects.toThrow("refresh failed");
  const controller = new AbortController();
  controller.abort();
  await expect(
    store.modify(account.id, account.provider, async () => token("no"), {
      signal: controller.signal,
    }),
  ).rejects.toThrow();
  expect(await readFile(file, "utf8")).toBe(original);
  expect(await readdir(join(file, ".."))).toEqual(["accounts.json"]);
});

test("corrupt account files are preserved and JSON errors do not quote secrets", async () => {
  const { file, store } = await fixture();
  const broken = '{"sensitive-token-secret';
  await writeFile(file, broken);
  try {
    await store.list();
    throw new Error("expected rejection");
  } catch (error) {
    expect(String(error)).not.toContain("sensitive-token-secret");
  }
  await expect(store.create("anthropic", "Work")).rejects.toThrow(
    "original preserved",
  );
  expect(await readFile(file, "utf8")).toBe(broken);
});
