import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fauxProvider } from "@earendil-works/pi-ai";
import type { ProviderFactory } from "../../../../packages/config/src";
import {
  createApplicationConfigLoader,
  createConfigProviders,
} from "./application-config";
import { FileCredentials } from "./credentials";
import { createModelRuntime, releaseModelRuntime } from "./model-runtime";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
async function fixture(source: string) {
  if (!process.env.PI_SCRATCH_DIR) throw new Error("PI_SCRATCH_DIR required");
  const root = await mkdtemp(join(process.env.PI_SCRATCH_DIR, "app-config-"));
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  const file = join(root, "config.ts");
  await writeFile(file, source);
  const catalog = await createModelRuntime(
    new FileCredentials(join(root, "auth.json")),
    root,
  );
  cleanups.push(async () => {
    releaseModelRuntime(catalog);
  });
  let reads = 0;
  const manager = {
    root: join(root, "managed"),
    snapshot: async () => {
      reads++;
      return { packages: [] };
    },
    moduleLocation: async () => {
      throw new Error("No managed imports expected");
    },
  };
  const loader = createApplicationConfigLoader(file, manager, catalog);
  return { root, file, catalog, loader, manager, reads: () => reads };
}

test("provider factories receive explicit frozen scope and never share instances", async () => {
  const scopes: unknown[] = [];
  const factories: ProviderFactory[] = [
    async (scope) => {
      expect(Object.isFrozen(scope)).toBe(true);
      scopes.push(scope);
      return fauxProvider({ provider: "owned" }).provider;
    },
  ];
  const a = await createConfigProviders(factories, { scope: "catalog" });
  const b = await createConfigProviders(factories, {
    scope: "workspace",
    workspaceId: "a",
    cwd: "C:\\project-a",
  });
  expect(a[0]).not.toBe(b[0]);
  expect(scopes).toEqual([
    { scope: "catalog" },
    { scope: "workspace", workspaceId: "a", cwd: "C:\\project-a" },
  ]);
  const reused = fauxProvider().provider;
  await createConfigProviders([() => reused], { scope: "catalog" });
  await expect(
    createConfigProviders([() => reused], {
      scope: "workspace",
      workspaceId: "b",
      cwd: "C:\\project-b",
    }),
  ).rejects.toThrow("PROVIDER_INSTANCE_REUSED");
  await expect(
    createConfigProviders(
      [
        () => fauxProvider({ provider: "duplicate" }).provider,
        () => fauxProvider({ provider: "duplicate" }).provider,
      ],
      { scope: "catalog" },
    ),
  ).rejects.toThrow("Duplicate provider");
});

test("native config stages catalog providers with the Host gate and keeps last-good", async () => {
  const f = await fixture(`
    import {fauxProvider} from '@earendil-works/pi-ai';
    export default {apiVersion:2, runtime:{providerFactories:[() => fauxProvider({provider:'configured-native'}).provider]}};
  `);
  let applications = 0;
  expect(
    await f.loader.reload(async () => ({
      status: "pending",
      reason: "saved work",
    })),
  ).toBe(false);
  expect(f.catalog.getProvider("configured-native")).toBeUndefined();
  expect(
    await f.loader.reload(async () => ({
      status: "ready",
      apply: () => {
        applications++;
      },
    })),
  ).toBe(true);
  const provider = f.catalog.getProvider("configured-native");
  expect(provider).toBeDefined();
  expect(applications).toBe(1);
  await writeFile(
    f.file,
    "export default {apiVersion:2,runtime:{providerFactories:[() => {throw new Error('fixture factory failed');}]}};",
  );
  expect(
    await f.loader.reload(async () => ({
      status: "ready",
      apply: () => {
        applications++;
      },
    })),
  ).toBe(false);
  expect(f.loader.error).toContain("fixture factory failed");
  expect(f.catalog.getProvider("configured-native")).toBe(provider);
  expect(applications).toBe(1);
  await writeFile(f.file, "export default {apiVersion:2};");
  expect(await f.loader.reload(async () => ({ status: "ready" }))).toBe(true);
  expect(f.catalog.getProvider("configured-native")).toBeUndefined();
  expect(f.reads()).toBe(4);
});

test("raw shared providers cannot be published into the production catalog", async () => {
  const f = await fixture(
    "import {fauxProvider} from '@earendil-works/pi-ai'; export default {apiVersion:2,runtime:{providers:[fauxProvider().provider]}};",
  );
  let applied = false;
  expect(
    await f.loader.reload(async () => ({
      status: "ready",
      apply() {
        applied = true;
      },
    })),
  ).toBe(false);
  expect(applied).toBe(false);
  expect(f.loader.error).toContain("WORKSPACE_PROVIDER_FACTORY_REQUIRED");
});

test("explicit managed imports use one generation snapshot without acquiring packages", async () => {
  const f = await fixture(
    "import {commands} from 'local-fixture'; export default {apiVersion:2,commands};",
  );
  const generation = "fixture-generation";
  const directory = join(f.manager.root, "generations", generation);
  const packageDirectory = join(directory, "node_modules", "local-fixture");
  await mkdir(packageDirectory, { recursive: true });
  await writeFile(
    join(packageDirectory, "package.json"),
    JSON.stringify({
      name: "local-fixture",
      version: "1.0.0",
      type: "module",
      main: "index.js",
    }),
  );
  await writeFile(
    join(packageDirectory, "index.js"),
    "export const commands=[{id:'fixture.loaded',title:'Loaded',scope:'global',run(){}}];",
  );
  await writeFile(join(directory, "package.json"), "{}");
  let locations = 0,
    changed = false;
  const loader = createApplicationConfigLoader(
    f.file,
    {
      root: f.manager.root,
      snapshot: async () => ({
        generation,
        packages: [
          {
            source: "npm:local-fixture",
            request: "local-fixture@1.0.0",
            target: "local-fixture@1.0.0",
            name: "local-fixture",
            version: "1.0.0",
          },
        ],
      }),
      moduleLocation: async (source, expected) => {
        expect(source).toBe("npm:local-fixture");
        expect(expected).toBe(generation);
        locations++;
        if (changed) throw new Error("Managed package generation changed");
        return {
          generation,
          name: "local-fixture",
          directory: packageDirectory,
          resolveFrom: join(directory, "package.json"),
          corePaths: {} as never,
          compatibility: "unverified" as const,
        };
      },
    },
    f.catalog,
  );
  expect(await loader.reload(async () => ({ status: "ready" }))).toBe(true);
  expect(loader.config.commands?.[0]?.id).toBe("fixture.loaded");
  const accepted = loader.accepted;
  changed = true;
  expect(await loader.reload(async () => ({ status: "ready" }))).toBe(false);
  expect(loader.error).toContain("generation changed");
  expect(loader.accepted).toBe(accepted);
  expect(locations).toBe(2);
});
