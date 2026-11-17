import { expect, test } from "bun:test";
import {
  MCP_APP_MAX_BYTES,
  type McpAppRef,
  mcpAppRef,
} from "../shared/mcp-app";
import { MCP_APP_MAX_READERS, McpApps } from "./mcp-apps";

type Observation = Parameters<McpApps["observe"]>[0];
const uri = "ui://fixture/chart.html";
const signal = () => new AbortController().signal;
const resource = (text = "<h1>Static chart</h1>") => ({
  contents: [{ uri, mimeType: "text/html;profile=mcp-app", text }],
});
function observe(
  apps: McpApps,
  readResource: Observation["readResource"] = async () => resource(),
  overrides: Partial<Observation> = {},
) {
  const details = apps.observe({
    toolCallId: "call",
    server: "fixture",
    tool: {
      name: "forecast",
      title: "Forecast",
      inputSchema: { type: "object" },
      _meta: { ui: { resourceUri: uri } },
    },
    isError: false,
    readResource,
    ...overrides,
  });
  return mcpAppRef(details) as McpAppRef;
}

test("UI metadata becomes only an opaque host reference; HTML is read lazily", async () => {
  const apps = new McpApps();
  let reads = 0;
  const ref = observe(apps, async (requestedUri, options) => {
    reads++;
    expect(requestedUri).toBe(uri);
    expect(options.timeoutMs).toBe(5000);
    return resource();
  });
  expect(reads).toBe(0);
  expect(ref).toEqual({
    version: 1,
    id: expect.any(String),
    title: "Forecast",
  });
  expect(JSON.stringify(ref)).not.toContain("ui://");
  expect(await apps.read(ref.id, "call", signal())).toEqual({
    ref,
    html: "<h1>Static chart</h1>",
  });
  expect(reads).toBe(1);
  await expect(apps.read(ref.id, "other-call", signal())).rejects.toThrow(
    "UNAVAILABLE",
  );
  const other = new McpApps();
  await expect(other.read(ref.id, "call", signal())).rejects.toThrow(
    "UNAVAILABLE",
  );
  apps.dispose();
  other.dispose();
});

test("static reads share parsing as well as transport", async () => {
  const apps = new McpApps();
  let reads = 0;
  const ref = observe(apps, async () => {
    reads++;
    return resource();
  });
  const [a, b] = await Promise.all([
    apps.readStatic(ref.id, "call", signal()),
    apps.readStatic(ref.id, "call", signal()),
  ]);
  expect(a).toBe(b);
  expect(reads).toBe(1);
  expect(a).toBe("<h1>Static chart</h1>");
  apps.dispose();
});

test("invalid metadata, error results and disposed runtimes do not create previews", () => {
  const apps = new McpApps();
  for (const resourceUri of [
    "https://example.com/ui",
    "file:///secret",
    "ui:",
    "ui:///missing-host",
    "ui://user:pass@fixture/view",
    "ui://fixture/\nview",
    `ui://fixture/${"x".repeat(4096)}`,
    12,
  ])
    expect(
      observe(apps, undefined, {
        tool: {
          name: "invalid",
          inputSchema: { type: "object" },
          _meta: { ui: { resourceUri } },
        },
      }),
    ).toBeUndefined();
  expect(observe(apps, undefined, { isError: true })).toBeUndefined();
  expect(
    observe(apps, undefined, {
      tool: { name: "ordinary", inputSchema: { type: "object" } },
    }),
  ).toBeUndefined();
  apps.dispose();
  expect(observe(apps)).toBeUndefined();
  expect(
    mcpAppRef({ mcpApp: { version: 1, id: "-".repeat(36) } }),
  ).toBeUndefined();
});

test("reads are single-flight; cancelling one subscriber preserves the other", async () => {
  const apps = new McpApps();
  const gate = Promise.withResolvers<ReturnType<typeof resource>>();
  let reads = 0;
  let transportSignal: AbortSignal | undefined;
  const ref = observe(apps, async (_, options) => {
    reads++;
    transportSignal = options.signal;
    return gate.promise;
  });
  const first = new AbortController();
  const a = apps.read(ref.id, "call", first.signal);
  const b = apps.read(ref.id, "call", signal());
  await Bun.sleep(0);
  expect(reads).toBe(1);
  first.abort(new Error("first unmounted"));
  await expect(a).rejects.toThrow("first unmounted");
  expect(transportSignal?.aborted).toBe(false);
  gate.resolve(resource());
  expect((await b).html).toContain("Static chart");
  apps.dispose();
});

test("queue concurrency is shared across sessions; queued cancellations never dispatch", async () => {
  const apps = [new McpApps(), new McpApps(), new McpApps()];
  const gates = apps.map(() =>
    Promise.withResolvers<ReturnType<typeof resource>>(),
  );
  const reads = [0, 0, 0];
  const refs = apps.map((app, i) =>
    observe(app, async () => {
      reads[i]++;
      return gates[i].promise;
    }),
  );
  const third = new AbortController();
  const tasks = apps.map((app, i) =>
    app.read(refs[i].id, "call", i === 2 ? third.signal : signal()),
  );
  await Bun.sleep(0);
  expect(reads).toEqual([1, 1, 0]);
  third.abort(new Error("queued view closed"));
  await expect(tasks[2]).rejects.toThrow("queued view closed");
  gates[0].resolve(resource());
  gates[1].resolve(resource());
  await Promise.all(tasks.slice(0, 2));
  expect(reads).toEqual([1, 1, 0]);
  for (const app of apps) app.dispose();
});

test("the global waiting queue is bounded and releases abandoned requests", async () => {
  const apps = new McpApps();
  const gate = Promise.withResolvers<ReturnType<typeof resource>>();
  let reads = 0;
  const controllers = Array.from({ length: 34 }, () => new AbortController());
  const pending = controllers.map((controller) => {
    const ref = observe(apps, async () => {
      reads++;
      return gate.promise;
    });
    return apps.read(ref.id, "call", controller.signal);
  });
  await Bun.sleep(0);
  expect(reads).toBe(2);
  const excess = observe(apps);
  await expect(apps.read(excess.id, "call", signal())).rejects.toThrow(
    "QUEUE_FULL",
  );
  for (const controller of controllers)
    controller.abort(new Error("view closed"));
  await Promise.allSettled(pending);
  gate.resolve(resource());
  await Bun.sleep(0);
  expect(reads).toBe(2);
  const next = observe(apps);
  expect((await apps.read(next.id, "call", signal())).html).toContain("Static");
  apps.dispose();
});

test("resource requests have a hard timeout, not a progress-reset timeout", async () => {
  const apps = new McpApps();
  let requestSignal: AbortSignal | undefined;
  const ref = observe(
    apps,
    (_, options) =>
      new Promise((_, reject) => {
        requestSignal = options.signal;
        options.signal?.addEventListener(
          "abort",
          () => reject(options.signal?.reason),
          { once: true },
        );
      }),
  );
  await expect(apps.read(ref.id, "call", signal())).rejects.toThrow();
  expect(requestSignal?.aborted).toBe(true);
  apps.dispose();
}, 10_000);

test("close/reload cancels subscribers and rejects late results", async () => {
  const apps = new McpApps();
  const gate = Promise.withResolvers<ReturnType<typeof resource>>();
  let requestSignal: AbortSignal | undefined;
  const ref = observe(apps, async (_, options) => {
    requestSignal = options.signal;
    return gate.promise;
  });
  const pending = apps.read(ref.id, "call", signal());
  await Bun.sleep(0);
  apps.dispose();
  await expect(pending).rejects.toThrow("disposed");
  expect(requestSignal?.aborted).toBe(true);
  gate.resolve(resource("late"));
  await Bun.sleep(0);
  expect(() => apps.read(ref.id, "call", signal())).toThrow("disposed");
});

test("reader retention is bounded and each call has a distinct identity", async () => {
  const apps = new McpApps();
  const first = observe(apps);
  let last = first;
  for (let i = 0; i < MCP_APP_MAX_READERS; i++) {
    last = observe(apps);
    expect(last.id).not.toBe(first.id);
  }
  await expect(apps.read(first.id, "call", signal())).rejects.toThrow(
    "UNAVAILABLE",
  );
  expect((await apps.read(last.id, "call", signal())).html).toContain("Static");
  apps.dispose();
});

test("resource MIME, identity, contents count and UTF-8 bytes are validated", async () => {
  const apps = new McpApps();
  const invalid = [
    { contents: [] },
    { contents: [...resource().contents, ...resource().contents] },
    { contents: [{ ...resource().contents[0], uri: "ui://other/view" }] },
    { contents: [{ ...resource().contents[0], mimeType: "text/html" }] },
    {
      contents: [{ ...resource().contents[0], text: undefined, blob: "AAAA" }],
    },
    {
      ...resource(),
      _meta: { extra: "x".repeat(2 * MCP_APP_MAX_BYTES) },
    },
    resource("あ".repeat(Math.floor(MCP_APP_MAX_BYTES / 3) + 1)),
  ];
  for (const result of invalid) {
    const ref = observe(apps, async () => result);
    await expect(apps.read(ref.id, "call", signal())).rejects.toThrow(
      "MCP_APP",
    );
  }
  const ref = observe(apps, async () =>
    resource("x".repeat(MCP_APP_MAX_BYTES)),
  );
  expect((await apps.read(ref.id, "call", signal())).html.length).toBe(
    MCP_APP_MAX_BYTES,
  );
  apps.dispose();
});
