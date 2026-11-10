import { expect, test } from "bun:test";
import { manualModelRefresh } from "./manual-model-refresh";

test("manual refresh forces network for only the selected provider on all runtimes", async () => {
  const calls: unknown[] = [];
  await manualModelRefresh("anthropic", {
    online: true,
    hasProvider: (id) => id === "anthropic",
    refresh: async (options) => {
      calls.push(options);
      return [{ errors: new Map() }, { errors: new Map() }];
    },
  });
  expect(calls).toEqual([
    { providers: ["anthropic"], allowNetwork: true, force: true },
  ]);
});
test("invalid or offline refresh is rejected without network; runtime errors surface", async () => {
  let calls = 0;
  const refresh = async () => {
    calls++;
    return [{ errors: new Map([["anthropic", new Error("unavailable")]]) }];
  };
  await expect(
    manualModelRefresh("unknown", {
      online: true,
      hasProvider: () => false,
      refresh,
    }),
  ).rejects.toThrow("Invalid provider");
  await expect(
    manualModelRefresh("anthropic", {
      online: false,
      hasProvider: () => true,
      refresh,
    }),
  ).rejects.toThrow("offline");
  expect(calls).toBe(0);
  await expect(
    manualModelRefresh("anthropic", {
      online: true,
      hasProvider: () => true,
      refresh,
    }),
  ).rejects.toThrow("unavailable");
  expect(calls).toBe(1);
});
