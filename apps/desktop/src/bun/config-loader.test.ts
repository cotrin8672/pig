import { afterEach, expect, spyOn, test } from "bun:test";
import * as filesystem from "node:fs/promises";
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai";
import {
  createRegistry,
  Harness,
  MemoryStorage,
} from "@earendil-works/pi-durable";
import { ConfigLoader } from "./config-loader";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});

async function fixture(source?: string) {
  const root = await mkdtemp(
    join(process.env.PI_SCRATCH_DIR || tmpdir(), "pig-config-test-"),
  );
  roots.push(root);
  const file = join(root, "config.ts");
  if (source !== undefined) await writeFile(file, source);
  return { root, file, loader: new ConfigLoader(file) };
}

const adapter = `{ id: "demo", connect() {} }`;
const binding = `{ keys: "ctrl+k", adapter: "demo", command: "run", when: "chat" }`;

test("absent explicit config is empty, never discovers project files, and clears errors", async () => {
  const { root, file, loader } = await fixture();
  expect(loader.config).toEqual({ apiVersion: 2 });
  await writeFile(
    join(root, "pig.config.ts"),
    "throw new Error('must not discover');",
  );
  expect(await loader.reload()).toBe(true);
  expect(loader.error).toBeUndefined();
  await writeFile(
    file,
    `export default { apiVersion: 2, sessionAdapters: [${adapter}] };`,
  );
  expect(await loader.reload()).toBe(true);
  await writeFile(file, "export default { apiVersion: 1 };");
  expect(await loader.reload()).toBe(false);
  expect(loader.error).toContain("migrate to apiVersion: 2");
  await rm(file);
  expect(await loader.reload()).toBe(true);
  expect(loader.config).toEqual({ apiVersion: 2 });
  expect(loader.error).toBeUndefined();
});

test("bundles TypeScript, relative imports, and virtual @pig/config; reload sees nested edits", async () => {
  const source = `
    import { defineConfig, type PigConfig } from '@pig/config';
    import { adapter } from './child';
    const config: PigConfig = { apiVersion: 2, sessionAdapters: [adapter],
      keymaps: [{ keys: 'shift+ctrl+k', adapter: adapter.id, command: 'run', when: 'chat' }] };
    export default defineConfig(config);
  `;
  const { root, file, loader } = await fixture(source);
  await writeFile(
    join(root, "child.ts"),
    "import { id } from './nested'; export const adapter = { id, connect() {} };",
  );
  await writeFile(
    join(root, "nested.ts"),
    "export const id: string = 'first';",
  );
  expect(await loader.reload()).toBe(true);
  expect(loader.error).toBeUndefined();
  expect(loader.config.sessionAdapters?.[0]?.id).toBe("first");
  expect(loader.config.keymaps?.[0]?.keys).toBe("Ctrl+Shift+K");
  await writeFile(
    join(root, "nested.ts"),
    "export const id: string = 'second';",
  );
  expect(await loader.reload()).toBe(true);
  expect(loader.config.sessionAdapters?.[0]?.id).toBe("second");
  expect(await readFile(file, "utf8")).toBe(source);
  expect(
    (await readdir(root)).filter((name) =>
      name.startsWith(".pig-config-cache-"),
    ),
  ).toEqual([]);
});

test("runtime packages resolve from the user's node_modules, not the desktop or a data URL", async () => {
  const { root, loader } = await fixture(`
    import { id } from 'pig-config-fixture-package';
    export default { apiVersion: 2, sessionAdapters: [{ id, connect() {} }] };
  `);
  const pkg = join(root, "node_modules", "pig-config-fixture-package");
  await mkdir(pkg, { recursive: true });
  await writeFile(
    join(pkg, "package.json"),
    JSON.stringify({
      name: "pig-config-fixture-package",
      type: "module",
      exports: "./index.js",
    }),
  );
  await writeFile(join(pkg, "index.js"), "export const id = 'user-package';");
  expect(await loader.reload()).toBe(true);
  expect(loader.config.sessionAdapters?.[0]?.id).toBe("user-package");
});

test("syntax and evaluation failures preserve prior config and report file/build diagnostics", async () => {
  const { root, file, loader } = await fixture(
    `export default { apiVersion: 2, sessionAdapters: [${adapter}] };`,
  );
  expect(await loader.reload()).toBe(true);
  const previous = loader.config;
  await writeFile(file, "export default { apiVersion: ; }");
  expect(await loader.reload()).toBe(false);
  expect(loader.config).toBe(previous);
  expect(loader.error).toContain(file);
  expect(loader.error).toMatch(/expected|unexpected|syntax/i);
  await writeFile(
    file,
    "throw new Error('evaluation exploded'); export default { apiVersion: 2 };",
  );
  expect(await loader.reload()).toBe(false);
  expect(loader.config).toBe(previous);
  expect(loader.error).toContain("evaluation exploded");
  expect(
    (await readdir(root)).filter((name) =>
      name.startsWith(".pig-config-cache-"),
    ),
  ).toEqual([]);
  await writeFile(file, "export default { apiVersion: 2 };");
  expect(await loader.reload()).toBe(true);
  expect(loader.error).toBeUndefined();
});

const invalid: [string, string, string][] = [
  ["API version", "{ apiVersion: '2' }", "apiVersion"],
  [
    "duplicate ids",
    `{ apiVersion: 2, sessionAdapters: [${adapter}, ${adapter}] }`,
    "Duplicate adapter id",
  ],
  [
    "empty id",
    "{ apiVersion: 2, sessionAdapters: [{ id: ' ', connect() {} }] }",
    ".id",
  ],
  [
    "long id",
    "{ apiVersion: 2, sessionAdapters: [{ id: 'x'.repeat(129), connect() {} }] }",
    ".id",
  ],
  [
    "missing connect",
    "{ apiVersion: 2, sessionAdapters: [{ id: 'demo' }] }",
    "connect",
  ],
  [
    "adapter count",
    "{ apiVersion: 2, sessionAdapters: Array.from({length:129}, (_, i) => ({ id: String(i), connect() {} })) }",
    "at most 128",
  ],
  [
    "keymap count",
    "{ apiVersion: 2, keymaps: Array(513).fill({}) }",
    "at most 512",
  ],
  [
    "non-array adapters",
    "{ apiVersion: 2, sessionAdapters: {} }",
    "must be an array",
  ],
  [
    "sparse adapters",
    "{ apiVersion: 2, sessionAdapters: Array(1) }",
    "must be an object",
  ],
  [
    "sparse keymaps",
    "{ apiVersion: 2, keymaps: Array(1) }",
    "must be an object",
  ],
  [
    "object properties",
    "{ apiVersion: 2, surprise: true }",
    "unsupported properties",
  ],
  [
    "invalid key",
    `{ apiVersion: 2, sessionAdapters: [${adapter}], keymaps: [{...${binding}, keys: 'ctrl+ctrl+k'}] }`,
    "valid key combination",
  ],
  [
    "duplicate normalized keys",
    `{ apiVersion: 2, sessionAdapters: [${adapter}], keymaps: [${binding}, {...${binding}, keys: 'Ctrl+K'}] }`,
    "Duplicate keymap conflict",
  ],
  [
    "unknown adapter",
    `{ apiVersion: 2, keymaps: [${binding}] }`,
    "unknown adapter",
  ],
  [
    "invalid scope",
    `{ apiVersion: 2, sessionAdapters: [${adapter}], keymaps: [{...${binding}, when: 'global'}] }`,
    ".when",
  ],
  [
    "empty command",
    `{ apiVersion: 2, sessionAdapters: [${adapter}], keymaps: [{...${binding}, command: ''}] }`,
    ".command",
  ],
];
for (const [name, value, diagnostic] of invalid) {
  test(`rejects ${name} initially and on reload without replacing config`, async () => {
    const { file, loader } = await fixture(`export default ${value};`);
    const initial = loader.config;
    expect(await loader.reload()).toBe(false);
    expect(loader.config).toBe(initial);
    expect(loader.error).toContain(file);
    expect(loader.error).toContain(diagnostic);
    await writeFile(
      file,
      `export default { apiVersion: 2, sessionAdapters: [${adapter}] };`,
    );
    expect(await loader.reload()).toBe(true);
    const previous = loader.config;
    await writeFile(file, `export default ${value};`);
    expect(await loader.reload()).toBe(false);
    expect(loader.config).toBe(previous);
  });
}

test("clones all config containers while retaining functions and permits distinct scopes", async () => {
  const { loader } = await fixture(`
    const adapter = ${adapter};
    const keymap = ${binding};
    const config = { apiVersion: 2, sessionAdapters: [adapter], keymaps: [keymap, {...keymap, when: 'panel'}] };
    adapter.connect = () => {
      adapter.id = 'mutated'; keymap.command = 'mutated';
      config.apiVersion = 3; config.sessionAdapters.length = 0; config.keymaps.length = 0;
    };
    export default config;
  `);
  expect(await loader.reload()).toBe(true);
  const connect = loader.config.sessionAdapters?.[0].connect;
  if (!connect) throw new Error("Missing test adapter");
  await connect({} as Parameters<typeof connect>[0]);
  expect(loader.config.apiVersion).toBe(2);
  expect(loader.config.sessionAdapters).toHaveLength(1);
  expect(loader.config.sessionAdapters?.[0].id).toBe("demo");
  expect(loader.config.sessionAdapters?.[0].connect).toBe(connect);
  expect(loader.config.keymaps).toHaveLength(2);
  expect(loader.config.keymaps?.[0].command).toBe("run");
});

test("prepare, pending/rejected apply and retry preserve accepted config and adapter generation until atomic publication", async () => {
  const { file, loader } = await fixture(
    `export default { apiVersion: 2, sessionAdapters: [${adapter}] };`,
  );
  expect(await loader.reload()).toBe(true);
  const previous = loader.config;
  const accepted = loader.accepted;
  await writeFile(
    file,
    `export default { apiVersion: 2, runtime: { extensions: [] }, sessionAdapters: [{id:'new',connect(){}}] };`,
  );
  const candidate = await loader.prepare();
  if (!candidate) throw new Error(loader.error);
  expect(loader.config).toBe(previous);
  expect(candidate.revision).not.toBe(accepted?.revision);
  expect(await loader.accept(candidate)).toBe(false);
  expect(loader.status).toBe("pending");
  expect(loader.config).toBe(previous);
  let generation = "old";
  expect(
    await loader.accept(candidate, () => ({
      status: "pending",
      reason:
        "Sleeping/background child and approval still own old definitions",
    })),
  ).toBe(false);
  expect(generation).toBe("old");
  expect(loader.accepted).toBe(accepted);
  expect(
    await loader.accept(candidate, () => ({
      status: "rejected",
      reason: "Opaque document schema compatibility unproven",
    })),
  ).toBe(false);
  let released = 0;
  expect(
    await loader.accept(candidate, () => ({
      status: "ready",
      apply() {
        throw new Error("staging failed");
      },
      release() {
        released++;
      },
    })),
  ).toBe(false);
  expect(loader.config).toBe(previous);
  expect(released).toBe(1);
  expect(
    await loader.accept(candidate, () => ({
      status: "ready",
      apply() {
        generation = "new";
      },
      release() {
        released++;
      },
    })),
  ).toBe(true);
  expect(generation).toBe("new");
  expect(loader.config).toBe(candidate.config);
  expect(released).toBe(2);
  expect(await loader.accept(candidate)).toBe(false);
  expect(loader.error).toContain("STALE_CONFIG_CANDIDATE");
  await rm(file);
  expect(await loader.reload()).toBe(false); // Removing runtime is a runtime change too.
  expect(loader.config).toBe(candidate.config);
  await loader.discard();
});

test("source 1 MiB and bundle 4 MiB limits retain last-good and clean candidate artifacts", async () => {
  const { root, file, loader } = await fixture(
    "export default {apiVersion:2};",
  );
  expect(await loader.reload()).toBe(true);
  const previous = loader.config;
  await writeFile(
    file,
    `/*${"x".repeat(1024 * 1024)}*/ export default {apiVersion:2};`,
  );
  expect(await loader.reload()).toBe(false);
  expect(loader.error).toContain("source exceeds 1 MiB");
  await writeFile(
    join(root, "large.ts"),
    `export const huge = '${"x".repeat(4 * 1024 * 1024)}';`,
  );
  await writeFile(
    file,
    "import {huge} from './large'; export default {apiVersion:2, sessionAdapters:[{id:'large',connect(){return huge;}}]};",
  );
  expect(await loader.reload()).toBe(false);
  expect(loader.error).toContain("bundle exceeds 4 MiB");
  expect(loader.config).toBe(previous);
  expect(
    (await readdir(root)).filter((name) =>
      name.startsWith(".pig-config-cache-"),
    ),
  ).toEqual([]);
});

async function packageAt(
  root: string,
  name: string,
  source: string,
  fields: Record<string, unknown> = {},
) {
  const directory = join(root, "node_modules", ...name.split("/"));
  await mkdir(directory, { recursive: true });
  await writeFile(
    join(directory, "package.json"),
    JSON.stringify({
      name,
      version: "1.0.0",
      type: "module",
      exports: "./index.js",
      ...fields,
    }),
  );
  await writeFile(join(directory, "index.js"), source);
  return directory;
}

test("explicit managed moduleRoot is queried each prepare; installation does not discover or load extra modules", async () => {
  const { root, file } = await fixture(
    "import {id} from 'managed'; export default {apiVersion:2,sessionAdapters:[{id,connect(){}}]};",
  );
  const first = join(root, "extensions", "first");
  const second = join(root, "extensions", "second");
  await packageAt(first, "managed", "export const id='first';");
  await packageAt(second, "managed", "export const id='second';");
  await packageAt(
    first,
    "not-selected",
    "throw new Error('must not discover');",
  );
  let current = first;
  const loader = new ConfigLoader(file, { moduleRoot: () => current });
  expect(await loader.reload()).toBe(true);
  expect(loader.config.sessionAdapters?.[0].id).toBe("first");
  expect(
    loader.accepted?.dependencies.some((dep) => dep.name === "managed"),
  ).toBe(true);
  current = second;
  expect(await loader.reload()).toBe(true);
  expect(loader.config.sessionAdapters?.[0].id).toBe("second");
});

test("external packages' internal core copies are rejected despite a host-resolving entry hook", async () => {
  const { root, file } = await fixture(
    "import {defineExtension} from '@earendil-works/pi-durable'; import {id} from 'native-extension'; export default {apiVersion:2, runtime:{extensions:[defineExtension({name:id})]}};",
  );
  const extension = await packageAt(
    root,
    "native-extension",
    "import '@earendil-works/pi-durable'; export const id='native';",
  );
  await packageAt(
    extension,
    "@earendil-works/pi-durable",
    "throw new Error('must not evaluate duplicate');",
    { version: "1.5.0" },
  );
  const loader = new ConfigLoader(file, {
    resolveModule: (id, from) =>
      Bun.resolveSync(
        id,
        id === "@earendil-works/pi-durable" ? import.meta.dir : from,
      ),
  });
  expect(await loader.reload()).toBe(false);
  expect(loader.error).toContain("Core realpath mismatch");
  expect(loader.error).not.toContain("must not evaluate duplicate");
  expect(loader.config).toEqual({ apiVersion: 2 });
});

test("core version and peer mismatches fail before package evaluation", async () => {
  for (const peer of [false, true]) {
    const { root, file } = await fixture(
      "import {id} from 'incompatible'; export default {apiVersion:2,sessionAdapters:[{id,connect(){}}]};",
    );
    const directory = await packageAt(
      root,
      "incompatible",
      peer
        ? "throw new Error('must not execute'); export const id='bad';"
        : "import '@earendil-works/pi-ai'; export const id='bad';",
      peer
        ? { peerDependencies: { "@earendil-works/pi-durable": "^2.0.0" } }
        : {},
    );
    if (!peer)
      await packageAt(
        directory,
        "@earendil-works/pi-ai",
        "throw new Error('must not execute');",
        { version: "1.4.0" },
      );
    const loader = new ConfigLoader(file);
    expect(await loader.reload()).toBe(false);
    expect(loader.error).toContain(
      peer ? "Core peer mismatch" : "Core version mismatch",
    );
    expect(loader.error).not.toContain("must not execute");
  }
});

test("external value-import @pig/config uses the actual v2 package and matching native core peers", async () => {
  const { root, loader } = await fixture(
    "import {config} from 'external-config'; export default config;",
  );
  const scope = join(root, "node_modules", "@pig");
  await mkdir(scope, { recursive: true });
  await symlink(
    resolve(import.meta.dir, "../../../../packages/config"),
    join(scope, "config"),
    "junction",
  );
  const coreScope = join(root, "node_modules", "@earendil-works");
  await mkdir(coreScope, { recursive: true });
  for (const name of ["pi-ai", "pi-durable", "chord"])
    await symlink(
      resolve(import.meta.dir, "../../node_modules/@earendil-works", name),
      join(coreScope, name),
      "junction",
    );
  await packageAt(
    root,
    "external-config",
    `import {defineConfig,viewActions} from '@pig/config'; export const config=defineConfig({apiVersion:2,sessionAdapters:[{id:'external-'+viewActions({kind:'status'}).length,connect(){}}]});`,
  );
  expect(await loader.reload()).toBe(true);
  expect(loader.error).toBeUndefined();
  expect(loader.config.sessionAdapters?.[0].id).toBe("external-0");
});

test("cache cleanup failure cannot publish candidate config or host generation", async () => {
  const { file, loader } = await fixture("export default {apiVersion:2};");
  expect(await loader.reload()).toBe(true);
  const previous = loader.config;
  await writeFile(
    file,
    "export default {apiVersion:2,runtime:{extensions:[]}};",
  );
  const candidate = await loader.prepare();
  if (!candidate) throw new Error(loader.error);
  let applied = false;
  let released = false;
  const remove = spyOn(filesystem, "rm").mockRejectedValueOnce(
    new Error("cleanup unavailable"),
  );
  try {
    expect(
      await loader.accept(candidate, () => ({
        status: "ready",
        apply() {
          applied = true;
        },
        release() {
          released = true;
        },
      })),
    ).toBe(false);
    expect(loader.error).toContain("cleanup unavailable");
    expect(loader.config).toBe(previous);
    expect(applied).toBe(false);
    expect(released).toBe(true);
  } finally {
    remove.mockRestore();
    await loader.discard(candidate);
  }
});

test("a user-native tool/section/hook/task profile loads into an empty Models and temporary Harness without model execution", async () => {
  const { file } = await fixture(`
    import {defineExtension,defineTool,defineTask,section,hook,GenerationTask} from '@earendil-works/pi-durable';
    const tool=defineTool({name:'observe',description:'Read-only observation',parameters:{type:'object'},async execute(){throw new Error('must not execute');}});
    const task=defineTask({name:'user.observe',version:1,initial:()=>({phase:'ready'}),phases:{ready:async()=>{}},abort:async()=>{}});
    const extension=defineExtension({name:'user.native',tools:[tool],sections:[section('user_policy',()=> 'Read only')],tasks:[task],hooks:[hook(GenerationTask,{beforeRequest(){return undefined;}})]});
    export default {apiVersion:2,runtime:{extensions:[extension],profiles:{research:{extensions:[extension],tools:[tool],modelTools:[tool],model:{provider:'offline',modelId:'not-connected'},thinkingLevel:'low',instructions:'Observe',cwd:'/temporary',maxTurns:3}},defaultProfile:'research'}};
  `);
  const loader = new ConfigLoader(file, {
    moduleRoot: resolve(import.meta.dir, "../.."),
  });
  const candidate = await loader.prepare();
  if (!candidate) throw new Error(loader.error);
  const registry = createRegistry();
  for (const extension of candidate.config.runtime?.extensions ?? [])
    registry.install(extension);
  const harness = await Harness.open(
    new MemoryStorage(),
    { registry, models: createModels(), settings: { extensions: [] } },
    BACKGROUND_CONTEXT,
  );
  try {
    const conversation = await harness.createConversation(
      {
        ownership: { kind: "ownerless" },
        agent: candidate.config.runtime?.profiles?.research,
      },
      BACKGROUND_CONTEXT,
    );
    const agent = await conversation.agent(BACKGROUND_CONTEXT);
    expect(agent.callable.map((tool) => tool.name)).toEqual(["observe"]);
    expect(agent.sections.map((section) => section.key)).toContain(
      "user_policy",
    );
    expect(agent).toMatchObject({
      model: { provider: "offline", modelId: "not-connected" },
      thinkingLevel: "low",
      instructions: "Observe",
      cwd: "/temporary",
      maxTurns: 3,
    });
    expect(registry.snapshot().task("user.observe")?.definition.version).toBe(
      1,
    );
    expect((await harness.inspect(BACKGROUND_CONTEXT)).scheduling).toBe(
      "paused",
    );
  } finally {
    await harness.close(BACKGROUND_CONTEXT);
    await loader.discard(candidate);
  }
});

test("audited external references preserve ESM default/live bindings and CommonJS defaults", async () => {
  const { root, file } = await fixture(
    "import prefix, {value,bump} from 'live-api'; import common from 'common-api'; bump(); export default {apiVersion:2,sessionAdapters:[{id:prefix+'-'+value+'-'+common.label,connect(){}}]};",
  );
  await packageAt(
    root,
    "live-api",
    "export let value=0; export function bump(){value++} export default 'live';",
  );
  await packageAt(root, "common-api", "module.exports={label:'common'};", {
    type: "commonjs",
  });
  const loader = new ConfigLoader(file);
  expect(await loader.reload()).toBe(true);
  expect(loader.config.sessionAdapters?.[0].id).toBe("live-1-common");
  expect(await loader.reload()).toBe(true);
  expect(loader.config.sessionAdapters?.[0].id).toBe("live-2-common");
});
