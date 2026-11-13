import { expect, test } from "bun:test";
import type { Provider } from "@earendil-works/pi-ai";
import {
  setUsageObserver,
  usageFromHeaders,
  withUsageObservation,
} from "./observation";
import { usageInvocation } from "./process";

test("Claude response headers are fractions, missing headers are unknown", () => {
  expect(usageFromHeaders("anthropic", {}, 1000).windows).toEqual([]);
  const data = usageFromHeaders(
    "anthropic",
    {
      "anthropic-ratelimit-unified-5h-utilization": "0.235",
      "anthropic-ratelimit-unified-5h-reset": "1900000000",
    },
    1000,
  );
  expect(data.windows[0].usedPercent).toBeCloseTo(23.5);
  expect(data.windows[0].resetsAt).toBe(1900000000000);
});
test("Codex header IDs align with HTTP snapshots and use response-relative resets", () => {
  const data = usageFromHeaders(
    "openai-codex",
    {
      "x-codex-primary-used-percent": "80",
      "x-codex-primary-window-minutes": "300",
      "x-codex-primary-reset-after-seconds": "90",
    },
    1000,
  );
  expect(data.windows[0]).toMatchObject({
    id: "Codex/primary_window",
    resetsAt: 91000,
    durationMs: 18000000,
    usedPercent: 80,
  });
});
test("monitoring hook preserves caller hooks, captures account at dispatch and cannot throw into chat", async () => {
  let notify:
    | ((
        response: { status: number; headers: Record<string, string> },
        model: never,
      ) => unknown)
    | undefined;
  let account = "work",
    caller = 0,
    observed = "";
  const provider = {
    id: "anthropic",
    name: "Claude",
    auth: {},
    stream(
      _model: unknown,
      _context: unknown,
      options: { onResponse: typeof notify },
    ) {
      notify = options.onResponse;
      return {};
    },
    streamSimple() {
      return {};
    },
    getModels() {
      return [];
    },
  } as unknown as Provider;
  const wrapped = withUsageObservation(provider, () => account);
  setUsageObserver(async (event) => {
    observed = event.accountId ?? "";
    throw new Error("monitor failed");
  });
  try {
    wrapped.stream({} as never, {} as never, {
      apiKey: "secret",
      onResponse() {
        caller++;
      },
    });
    account = "personal";
    notify?.({ status: 200, headers: {} }, {} as never);
    await Bun.sleep(1);
    expect(caller).toBe(1);
    expect(observed).toBe("work");
  } finally {
    setUsageObserver(undefined);
  }
});
test("Windows command wrappers quote fixed argv and reject shell metacharacters", () => {
  expect(
    usageInvocation(
      "C:\\Program Files\\bl.cmd",
      ["usage", "token-plan", "--output", "json"],
      "win32",
    ).verbatim,
  ).toBe(true);
  expect(() => usageInvocation("C:\\bad&path\\bl.cmd", [], "win32")).toThrow();
  expect(() => usageInvocation("C:\\bl.cmd", ["%SECRET%"], "win32")).toThrow();
  expect(
    usageInvocation("/usr/bin/muse", ["usage", "--json"], "linux").verbatim,
  ).toBe(false);
});
