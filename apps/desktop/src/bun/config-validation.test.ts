import { expect, test } from "bun:test";
import {
  defineExtension,
  defineTask,
  defineTool,
  GenerationTask,
  hook,
  section,
} from "@earendil-works/pi-durable";
import type {
  ProviderFactory,
  RuntimeConfig,
} from "../../../../packages/config/src";
import { effectiveProfileTools, validateConfig } from "./config-validation";

const read = defineTool({
  name: "read",
  description: "Read",
  parameters: { type: "object" },
  async execute() {
    return {};
  },
});
const write = defineTool({
  name: "write",
  description: "Write",
  parameters: { type: "object" },
  async execute() {
    return {};
  },
});
const task = defineTask({
  name: "example.observe",
  version: 1,
  initial: () => ({ phase: "observe" as const }),
  phases: { observe: async () => {} },
  abort: async () => {},
});
const extension = defineExtension({
  name: "example",
  tools: [read, write],
  tasks: [task],
  sections: [section("example", () => "Policy")],
  hooks: [
    hook(GenerationTask, {
      beforeRequest() {
        return undefined;
      },
    }),
  ],
});
const config = (runtime: unknown) => ({ apiVersion: 2, runtime });

test("uses the actual native Registry for custom tool/section/hook/task definitions; preserves executable functions", () => {
  const value = validateConfig(
    config({
      extensions: [extension],
      profiles: {
        main: {
          extensions: [extension],
          tools: [read],
          model: { provider: "offline", modelId: "not-required-to-exist" },
          thinkingLevel: "high",
          cwd: "/project",
          instructions: "Review",
          maxTurns: 2,
        },
      },
      defaultProfile: "main",
    }),
  );
  expect(value.runtime?.extensions?.[0]).toBe(extension);
  expect(value.runtime?.extensions?.[0].tasks?.[0]).toBe(task);
  expect(value.runtime?.profiles?.main.model).toEqual({
    provider: "offline",
    modelId: "not-required-to-exist",
  });
  expect(value.runtime?.profiles?.main.tools[0].execute).toBe(read.execute);
  expect(validateConfig({ apiVersion: 2 }).runtime).toBeUndefined();
});

for (const [name, runtime, message] of [
  [
    "duplicate extensions",
    { extensions: [extension, extension] },
    "Duplicate Extension",
  ],
  [
    "non-native extension version",
    { extensions: [{ ...extension, version: 1 }] },
    "unsupported properties",
  ],
  [
    "duplicate tools",
    { extensions: [{ name: "bad", tools: [read, read] }] },
    "two tools",
  ],
  [
    "duplicate sections",
    {
      extensions: [
        {
          name: "bad",
          sections: [section("a", () => ""), section("a", () => "")],
        },
      ],
    },
    "two sections",
  ],
  [
    "reserved section",
    {
      extensions: [
        { name: "bad", sections: [section("instructions", () => "")] },
      ],
    },
    "reserved",
  ],
  [
    "task collision",
    { extensions: [extension, { name: "other", tasks: [task] }] },
    "already installed",
  ],
  [
    "builtin task collision",
    { extensions: [{ name: "bad", tasks: [GenerationTask] }] },
    "already installed",
  ],
  [
    "invalid task version",
    {
      extensions: [
        {
          name: "bad",
          tasks: [{ definition: { ...task.definition, version: 0 } }],
        },
      ],
    },
    "version",
  ],
  [
    "missing execute",
    { extensions: [{ name: "bad", tools: [{ ...read, execute: false }] }] },
    "execute",
  ],
  [
    "missing hook",
    {
      extensions: [
        {
          name: "bad",
          hooks: [{ task: "pi.generation", handlers: { beforeRequest: 1 } }],
        },
      ],
    },
    "function",
  ],
  [
    "missing profile selection",
    { profiles: { a: {} } },
    "extensions must be an array",
  ],
  [
    "unknown profile extension",
    { profiles: { a: { extensions: [extension], tools: [] } } },
    "unknown Extension",
  ],
  [
    "unknown tool",
    {
      extensions: [extension],
      profiles: { a: { extensions: [extension], tools: [{ ...read }] } },
    },
    "unknown/eclipsed tool",
  ],
  [
    "model filter widens",
    {
      extensions: [extension],
      profiles: {
        a: { extensions: [extension], tools: [read], modelTools: [write] },
      },
    },
    "unknown/eclipsed tool",
  ],
  [
    "invalid maxTurns",
    {
      extensions: [extension],
      profiles: { a: { extensions: [extension], tools: [], maxTurns: 1.1 } },
    },
    "maxTurns",
  ],
  [
    "old model id",
    {
      extensions: [extension],
      profiles: {
        a: {
          extensions: [extension],
          tools: [],
          model: { provider: "test", id: "old" },
        },
      },
    },
    "unsupported properties",
  ],
  ["unknown default", { defaultProfile: "missing" }, "Unknown defaultProfile"],
  ["missing callback", { conversationCreated: true }, "function"],
] as const) {
  test(`rejects ${name} before applying any adapters`, () => {
    expect(() => validateConfig(config(runtime))).toThrow(message);
  });
}

test("last-selected native tool wins across extensions and actual callable permissions include nested-only tools", () => {
  const later = { ...write, name: "read" };
  const second = defineExtension({ name: "second", tools: [later] });
  const value = validateConfig(
    config({
      extensions: [extension, second],
      profiles: {
        main: {
          extensions: [extension, second],
          tools: [later, write],
          modelTools: [later],
        },
        research: {
          extensions: [extension],
          tools: [read],
          modelTools: [read],
        },
      },
    }),
  );
  const main = value.runtime?.profiles?.main;
  const research = value.runtime?.profiles?.research;
  if (!main || !research) throw new Error("Missing profiles");
  expect(effectiveProfileTools(main).model.map((tool) => tool.name)).toEqual([
    "read",
  ]);
  expect(effectiveProfileTools(main).callable.map((tool) => tool.name)).toEqual(
    ["read", "write"],
  );
  expect(effectiveProfileTools(research).callable).toEqual([read]);
});

test("host keys remain separate, IDs are namespaced and builtin IDs reserved; unknown ui is not ignored", () => {
  const command = {
    id: "example.refresh",
    title: "Refresh",
    scope: "global",
    run() {},
  };
  const result = validateConfig({
    apiVersion: 2,
    commands: [command],
    keymaps: [
      { keys: "ctrl+k", command: command.id, when: "chat" },
      { keys: "ctrl+r", command: "config.reload", when: "chat" },
    ],
  });
  expect(result.keymaps?.[0]).toEqual({
    keys: "Ctrl+K",
    command: "example.refresh",
    when: "chat",
  });
  for (const id of ["refresh", "config.reload", "settings.open"])
    expect(() =>
      validateConfig({ apiVersion: 2, commands: [{ ...command, id }] }),
    ).toThrow();
  expect(() =>
    validateConfig({ apiVersion: 2, commands: [command, command] }),
  ).toThrow("Duplicate command");
  expect(() =>
    validateConfig({
      apiVersion: 2,
      keymaps: [{ keys: "ctrl+k", command: "unknown.command", when: "chat" }],
    }),
  ).toThrow("unknown host command");
  expect(() => validateConfig({ apiVersion: 2, ui: {} })).toThrow(
    "unsupported properties",
  );
  expect(() =>
    validateConfig({
      apiVersion: 1,
      runtime: {},
      sessionAdapters: [
        {
          connect() {
            throw new Error("never executes");
          },
        },
      ],
    }),
  ).toThrow("migrate");
});

test("native providers are structurally checked without resolving credentials, fetching catalogs or streaming", () => {
  const never = () => {
    throw new Error("Provider must remain offline");
  };
  const provider = {
    id: "offline",
    name: "Offline",
    auth: { apiKey: { name: "Offline", resolve: never } },
    getModels: never,
    stream: never,
    streamSimple: never,
  };
  expect(
    validateConfig(config({ providers: [provider] })).runtime?.providers?.[0],
  ).toBe(provider);
  expect(() =>
    validateConfig(config({ providers: [provider, provider] })),
  ).toThrow("Duplicate provider");
  expect(() =>
    validateConfig(
      config({ providers: [{ ...provider, auth: { apiKey: {} } }] }),
    ),
  ).toThrow("resolve");
  expect(() =>
    validateConfig(config({ providers: [{ ...provider, stream: null }] })),
  ).toThrow("stream");
});

test("preserves synchronous and asynchronous provider/resource factories without invoking them", () => {
  let providerCalls = 0;
  let resourceCalls = 0;
  const createProvider: ProviderFactory = () => {
    providerCalls++;
    throw new Error("Provider factories must remain offline during validation");
  };
  const createProviderAsync: ProviderFactory = async (context) =>
    createProvider(context);
  const selectResources: NonNullable<RuntimeConfig["resources"]> = () => {
    resourceCalls++;
    return { project: { instructions: [], skills: [], prompts: [] } };
  };
  const selectResourcesAsync: NonNullable<RuntimeConfig["resources"]> = async (
    workspace,
  ) => selectResources(workspace);
  const providerFactories = Object.freeze([
    createProvider,
    createProviderAsync,
  ]);
  for (const resources of [selectResources, selectResourcesAsync]) {
    const value = validateConfig(config({ providerFactories, resources }));
    expect(value.runtime?.providerFactories).toHaveLength(2);
    expect(value.runtime?.providerFactories?.[0]).toBe(createProvider);
    expect(value.runtime?.providerFactories?.[1]).toBe(createProviderAsync);
    expect(value.runtime?.resources).toBe(resources);
  }
  expect(providerCalls).toBe(0);
  expect(resourceCalls).toBe(0);
});

test("provider factory arrays are optional and bounded to 128 entries", () => {
  const factory = () => {
    throw new Error("Not invoked");
  };
  expect(validateConfig(config({})).runtime?.providerFactories).toBeUndefined();
  expect(validateConfig(config({})).runtime?.resources).toBeUndefined();
  expect(
    validateConfig(config({ providerFactories: [] })).runtime
      ?.providerFactories,
  ).toEqual([]);
  expect(
    validateConfig(config({ providerFactories: Array(128).fill(factory) }))
      .runtime?.providerFactories,
  ).toHaveLength(128);
  expect(() =>
    validateConfig(config({ providerFactories: Array(129).fill(factory) })),
  ).toThrow(
    "runtime.providerFactories must be an array of at most 128 entries",
  );
  expect(() => validateConfig(config({ providerFactories: Array(1) }))).toThrow(
    "runtime.providerFactories[0] must be a function",
  );
  for (const providerFactories of [null, false, 1, "factory", {}, factory])
    expect(() => validateConfig(config({ providerFactories }))).toThrow(
      "runtime.providerFactories must be an array",
    );
});

test("rejects non-function provider factories and resource selectors", () => {
  for (const value of [null, false, 1, "factory", {}, [], undefined]) {
    expect(() =>
      validateConfig(config({ providerFactories: [value] })),
    ).toThrow("runtime.providerFactories[0] must be a function");
    if (value !== undefined)
      expect(() => validateConfig(config({ resources: value }))).toThrow(
        "runtime.resources must be a function",
      );
  }
});

test("provider/resource additions do not allow unknown runtime properties", () => {
  expect(() =>
    validateConfig(
      config({
        providerFactories: [],
        resources: () => ({}),
        resourcePaths: [],
      }),
    ),
  ).toThrow("runtime has unsupported properties");
});
