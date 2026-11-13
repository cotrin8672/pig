import { expect, test } from "bun:test";
import type { HttpUsageAdapter } from "./adapters";
import { authenticatedUsageRead } from "./authenticated";
import { UsageError } from "./contracts";

const data = {
  windows: [],
  balances: [{ label: "Balance", amount: "0", currency: "USD" }],
};
const signal = () => new AbortController().signal;
const http = { get: async () => ({}) };
test("a 401 refreshes through the credential owner and replays at most once", async () => {
  let revision = "a",
    requests = 0;
  const refreshes: boolean[] = [];
  const adapter: HttpUsageAdapter = {
    provider: "p",
    origins: [],
    read: async () => {
      requests++;
      throw new UsageError("auth");
    },
  };
  const read = authenticatedUsageRead(
    adapter,
    http,
    {
      current: () => true,
      revision: async () => revision,
      resolve: async (force) => {
        refreshes.push(force);
        if (force) revision = "b";
        return { revision, auth: { token: "secret", kind: "oauth" } };
      },
    },
    "a",
  );
  await expect(read(signal())).rejects.toThrow(UsageError);
  expect(requests).toBe(2);
  expect(refreshes).toEqual([false, true]);
});
test("replacement during a request discards its result without refreshing the replacement", async () => {
  let revision = "a",
    resolutions = 0;
  const adapter: HttpUsageAdapter = {
    provider: "p",
    origins: [],
    read: async () => {
      revision = "other-user";
      return data;
    },
  };
  const read = authenticatedUsageRead(
    adapter,
    http,
    {
      current: () => true,
      revision: async () => revision,
      resolve: async () => {
        resolutions++;
        return { revision, auth: { token: "secret", kind: "oauth" } };
      },
    },
    "a",
  );
  await expect(read(signal())).rejects.toThrow(UsageError);
  expect(resolutions).toBe(1);
});
test("a removed source cannot resolve auth or start a request", async () => {
  let resolutions = 0;
  const adapter: HttpUsageAdapter = {
    provider: "p",
    origins: [],
    read: async () => data,
  };
  const read = authenticatedUsageRead(
    adapter,
    http,
    {
      current: () => false,
      revision: async () => "a",
      resolve: async () => {
        resolutions++;
        return { revision: "a", auth: { token: "secret", kind: "api-key" } };
      },
    },
    "a",
  );
  await expect(read(signal())).rejects.toThrow(UsageError);
  expect(resolutions).toBe(0);
});
test("SDK-owned refresh during auth resolution is accepted; permission failures do not refresh", async () => {
  let revision = "a",
    requests = 0;
  const modes: boolean[] = [];
  const adapter: HttpUsageAdapter = {
    provider: "p",
    origins: [],
    read: async () => {
      requests++;
      throw new UsageError("permission");
    },
  };
  const read = authenticatedUsageRead(
    adapter,
    http,
    {
      current: () => true,
      revision: async () => revision,
      resolve: async (force) => {
        modes.push(force);
        revision = "fresh";
        return { revision, auth: { token: "secret", kind: "oauth" } };
      },
    },
    "a",
  );
  await expect(read(signal())).rejects.toThrow(UsageError);
  expect(requests).toBe(1);
  expect(modes).toEqual([false]);
});
