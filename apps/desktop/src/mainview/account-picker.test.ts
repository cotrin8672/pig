import { expect, test } from "bun:test";
import {
  accountModelKey,
  accountSourceKey,
  providerAccountSources,
  selectionKey,
} from "../shared/account-models";
import type { Bootstrap, Snapshot } from "../shared/rpc-schema";
import { accountLocked, accountModelSources } from "./account-picker";

const provider = {
  id: "openai-codex",
  name: "OpenAI Codex",
  oauth: { subscription: true },
  configured: true,
  stored: true,
  apiKey: false,
  extension: false,
  accounts: [
    {
      id: "work",
      provider: "openai-codex",
      label: "Codex Work",
      configured: true,
    },
    {
      id: "signed-out",
      provider: "openai-codex",
      label: "Old account",
      configured: false,
    },
  ],
};
const one = { provider: provider.id, id: "one", name: "One" };
const two = { provider: provider.id, id: "two", name: "Two" };
const bootstrap: Bootstrap = {
  projects: [],
  generalCwd: "",
  providers: [provider],
  models: [one, two],
  imageModels: [],
  classificationModels: [],
  classificationProviders: [],
  modelOverrides: {},
  desktop: { sessions: {} },
  disabledModels: [],
  accountCatalogs: {
    [accountSourceKey(provider.id)]: [one],
    [accountSourceKey(provider.id, "work")]: [one, two],
    [accountSourceKey(provider.id, "signed-out")]: [],
  },
};

test("one canonical Provider exposes independent account choices and stable recent keys", () => {
  const sources = accountModelSources(bootstrap);
  expect(sources.map((source) => source.label)).toEqual([
    "OpenAI Codex 1",
    "Codex Work",
    "Old account",
  ]);
  expect(sources[0]?.models).toEqual([one]);
  expect(sources[1]?.models).toEqual([one, two]);
  expect(sources[2]?.configured).toBe(false);
  expect(sources[2]?.models).toEqual([]);
  expect(sources.every((source) => source.provider === provider.id)).toBe(true);
  expect(accountModelKey(one)).toBe("openai-codex/one");
  expect(accountModelKey(one, "work")).not.toBe(accountModelKey(one));
  expect(
    selectionKey({
      model: one,
      accountId: "work",
      effort: "off",
      effortLevels: [],
    }),
  ).toBe(accountModelKey(one, "work"));
  expect(
    providerAccountSources({ ...provider, accounts: undefined })[0]?.label,
  ).toBe("OpenAI Codex");
  expect(
    providerAccountSources({ ...provider, accountLabel: "Private" })[0]?.label,
  ).toBe("Private");
});

test("shared visibility filters every account, and a signed-out standard account does not hide working extras", () => {
  const sources = accountModelSources({
    ...bootstrap,
    providers: [{ ...provider, configured: false, stored: false }],
    disabledModels: ["openai-codex/one"],
  });
  expect(sources[0]?.configured).toBe(false);
  expect(sources[1]?.configured).toBe(true);
  expect(sources[1]?.models).toEqual([two]);
});

test("project-local auth can make a canonical Provider available without global credentials", () => {
  const local = {
    model: one,
    modelCatalog: [one],
    sessionAccounts: {},
  } as unknown as Snapshot;
  const sources = accountModelSources(
    { ...bootstrap, providers: [{ ...provider, configured: false }] },
    local,
  );
  expect(sources[0]?.configured).toBe(true);
  expect(sources[0]?.models).toEqual([one]);
});

test("missing per-account catalogs never fall back to another account; local session catalogs stay bound to the selected account", () => {
  const missing = accountModelSources({ ...bootstrap, accountCatalogs: {} });
  expect(missing[1]?.models).toEqual([]);
  const snapshot = {
    model: one,
    accountId: "work",
    sessionAccounts: { [provider.id]: "work" },
    modelCatalog: [two],
    accountSwitchAllowed: false,
  } as unknown as Snapshot;
  const sources = accountModelSources(bootstrap, snapshot);
  expect(sources[0]?.models).toEqual([one]);
  expect(sources[1]?.models).toEqual([two]);
  const [standard, work, signedOut] = sources;
  if (!standard || !work || !signedOut) throw new Error("Missing source");
  expect(accountLocked(standard, snapshot)).toBe(true);
  expect(accountLocked(work, snapshot)).toBe(false);
  expect(accountLocked(signedOut, snapshot)).toBe(true);
  expect(accountLocked(standard)).toBe(false);
});
