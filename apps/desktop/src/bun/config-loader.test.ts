import { afterEach, expect, test } from "bun:test";
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
  expect(loader.config).toEqual({ apiVersion: 1 });
  await writeFile(
    join(root, "pig.config.ts"),
    "throw new Error('must not discover');",
  );
  expect(await loader.reload()).toBe(true);
  expect(loader.error).toBeUndefined();
  await writeFile(
    file,
    `export default { apiVersion: 1, sessionAdapters: [${adapter}] };`,
  );
  expect(await loader.reload()).toBe(true);
  await writeFile(file, "export default { apiVersion: 2 };");
  expect(await loader.reload()).toBe(false);
  await rm(file);
  expect(await loader.reload()).toBe(true);
  expect(loader.config).toEqual({ apiVersion: 1 });
  expect(loader.error).toBeUndefined();
});

test("bundles TypeScript, relative imports, and virtual @pig/config; reload sees nested edits", async () => {
  const source = `
    import { defineConfig, type PigConfig } from '@pig/config';
    import { adapter } from './child';
    const config: PigConfig = { apiVersion: 1, sessionAdapters: [adapter],
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
    export default { apiVersion: 1, sessionAdapters: [{ id, connect() {} }] };
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
    `export default { apiVersion: 1, sessionAdapters: [${adapter}] };`,
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
    "throw new Error('evaluation exploded'); export default { apiVersion: 1 };",
  );
  expect(await loader.reload()).toBe(false);
  expect(loader.config).toBe(previous);
  expect(loader.error).toContain("evaluation exploded");
  expect(
    (await readdir(root)).filter((name) =>
      name.startsWith(".pig-config-cache-"),
    ),
  ).toEqual([]);
  await writeFile(file, "export default { apiVersion: 1 };");
  expect(await loader.reload()).toBe(true);
  expect(loader.error).toBeUndefined();
});

const invalid: [string, string, string][] = [
  ["API version", "{ apiVersion: '1' }", "apiVersion"],
  [
    "duplicate ids",
    `{ apiVersion: 1, sessionAdapters: [${adapter}, ${adapter}] }`,
    "Duplicate adapter id",
  ],
  [
    "empty id",
    "{ apiVersion: 1, sessionAdapters: [{ id: ' ', connect() {} }] }",
    ".id",
  ],
  [
    "long id",
    "{ apiVersion: 1, sessionAdapters: [{ id: 'x'.repeat(129), connect() {} }] }",
    ".id",
  ],
  [
    "missing connect",
    "{ apiVersion: 1, sessionAdapters: [{ id: 'demo' }] }",
    "connect",
  ],
  [
    "adapter count",
    "{ apiVersion: 1, sessionAdapters: Array.from({length:129}, (_, i) => ({ id: String(i), connect() {} })) }",
    "at most 128",
  ],
  [
    "keymap count",
    "{ apiVersion: 1, keymaps: Array(513).fill({}) }",
    "at most 512",
  ],
  [
    "non-array adapters",
    "{ apiVersion: 1, sessionAdapters: {} }",
    "must be an array",
  ],
  [
    "sparse adapters",
    "{ apiVersion: 1, sessionAdapters: Array(1) }",
    "must be an object",
  ],
  [
    "sparse keymaps",
    "{ apiVersion: 1, keymaps: Array(1) }",
    "must be an object",
  ],
  [
    "object properties",
    "{ apiVersion: 1, surprise: true }",
    "unsupported properties",
  ],
  [
    "invalid key",
    `{ apiVersion: 1, sessionAdapters: [${adapter}], keymaps: [{...${binding}, keys: 'ctrl+ctrl+k'}] }`,
    "valid key combination",
  ],
  [
    "duplicate normalized keys",
    `{ apiVersion: 1, sessionAdapters: [${adapter}], keymaps: [${binding}, {...${binding}, keys: 'Ctrl+K'}] }`,
    "Duplicate keymap conflict",
  ],
  [
    "unknown adapter",
    `{ apiVersion: 1, keymaps: [${binding}] }`,
    "unknown adapter",
  ],
  [
    "invalid scope",
    `{ apiVersion: 1, sessionAdapters: [${adapter}], keymaps: [{...${binding}, when: 'global'}] }`,
    ".when",
  ],
  [
    "empty command",
    `{ apiVersion: 1, sessionAdapters: [${adapter}], keymaps: [{...${binding}, command: ''}] }`,
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
      `export default { apiVersion: 1, sessionAdapters: [${adapter}] };`,
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
    const config = { apiVersion: 1, sessionAdapters: [adapter], keymaps: [keymap, {...keymap, when: 'panel'}] };
    adapter.connect = () => {
      adapter.id = 'mutated'; keymap.command = 'mutated';
      config.apiVersion = 2; config.sessionAdapters.length = 0; config.keymaps.length = 0;
    };
    export default config;
  `);
  expect(await loader.reload()).toBe(true);
  const connect = loader.config.sessionAdapters?.[0].connect;
  if (!connect) throw new Error("Missing test adapter");
  await connect({} as Parameters<typeof connect>[0]);
  expect(loader.config.apiVersion).toBe(1);
  expect(loader.config.sessionAdapters).toHaveLength(1);
  expect(loader.config.sessionAdapters?.[0].id).toBe("demo");
  expect(loader.config.sessionAdapters?.[0].connect).toBe(connect);
  expect(loader.config.keymaps).toHaveLength(2);
  expect(loader.config.keymaps?.[0].command).toBe("run");
});
