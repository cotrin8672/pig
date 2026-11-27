import { expect, test } from "bun:test";
import { fixture } from "./fixtures";
import { statisticsRange } from "./queries";
import { StatisticsStore } from "./store";

test("statistics aggregates known tokens, exact time boundaries, tool outcomes and mean per-request speed", () => {
  const now = new Date(2026, 10, 13, 12).getTime();
  const start = statisticsRange("today", now).start;
  const { events } = fixture();
  const event = events[0];
  const store = new StatisticsStore(":memory:");
  try {
    const model = (
      id: string,
      at: number,
      output: number | null,
      duration: number,
      stop = "stop",
    ) => ({
      ...event,
      id,
      request: id,
      at,
      type: "model_end",
      data: {
        costTotal: id === "first" ? 0.75 : id === "second" ? 0 : null,
        timestamp: at,
        provider: "test",
        model: "one",
        purpose: "conversation",
        input: 100,
        output,
        cacheRead: 200,
        cacheWrite: 30,
        reasoning: 5,
        stopReason: stop,
        durationMs: duration,
      },
    });
    store.save([
      model("before", start - 1, 999, 10),
      model("first", start, 10, 1000),
      model("second", start + 100, 60, 2000),
      model("failed", start + 200, 5, 500, "error"),
      model("unknown", start + 300, null, 500),
      model("tomorrow", statisticsRange("today", now).end, 999, 10),
      {
        ...event,
        id: "tool-1",
        type: "tool_execution_end",
        at: start,
        data: { tool: "read", isError: false },
      },
      {
        ...event,
        id: "tool-2",
        type: "tool_execution_end",
        at: start,
        data: { tool: "read", isError: true },
      },
      {
        ...event,
        id: "tool-start",
        type: "tool_execution_start",
        at: start,
        data: { tool: "unfinished" },
      },
      {
        ...event,
        id: "context",
        type: "initial_context",
        at: start,
        data: {
          parts: [{ id: "tools", label: "tools", tokens: 123 }],
          sections: [{ id: "rules", tokens: 7 }],
          tools: [{ name: "unused", tokens: 123, source: "pi-lens" }],
          contextWindow: 200000,
        },
      },
    ]);
    const parts: string[][] = [];
    const snapshot = store.snapshot("today", now, (part) =>
      parts.push(Object.keys(part)),
    );
    expect(parts).toEqual([
      ["models", "cost", "collectingSince", "coverage"],
      ["days", "daily"],
      ["commands"],
    ]);
    expect(snapshot.cost).toEqual({ usd: 0.75, missing: 2 });
    expect(snapshot.days).toHaveLength(1);
    expect(snapshot.models).toHaveLength(1);
    expect(snapshot.models[0]).toMatchObject({
      requests: 4,
      measuredRequests: 2,
      tokensPerSecond: 20,
      tokens: { input: 400, output: 75, cacheRead: 800, cacheWrite: 120 },
    });
    expect(snapshot.coverage.unknownUsage).toBe(1);
    expect(snapshot.tools).toEqual([
      { tool: "read", calls: 2, failures: 1, definitionTokens: null },
      { tool: "unused", calls: 0, failures: 0, definitionTokens: 123 },
    ]);
    expect(snapshot.commands).toEqual({
      rows: [],
      unclassified: 0,
      unmeasured: 0,
    });
    const daily = snapshot.daily[snapshot.models[0].id][0];
    expect(daily).toEqual(snapshot.models[0].tokens);
    expect(snapshot.initialContext.contextWindow).toBe(200000);
    expect(snapshot.initialContext.sections).toEqual([
      { id: "rules", tokens: 7 },
    ]);
    expect(snapshot.initialContext.sources).toEqual([
      { id: "pi-lens", tokens: 123, tools: [{ name: "unused", tokens: 123 }] },
    ]);
    store.save([
      {
        ...event,
        id: "damaged-context",
        type: "initial_context",
        at: start + 500,
        data: {
          parts: [{ id: "base", tokens: 20, privateText: "SECRET" }],
          tools: [null, "bad"],
          contextWindow: null,
        },
      },
    ]);
    const safe = store.snapshot("today", now);
    expect(safe.initialContext.parts).toEqual([
      { id: "base", label: "base", tokens: 20 },
    ]);
    expect(JSON.stringify(safe)).not.toContain("SECRET");
    expect(safe.models).toHaveLength(1);
    expect(() => store.snapshot("invalid" as "today")).toThrow(
      "Invalid statistics period",
    );
    store.forget(event.owner);
    expect(store.snapshot("today", now).cost).toEqual({
      usd: null,
      missing: 0,
    });
    expect(store.snapshot("today", now).models).toHaveLength(0);
    expect(store.snapshot("today", now).initialContext.parts).toHaveLength(0);
  } finally {
    store.close();
  }
});

test("shell commands derive outcomes from exit codes, separately from SDK errors", () => {
  const now = new Date(2026, 10, 13, 12).getTime();
  const start = statisticsRange("today", now).start;
  const { events } = fixture();
  const store = new StatisticsStore(":memory:");
  let n = 0;
  const end = (
    tool: string,
    command: string | undefined,
    exitCode: number | null,
    textBytes = 10,
    at = start,
  ) => ({
    ...events[0],
    id: `command-${n++}`,
    type: "tool_execution_end",
    at,
    data: {
      tool,
      isError: exitCode !== 0,
      exitCode,
      textBytes,
      ...(command === undefined ? {} : { shellCommandKey: command }),
    },
  });
  try {
    store.save([
      end("bash", "git diff", 0),
      end("bash", "git diff", 128, 300),
      end("bash", "git diff", null, 900),
      end("bash", "rg", 1),
      end("bash", "rg", 2, 40),
      end("powershell", "rg", 1, 70),
      end("powershell", "git diff", 1, 50),
      end("bash", "unclassified", 1),
      end("powershell", undefined, 1),
      end("read", "git diff", 1),
      end("bash", "git diff", 1, 10, start - 1),
      {
        ...events[0],
        id: "unfinished",
        type: "tool_execution_start",
        at: start,
        data: { tool: "bash", shellCommandKey: "git diff" },
      },
    ]);
    expect(store.snapshot("today", now).commands).toEqual({
      rows: [
        {
          shell: "bash",
          command: "git diff",
          calls: 3,
          failures: 1,
          unknown: 1,
          sdkErrors: 2,
          failureBytes: 300,
        },
        {
          shell: "powershell",
          command: "git diff",
          calls: 1,
          failures: 1,
          unknown: 0,
          sdkErrors: 1,
          failureBytes: 50,
        },
        {
          shell: "bash",
          command: "rg",
          calls: 2,
          failures: 1,
          unknown: 0,
          sdkErrors: 2,
          failureBytes: 40,
        },
        {
          shell: "powershell",
          command: "rg",
          calls: 1,
          failures: 0,
          unknown: 1,
          sdkErrors: 1,
          failureBytes: 0,
        },
      ],
      unclassified: 1,
      unmeasured: 1,
    });
    store.forget(events[0].owner);
    expect(store.snapshot("today", now).commands.rows).toEqual([]);
  } finally {
    store.close();
  }
});

test("empty databases and all-period ranges remain bounded", () => {
  const store = new StatisticsStore(":memory:");
  try {
    const snapshot = store.snapshot("all");
    expect(snapshot.days.length).toBeLessThanOrEqual(366);
    expect(snapshot.collectingSince).toBeNull();
    expect(snapshot.models).toEqual([]);
    expect(snapshot.initialContext).toEqual({
      parts: [],
      sections: [],
      sources: [],
      measuredTotal: null,
      contextWindow: null,
    });
  } finally {
    store.close();
  }
});
