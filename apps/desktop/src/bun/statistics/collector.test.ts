import { expect, test } from "bun:test";
import { fauxAssistantMessage } from "@earendil-works/pi-ai";
import { fixture } from "./fixtures";
import { toolMetadata, usageMetadata } from "./normalize";

test("usage preserves SDK values, subsets, missing data and cost provenance", () => {
  const usage = usageMetadata({
    input: 10,
    output: 20,
    reasoning: 8,
    cacheRead: 30,
    cacheWrite: 40,
    cacheWrite1h: 12,
    totalTokens: 100,
    cost: { input: 1, total: 2, totalFromProvider: true },
  });
  expect(usage).toMatchObject({
    input: 10,
    output: 20,
    reasoning: 8,
    cacheRead: 30,
    cacheWrite: 40,
    cacheWrite1h: 12,
    totalTokens: 100,
    costSource: "provider",
  });
  expect(usageMetadata(undefined)).toMatchObject({
    input: null,
    reasoning: null,
    costTotal: null,
    usageEvidence: "missing",
  });
  expect(
    usageMetadata({ input: 0, output: NaN, totalTokens: -1 }),
  ).toMatchObject({
    input: 0,
    output: null,
    totalTokens: null,
    reportingCoverage: "provider-report-presence-unknown",
  });
});

test("retry belongs to the same run; tool outcomes keep independent facts without bodies", () => {
  const { collector, events, advance } = fixture();
  const secret = "SECRET-prompt-command-result-error";
  collector.event({ type: "agent_start" });
  collector.event(
    {
      type: "message_start",
      message: { role: "user", timestamp: 1, content: secret },
    },
    "send-1",
  );
  const first = fauxAssistantMessage(secret, { stopReason: "error" });
  collector.event({ type: "message_start", message: first });
  advance(12);
  collector.event({ type: "message_end", message: first });
  collector.event({ type: "message_end", message: first });
  collector.event({ type: "agent_end", messages: [first], willRetry: true });
  collector.event({
    type: "auto_retry_start",
    attempt: 1,
    maxAttempts: 3,
    delayMs: 100,
    errorMessage: secret,
  });
  collector.event({ type: "agent_start" });
  const last = fauxAssistantMessage("answer", { stopReason: "toolUse" });
  collector.event({ type: "message_start", message: last });
  collector.event({ type: "message_end", message: last });
  collector.event({
    type: "tool_execution_start",
    toolCallId: "call",
    parentToolCallId: "parent",
    toolName: "bash",
    args: { command: secret },
  });
  advance(25);
  collector.event({
    type: "tool_execution_end",
    toolCallId: "call",
    parentToolCallId: "parent",
    toolName: "bash",
    isError: false,
    durationMs: 20,
    result: {
      content: [{ type: "text", text: secret }],
      structuredContent: {
        output: secret,
        exit_code: 1,
        wall_time_seconds: 0.1,
      },
      details: { secret, fullOutputPath: secret },
    },
  });
  collector.event({ type: "agent_settled", aborted: false });
  collector.close();
  expect(events.filter((event) => event.type === "run_start")).toHaveLength(1);
  expect(events.filter((event) => event.type === "model_end")).toHaveLength(2);
  expect(events.find((event) => event.type === "run_end")?.data.status).toBe(
    "completed",
  );
  const tool = events.find((event) => event.type === "tool_execution_end");
  expect(tool?.data).toMatchObject({
    isError: false,
    exitCode: 1,
    executionDurationMs: 20,
    observedDurationMs: 25,
  });
  expect(tool?.parentCall).toBe("parent");
  expect(tool?.request).toBe(
    events.filter((event) => event.type === "model_end").at(-1)?.request ?? "",
  );
  expect(JSON.stringify(events)).not.toContain(secret);
  expect(new Set(events.map((event) => event.id)).size).toBe(events.length);
  expect(
    new Set(events.filter((event) => event.run).map((event) => event.run)).size,
  ).toBe(1);
});

test("auxiliary usage is recorded once per new entry, never imported from inherited history", () => {
  const { collector, events } = fixture();
  const usage = fauxAssistantMessage("").usage;
  const entry = {
    type: "compaction" as const,
    id: "compaction",
    parentId: null,
    timestamp: new Date().toISOString(),
    summary: "SECRET-summary",
    firstKeptEntryId: "keep",
    tokensBefore: 2000,
    usage,
  };
  collector.event({ type: "entry_appended", entry });
  collector.event({ type: "entry_appended", entry });
  collector.event({
    type: "compaction_end",
    reason: "manual",
    result: {
      summary: "SECRET-summary",
      firstKeptEntryId: "keep",
      tokensBefore: 2000,
      usage,
    },
    aborted: false,
    willRetry: false,
  });
  expect(
    events.filter((event) => event.type === "auxiliary_usage"),
  ).toHaveLength(1);
  expect(JSON.stringify(events)).not.toContain("SECRET");
});

test("close records interrupted run with unfinished tools, and ignores late events", () => {
  const { collector, events } = fixture();
  collector.event({ type: "agent_start" });
  collector.event({
    type: "tool_execution_start",
    toolCallId: "unfinished",
    toolName: "read",
    args: {},
  });
  collector.close();
  const length = events.length;
  collector.close();
  collector.event({ type: "agent_start" });
  expect(events.length).toBe(length);
  expect(events.find((event) => event.type === "run_end")?.data).toMatchObject({
    status: "interrupted",
    unfinishedTools: 1,
  });
});

test("only explicit tool metadata is extracted, never inferred from error output", () => {
  expect(
    toolMetadata("bash", {
      content: [{ type: "text", text: "Command exited with code 99" }],
    }).exitCode,
  ).toBeNull();
  expect(
    toolMetadata("read", {
      structuredContent: { exit_code: 99 },
      details: {
        truncation: { truncated: true, totalBytes: 300, outputBytes: 100 },
      },
    }),
  ).toMatchObject({
    exitCode: null,
    truncated: true,
    originalBytes: 300,
    retainedBytes: 100,
  });
});
