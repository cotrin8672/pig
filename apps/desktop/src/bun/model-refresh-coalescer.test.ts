import { expect, test } from "bun:test";
import type { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { coalesceModelRefresh } from "./model-refresh-coalescer";

const result = () => ({ aborted: false, errors: new Map<string, Error>() });

test("a registration burst and its explicit offline barrier share one real refresh", async () => {
  const calls: unknown[] = [];
  const runtime: Pick<ModelRuntime, "refresh"> = {
    refresh: async (options) => {
      calls.push(options);
      return result();
    },
  };
  coalesceModelRefresh(runtime);
  const requests = Array.from({ length: 45 }, () =>
    runtime.refresh({ allowNetwork: false }),
  );
  expect(new Set(requests).size).toBe(1);
  await Promise.all(requests);
  expect(calls).toEqual([{ allowNetwork: false }]);
  await runtime.refresh({ allowNetwork: false });
  expect(calls).toHaveLength(2);
});

test("registrations arriving during refresh require a later pass before any waiter settles", async () => {
  const passes: ReturnType<
    typeof Promise.withResolvers<ReturnType<typeof result>>
  >[] = [];
  const runtime: Pick<ModelRuntime, "refresh"> = {
    refresh: async () => {
      const pass = Promise.withResolvers<ReturnType<typeof result>>();
      passes.push(pass);
      return pass.promise;
    },
  };
  coalesceModelRefresh(runtime);
  let finished = false;
  const first = runtime.refresh({ allowNetwork: false }).then(() => {
    finished = true;
  });
  while (!passes.length) await Bun.sleep(1);
  const late = runtime.refresh({ allowNetwork: false });
  passes[0].resolve(result());
  while (passes.length < 2) await Bun.sleep(1);
  expect(finished).toBe(false);
  passes[1].resolve(result());
  await Promise.all([first, late]);
  expect(finished).toBe(true);
});

test("an explicit network refresh waits for older offline work and cannot be overwritten by it", async () => {
  const offline = Promise.withResolvers<ReturnType<typeof result>>();
  const calls: unknown[] = [];
  const runtime: Pick<ModelRuntime, "refresh"> = {
    refresh: async (options) => {
      calls.push(options);
      return options?.allowNetwork ? result() : offline.promise;
    },
  };
  coalesceModelRefresh(runtime);
  const registration = runtime.refresh({ allowNetwork: false });
  const options = {
    allowNetwork: true,
    providers: ["openai-api"],
    force: true,
  };
  const network = runtime.refresh(options);
  while (!calls.length) await Bun.sleep(1);
  expect(calls).toEqual([{ allowNetwork: false }]);
  offline.resolve(result());
  await Promise.all([registration, network]);
  expect(calls).toEqual([{ allowNetwork: false }, options]);
  expect(calls[1]).toBe(options);
});

test("independent session runtimes never share refresh state", async () => {
  let calls = 0;
  const create = (): Pick<ModelRuntime, "refresh"> => ({
    refresh: async () => {
      calls++;
      return result();
    },
  });
  const first = create(),
    second = create();
  coalesceModelRefresh(first);
  coalesceModelRefresh(second);
  const a = first.refresh({ allowNetwork: false });
  const b = second.refresh({ allowNetwork: false });
  expect(a).not.toBe(b);
  await Promise.all([a, b]);
  expect(calls).toBe(2);
});

test("network, scoped and cancellable refresh options are not coalesced or altered", async () => {
  const calls: unknown[] = [];
  const runtime: Pick<ModelRuntime, "refresh"> = {
    refresh: async (options) => {
      calls.push(options);
      return result();
    },
  };
  coalesceModelRefresh(runtime);
  const options = [
    { allowNetwork: true, force: true },
    { allowNetwork: false, providers: ["one"] },
    { allowNetwork: false, signal: new AbortController().signal },
  ];
  await Promise.all(options.map((option) => runtime.refresh(option)));
  expect(calls).toEqual(options);
  for (let i = 0; i < options.length; i++) expect(calls[i]).toBe(options[i]);
});

test("failed batches reject all waiters and do not poison future refreshes", async () => {
  let fail = true;
  const runtime: Pick<ModelRuntime, "refresh"> = {
    refresh: async () => {
      if (fail) throw new Error("fixture refresh error");
      return result();
    },
  };
  coalesceModelRefresh(runtime);
  const first = runtime.refresh({ allowNetwork: false });
  const second = runtime.refresh({ allowNetwork: false });
  await Promise.all([
    expect(first).rejects.toThrow("fixture refresh error"),
    expect(second).rejects.toThrow("fixture refresh error"),
  ]);
  fail = false;
  expect(await runtime.refresh({ allowNetwork: false })).toEqual(result());
});
