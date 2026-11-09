import { expect, test } from "bun:test";
import type { PackageEvent } from "../shared/packages";
import type { TranscriptRecord } from "../shared/transcript";
import {
  customPresentation,
  dataText,
  rendererOrFallback,
} from "./custom-data";
import { createPackageAdapter } from "./package-rpc";

const base = {
  id: "saved-entry",
  entryId: "saved-entry",
  parentId: null,
  branchId: "leaf",
  order: 1,
};
test("RND-01 saved/live custom message, custom-entry.data, details and unknown session entry retained", () => {
  const records: TranscriptRecord[] = [
    {
      ...base,
      kind: "message",
      rendererKey: "unavailable",
      message: {
        role: "custom",
        customType: "opaque",
        content: { text: "<script>not executable</script>", unknown: [1, 2] },
        display: true,
        timestamp: 1,
        details: { retained: true },
      },
    },
    {
      ...base,
      id: "live:2:1",
      entryId: undefined,
      kind: "custom-entry",
      customType: "unknown-entry",
      data: { arbitrary: "retained" },
    },
    {
      ...base,
      kind: "session-entry",
      entryType: "unknown-metadata",
      data: { future: true },
    },
  ];
  for (const record of records) {
    const basic = () => dataText(customPresentation(record));
    expect(rendererOrFallback(undefined, basic)).toContain("content");
    expect(
      rendererOrFallback(() => {
        throw new Error("broken renderer");
      }, basic),
    ).toBe(basic());
    expect(dataText(record)).toContain(
      record.kind === "message"
        ? "retained"
        : record.kind === "custom-entry"
          ? "arbitrary"
          : "future",
    );
  }
  expect(customPresentation(records[0]).details).toEqual({ retained: true });
  expect(customPresentation(records[1]).content).toEqual({
    arbitrary: "retained",
  });
});
test("custom fallback handles circular/unsupported JSON safely as text", () => {
  const value: { content: string; self?: unknown } = {
    content: "<img onerror=bad>",
  };
  value.self = value;
  expect(dataText(value)).toContain("[Circular]");
  expect(dataText(value)).toContain("<img onerror=bad>");
  expect(dataText(1n)).toBe('"1"');
});
test("stable PackageService adapter forwards exact operation/events and filters profiles", async () => {
  const operations: unknown[] = [];
  const adapter = createPackageAdapter("/fixed/pi-agent", {
    search: async (input) => ({ items: [], total: input.page, pageSize: 50 }),
    listInstalled: async () => [],
    operate: async (input) => {
      operations.push(input);
      return {
        operation: {
          ...input,
          source: "npm:fixture",
          agentDir: "/fixed/pi-agent",
          status: "done",
        },
        apply: { status: "pending", pendingSessionIds: ["sdk"] },
      };
    },
  });
  const service = adapter.service;
  const events: PackageEvent[] = [];
  const unsubscribe = service.subscribe((event) => {
    events.push(event);
  });
  const event: PackageEvent = {
    type: "diagnostic",
    agentDir: service.agentDir,
    message: "Duplicate SDK module",
  };
  adapter.receive(event);
  adapter.receive({ ...event, agentDir: "/other" });
  expect(events).toEqual([event]);
  expect(adapter.service).toBe(service);
  const input = { opId: "id", action: "install" as const, name: "fixture" };
  expect((await service.operate(input)).apply.status).toBe("pending");
  expect(operations).toEqual([input]);
  unsubscribe();
  adapter.receive(event);
  expect(events).toHaveLength(1);
});
test("App exposes only SDK UI without legacy detection or manual runtime reconnect", async () => {
  const source = await Bun.file(new URL("./App.tsx", import.meta.url)).text();
  expect(source).not.toMatch(
    /Archive|archive|Legacy|detectLegacy|reconnectRuntime|Reconnect runtime/,
  );
  expect(source).toContain("useEffect(initRuntimeConnection, [])");
});
