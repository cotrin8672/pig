import { expect, test } from "bun:test";
import { approvedOrigin, httpAdapters } from "./adapters";
import {
  deepseekUsage,
  minimaxUsage,
  openrouterUsage,
  radiusBalance,
  zaiUsage,
} from "./adapters/balances";
import {
  claudeUsage,
  codexUsage,
  copilotUsage,
  goUsage,
  kimiUsage,
  mistralUsage,
} from "./adapters/subscriptions";
import {
  parseClaudeCli,
  parseQuotaJson,
  runUsageCommand,
  usageCommands,
} from "./cli";
import { UsageError, type UsageTarget } from "./contracts";
import { retryAfter, usageHttp } from "./http";
import { UsageService } from "./service";

const data = {
  windows: [{ id: "5h", label: "5h", usedPercent: 88 }],
  balances: [],
};
const target = (read: UsageTarget["read"], revision = "a"): UsageTarget => ({
  key: "codex",
  provider: "openai-codex",
  label: "Work",
  source: "api",
  revision,
  read,
});

test("CLI discovery excludes Claude so Anthropic has only pig account rows", () => {
  expect(
    usageCommands.some(
      (spec) => spec.provider === "anthropic" || spec.command === "claude",
    ),
  ).toBe(false);
  expect(usageCommands.map((spec) => spec.command)).toEqual(["muse", "bl"]);
});

test("Codex keeps bucket identity, duration, epoch units and reset ticket zero", () => {
  const result = codexUsage({
    rate_limit: {
      primary_window: {
        used_percent: 88,
        limit_window_seconds: 18000,
        reset_at: 1_900_000_000,
      },
      secondary_window: null,
    },
    additional_rate_limits: [
      {
        limit_name: "Spark",
        rate_limit: { primary_window: { used_percent: 22 } },
      },
    ],
    rate_limit_reset_credits: { available_count: 0 },
  });
  expect(result.windows).toHaveLength(2);
  expect(result.windows[0]).toMatchObject({
    usedPercent: 88,
    durationMs: 18000000,
    resetsAt: 1_900_000_000_000,
  });
  expect(result.windows[1].id).toContain("Spark");
  expect(result.details).toContain("Reset tickets: 0");
});
test("Claude JSON is percent, not a 0–1 ratio; absent windows stay absent", () => {
  expect(
    claudeUsage({
      five_hour: { utilization: 0, resets_at: "2030-01-01T00:00:00Z" },
      seven_day: null,
    }).windows,
  ).toHaveLength(1);
  expect(
    claudeUsage({ five_hour: { utilization: 23.5 } }).windows[0].usedPercent,
  ).toBe(23.5);
});
test("Mistral budget accepts zero usage and PAYG overage but not an unknown denominator", () => {
  expect(
    mistralUsage({ vibe_budget: { usage_percentage: 0, initial_budget: 300 } })
      .windows[0].usedPercent,
  ).toBe(0);
  expect(
    mistralUsage({
      vibe_budget: {
        usage_percentage: 130,
        initial_budget: 300,
        payg_enabled: true,
      },
    }).windows[0].durationMs,
  ).toBeUndefined();
  expect(
    mistralUsage({ vibe_budget: { usage_percentage: 25, initial_budget: 0 } })
      .windows,
  ).toEqual([]);
});
test("Mistral time ring follows the calendar month ending at reset", () => {
  for (const [reset, days] of [
    ["2026-12-01T00:00:00Z", 30],
    ["2026-02-01T00:00:00Z", 31],
    ["2026-03-01T00:00:00Z", 28],
    ["2028-03-01T00:00:00Z", 29],
    ["2026-03-31T12:00:00Z", 31],
    ["2026-01-15T12:00:00Z", 31],
  ] as const) {
    const window = mistralUsage({
      vibe_budget: {
        usage_percentage: 6,
        initial_budget: 300,
        reset_at: reset,
      },
    }).windows[0];
    expect(window.resetsAt).toBe(Date.parse(reset));
    expect(window.durationMs).toBe(days * 86400000);
  }
  expect(
    mistralUsage({
      vibe_budget: {
        usage_percentage: 6,
        initial_budget: 300,
        reset_at: "invalid",
      },
    }).windows[0].durationMs,
  ).toBeUndefined();
});
test("balances preserve decimals, currency, zero and negative available amounts", () => {
  expect(
    deepseekUsage({
      balance_infos: [{ currency: "CNY", total_balance: "0.0001" }],
    }).balances[0].amount,
  ).toBe("0.0001");
  expect(
    openrouterUsage({ data: { limit_remaining: 0 } }).balances[0],
  ).toMatchObject({ amount: "0", currency: "USD" });
  expect(openrouterUsage({ data: { limit_remaining: null } }).balances).toEqual(
    [],
  );
  expect(
    radiusBalance({
      currency: "USD",
      balance: { available: -0.5, credit_balance: 20, reserved: 20.5 },
    }).balances[0].amount,
  ).toBe("-0.5");
});
test("MiniMax uses explicit percent to disambiguate legacy remaining vs newer consumed counts", () => {
  const parse = (percent?: number) =>
    minimaxUsage(
      {
        model_remains: [
          {
            model_name: "M",
            current_interval_total_count: 100,
            current_interval_usage_count: 20,
            current_interval_remaining_percent: percent,
          },
        ],
      },
      "USD",
    ).windows;
  expect(parse()[0].usedPercent).toBe(80);
  expect(parse(20)[0].usedPercent).toBe(80);
  expect(parse(80)[0].usedPercent).toBe(20);
  expect(parse(50)).toEqual([]);
});
test("Go, Kimi, Z.ai and Copilot do not invent missing limits", () => {
  expect(
    goUsage({ usage: { weekly: { percent: 50, resetsAt: "2030-01-01" } } })
      .windows[0].durationMs,
  ).toBeUndefined();
  expect(kimiUsage({ limits: [{ window: "5h", limit: 100 }] }).windows).toEqual(
    [],
  );
  expect(
    kimiUsage({ limits: [{ window: "5h", limit: 100, remaining: 10 }] })
      .windows[0].usedPercent,
  ).toBe(90);
  expect(
    zaiUsage({ data: { limits: [{ type: "TOKENS_LIMIT", percentage: 24 }] } })
      .windows[0].usedPercent,
  ).toBe(24);
  expect(
    copilotUsage({
      quota_snapshots: {
        premium_interactions: { unlimited: true, credits_used: 25 },
      },
    }).windows,
  ).toEqual([]);
});
test("registry excludes deferred providers and restricts billing origins", () => {
  for (const provider of [
    "google",
    "openai",
    "openai-api",
    "xai",
    "xiaomi",
    "opencode",
    "nvidia",
  ])
    expect(httpAdapters.some((a) => a.provider === provider)).toBe(false);
  const adapter = httpAdapters.find((a) => a.provider === "openai-codex");
  if (!adapter) throw new Error("Missing Codex adapter");
  expect(approvedOrigin(adapter, "https://chatgpt.com/backend-api/codex")).toBe(
    true,
  );
  expect(approvedOrigin(adapter, "https://chatgpt.com.evil.example/v1")).toBe(
    false,
  );
  expect(approvedOrigin(adapter, "https://user@chatgpt.com")).toBe(false);
});
test("HTTP never follows redirects or publishes a raw body; honors retry-after", async () => {
  const calls: RequestInit[] = [];
  const http = usageHttp(
    (async (_url, init) => {
      calls.push(init ?? {});
      return new Response("SECRET", {
        status: 429,
        headers: { "retry-after": "120" },
      });
    }) as typeof fetch,
    () => 1000,
  );
  try {
    await http.get(
      "https://example.com",
      { Authorization: "Bearer secret" },
      new AbortController().signal,
    );
    throw Error("should fail");
  } catch (error) {
    expect(error).toBeInstanceOf(UsageError);
    expect((error as UsageError).retryAt).toBe(121000);
    expect(String(error)).not.toContain("SECRET");
  }
  expect(calls[0].redirect).toBe("error");
  expect(retryAfter("0", 1000)).toBe(61000);
  expect(retryAfter("invalid", 1000)).toBe(61000);
});
test("poller is single-flight, TTL/backoff respects manual refresh and preserves observedAt", async () => {
  let now = 100_000,
    reads = 0,
    fail = false;
  const source = target(async () => {
    reads++;
    if (fail) throw new UsageError("rate-limit", now + 120000);
    return data;
  });
  const service = new UsageService(
    async () => [source],
    () => {},
    () => now,
  );
  const first = service.refresh();
  expect(service.refresh()).toBe(first);
  await first;
  expect(reads).toBe(1);
  now += 1000;
  await service.refresh(true);
  expect(reads).toBe(1);
  now += 120000;
  fail = true;
  await service.refresh();
  expect(service.snapshot()[0]).toMatchObject({
    status: "error",
    observedAt: 100000,
    data,
  });
  await service.refresh(true);
  expect(reads).toBe(2);
  service.dispose();
});
test("new credential revisions discard old success and removed sources disappear", async () => {
  let sources = [target(async () => data)];
  const service = new UsageService(
    async () => sources,
    () => {},
  );
  await service.refresh();
  sources = [
    target(async () => {
      throw new UsageError("auth");
    }, "other-owner"),
  ];
  await service.refresh();
  expect(service.snapshot()[0].data).toBeUndefined();
  sources = [];
  await service.refresh();
  expect(service.snapshot()).toEqual([]);
  service.dispose();
});
test("logout invalidation and disposal cannot publish an in-flight success", async () => {
  let resolve!: (value: typeof data) => void;
  const pending = new Promise<typeof data>((done) => {
    resolve = done;
  });
  const service = new UsageService(
    async () => [target(async () => pending)],
    () => {},
  );
  const work = service.refresh();
  await Bun.sleep(1);
  service.invalidate("openai-codex");
  resolve(data);
  await work;
  expect(service.snapshot()).toEqual([]);
  service.dispose();
});
test("CLI parses measured windows only; unknown JSON and missing percentages stay unavailable", () => {
  expect(() => parseQuotaJson('{"hasQuotaData":false}')).toThrow(UsageError);
  expect(() => parseQuotaJson('{"token_count":500}')).toThrow(UsageError);
  expect(
    parseQuotaJson(
      '{"subs_usage":{"window":{"used_percent":33,"resets_at":1900000000}}}',
    ).windows[0].usedPercent,
  ).toBe(33);
});
test("CLI text parser does not interpret a sign-in/trust prompt as zero usage", () => {
  expect(() => parseClaudeCli("Do you trust this folder?")).toThrow(UsageError);
  expect(
    parseClaudeCli(
      "Current session\n 23% used\nCurrent week (all models)\n 40% used\nExtra usage",
    ).windows.map((w) => w.usedPercent),
  ).toEqual([23, 40]);
});
test("bounded CLI runner executes argv without a shell, stdin or inherited project cwd", async () => {
  const output = await runUsageCommand(
    process.execPath,
    ["-e", "process.stdout.write(process.cwd())"],
    new AbortController().signal,
  );
  expect(output).toContain("pig-usage-");
  expect(output).not.toBe(process.cwd());
});
