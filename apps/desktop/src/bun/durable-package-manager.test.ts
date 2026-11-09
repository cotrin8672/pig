import { afterEach, expect, test } from "bun:test";
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { runCommand } from "./command-executor";
import type { DurableCatalogEntry } from "./durable-package-catalog";
import {
  DurablePackageManager,
  type HostModuleName,
  hostModuleNames,
  hostModuleVersions,
  PackageManagerError,
} from "./durable-package-manager";
import { packageOperation } from "./packages";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});
const commit = "a".repeat(40);
const ok = (stdout = "") => ({ stdout, stderr: "", exitCode: 0 });
const readJson = async (file: string) =>
  JSON.parse(await readFile(file, "utf8"));
const allowMutations = (manager: DurablePackageManager) =>
  manager.setMutationGuard(async () => () => {});
const directory = (manager: DurablePackageManager, id: string | undefined) =>
  join(manager.root, "generations", id as string);

async function fixture() {
  const root = await mkdtemp(
    join(process.env.PI_SCRATCH_DIR ?? tmpdir(), "durable-packages-"),
  );
  roots.push(root);
  const corePaths = {} as Record<HostModuleName, string>;
  for (const name of hostModuleNames) {
    const path = join(root, "host", name);
    await mkdir(path, { recursive: true });
    await writeFile(
      join(path, "package.json"),
      JSON.stringify({ name, version: hostModuleVersions[name] }),
    );
    corePaths[name] = path;
  }
  const calls: {
    program: string;
    args: readonly string[];
    options: Parameters<typeof runCommand>[2];
  }[] = [];
  const control = {
    version: "1.2.3",
    fail: "",
    throwSecret: false,
    duplicateCore: false,
    aliasCore: false,
    peer: "^1.5.0",
    configPeer: "^0.1.0",
    nativeDependency: false,
    invalidLock: false,
    malformedVersion: false,
    beforeInstall: undefined as (() => Promise<void>) | undefined,
  };
  const command: typeof runCommand = async (program, args, options) => {
    calls.push({ program, args, options });
    if (control.throwSecret)
      throw new Error(
        "https://token-secret@github.com/repo?token=token-secret",
      );
    if (control.fail && args.includes(control.fail))
      return {
        stdout: "token-secret",
        stderr: "_authToken=token-secret",
        exitCode: 1,
      };
    if (program === "git") {
      if (args.includes("rev-parse")) return ok(`${commit}\n`);
      if (args.includes("show"))
        return ok(
          JSON.stringify({
            name: "@personal/private",
            version: "0.2.0",
            peerDependencies: {
              "@earendil-works/pi-durable": control.peer,
              "@pig/config": control.configPeer,
            },
            scripts: { prepare: "must never run" },
          }),
        );
      if (args.includes("archive")) {
        const path = args.find((arg) => arg.startsWith("--output="))?.slice(9);
        if (!path) throw new Error("missing archive output");
        await writeFile(
          path,
          JSON.stringify({ name: "@personal/private", version: "0.2.0" }),
        );
      }
      return ok();
    }
    if (args[0] === "view")
      return ok(
        control.malformedVersion ? '"latest"' : JSON.stringify(control.version),
      );
    expect(program).toBe("npm");
    expect(args[0]).toBe("install");
    await control.beforeInstall?.();
    const cwd = options?.cwd;
    if (!cwd) throw new Error("missing workspace");
    const manifest = await readJson(join(cwd, "package.json"));
    const packages: Record<string, unknown> = { "": manifest };
    for (const [name, target] of Object.entries<string>(
      manifest.dependencies,
    )) {
      const version = target.startsWith("file:")
        ? (await readJson(join(cwd, target.slice(5)))).version
        : target;
      const packageDir = join(cwd, "node_modules", name);
      await mkdir(packageDir, { recursive: true });
      await writeFile(
        join(packageDir, "package.json"),
        JSON.stringify({
          name,
          version,
          description: "Installed data, not loaded code",
          keywords: ["pi-extension"],
          pi: { extensions: ["./must-not-import.js"] },
          peerDependencies: {
            "@earendil-works/pi-durable": control.peer,
            "@pig/config": control.configPeer,
          },
          ...(control.nativeDependency
            ? { dependencies: { "@earendil-works/pi-ai": "1.5.0" } }
            : {}),
          scripts: { postinstall: "must never run" },
        }),
      );
      await writeFile(
        join(packageDir, "index.js"),
        'throw new Error("PACKAGE CODE MUST NOT BE IMPORTED");',
      );
      packages[`node_modules/${name}`] = { version, resolved: target };
    }
    if (control.duplicateCore)
      packages["node_modules/extra/node_modules/@earendil-works/pi-durable"] = {
        version: "1.5.0",
      };
    if (control.aliasCore) {
      const alias = join(cwd, "node_modules", "disguised-core");
      await mkdir(alias, { recursive: true });
      await writeFile(
        join(alias, "package.json"),
        JSON.stringify({ name: "@earendil-works/pi-ai", version: "1.5.0" }),
      );
      packages["node_modules/disguised-core"] = { version: "1.5.0" };
    }
    if (control.invalidLock) packages["node_modules/../../outside"] = {};
    await writeFile(
      join(cwd, "package-lock.json"),
      JSON.stringify({ lockfileVersion: 3, packages }),
    );
    return ok();
  };
  const options = { root: join(root, "extensions"), corePaths, command };
  const manager = new DurablePackageManager(options);
  return { root, calls, control, options, manager, corePaths };
}

// Fake commands + disposable roots only: no registry/Git/credential access.
test("empty reads are lazy and do not create a workspace or invoke commands", async () => {
  const { manager, calls } = await fixture();
  expect(await manager.listInstalled()).toEqual([]);
  expect(await manager.snapshot()).toEqual({ packages: [] });
  await expect(stat(manager.root)).rejects.toThrow();
  expect(calls).toEqual([]);
});

test("manual npm pins dependencies, disables scripts, never infers compatibility or imports code", async () => {
  const { manager, calls, corePaths, root } = await fixture();
  const config = join(root, "config.ts");
  await writeFile(config, "// user configuration remains untouched");
  await manager.mutate("install", "npm:@personal/private@^1.2.0");
  const snapshot = await manager.snapshot();
  expect(snapshot.packages[0]).toMatchObject({
    source: "npm:@personal/private",
    request: "npm:@personal/private@^1.2.0",
    target: "npm:@personal/private@1.2.3",
    version: "1.2.3",
  });
  const path = directory(manager, snapshot.generation);
  expect((await readJson(join(path, "package.json"))).dependencies).toEqual({
    "@personal/private": "1.2.3",
  });
  expect(calls[0].args).toEqual([
    "view",
    "@personal/private@^1.2.0",
    "version",
    "--json",
    "--ignore-scripts",
    "--logs-max=0",
  ]);
  expect(calls[1].args).toContain("--ignore-scripts");
  expect(calls[1].args).toContain("--legacy-peer-deps");
  expect(calls[1].args).toContain("--bin-links=false");
  expect(calls[1].options?.env?.NPM_CONFIG_IGNORE_SCRIPTS).toBe("true");
  expect(calls[1].options?.timeout).toBe(120_000);
  const count = calls.length;
  expect((await manager.listInstalled())[0]).toMatchObject({
    types: [],
    updateAvailable: false,
  });
  const location = await manager.moduleLocation(
    "npm:@personal/private",
    snapshot.generation,
  );
  expect(location.compatibility).toBe("unverified");
  for (const name of hostModuleNames)
    expect(await realpath(join(path, "node_modules", name))).toBe(
      await realpath(corePaths[name]),
    );
  expect(await readFile(config, "utf8")).toBe(
    "// user configuration remains untouched",
  );
  const restarted = new DurablePackageManager({
    root: manager.root,
    corePaths,
    command: async () => {
      throw new Error("read must not spawn");
    },
  });
  expect(await restarted.snapshot()).toEqual(snapshot);
  expect(await restarted.listInstalled()).toEqual(
    await manager.listInstalled(),
  );
  expect(calls.length).toBe(count);
});

test("private-safe SSH fetch pins a commit and archives data without checkout/npm Git prepare", async () => {
  const { manager, calls } = await fixture();
  await manager.mutate(
    "install",
    "git@github.com:Personal/Private.git#feature/work",
  );
  const snapshot = await manager.snapshot();
  const entry = snapshot.packages[0];
  expect(entry).toMatchObject({
    source: "ssh://git@github.com/personal/private.git",
    request: "ssh://git@github.com/personal/private.git#feature/work",
    target: `ssh://git@github.com/personal/private.git#${commit}`,
    name: "@personal/private",
  });
  const fetch = calls.find((call) => call.args.includes("fetch"));
  expect(fetch?.args.slice(-3)).toEqual([
    "--",
    "ssh://git@github.com/personal/private.git",
    "feature/work",
  ]);
  expect(fetch?.options?.env?.GIT_TERMINAL_PROMPT).toBe("0");
  expect(fetch?.options?.env?.GCM_INTERACTIVE).toBe("Never");
  expect(fetch?.options?.env?.GIT_SSH_COMMAND).toContain("BatchMode=yes");
  expect(calls.find((call) => call.args.includes("archive"))?.args.at(-1)).toBe(
    commit,
  );
  expect(
    calls.some(
      (call) => call.args.includes("checkout") || call.args.includes("pack"),
    ),
  ).toBe(false);
  const path = directory(manager, snapshot.generation);
  expect(
    (await readJson(join(path, "package.json"))).dependencies[entry.name],
  ).toBe(`file:./${entry.artifact}`);
  const restarted = new DurablePackageManager({
    root: manager.root,
    command: async () => {
      throw new Error("offline");
    },
  });
  expect((await restarted.snapshot()).packages[0]).toEqual(entry);
  expect((await restarted.listInstalled())[0].types).toEqual([]);
});

test("fetch/install failure leaves pointer, lockfile and files intact, and queue recovers", async () => {
  const { manager, control } = await fixture();
  await manager.mutate("install", "example");
  allowMutations(manager);
  const before = await manager.snapshot();
  const pointer = await readFile(join(manager.root, "current.json"), "utf8");
  const prior = directory(manager, before.generation);
  const lock = await readFile(join(prior, "package-lock.json"), "utf8");
  const codePath = join(prior, "node_modules", "example", "index.js");
  const code = await readFile(codePath, "utf8");
  for (const failure of ["view", "install", "fetch"]) {
    control.fail = failure;
    const source =
      failure === "fetch" ? "https://github.com/a/private" : "other";
    if (failure !== "fetch")
      await expect(manager.mutate("update", "npm:example")).rejects.toThrow(
        "credentials",
      );
    await expect(manager.mutate("install", source)).rejects.toThrow(
      "credentials",
    );
    expect(await readFile(join(manager.root, "current.json"), "utf8")).toBe(
      pointer,
    );
    expect(await manager.snapshot()).toEqual(before);
    expect(await readFile(join(prior, "package-lock.json"), "utf8")).toBe(lock);
    expect(await readFile(codePath, "utf8")).toBe(code);
    expect(
      (await readdir(join(manager.root, "generations"))).filter((name) =>
        name.startsWith(".staging"),
      ),
    ).toEqual([]);
  }
  control.fail = "";
  control.version = "2.0.0";
  await manager.mutate("update", "npm:example");
  expect((await manager.snapshot()).packages[0].target).toBe(
    "npm:example@2.0.0",
  );
  expect(await readFile(join(prior, "package-lock.json"), "utf8")).toBe(lock);
});

test("in-use tasks and unknown safety refuse mutation before commands; lease lasts through commit", async () => {
  const { manager, calls, control } = await fixture();
  await manager.mutate("install", "example");
  const before = await manager.snapshot();
  const count = calls.length;
  for (const action of ["update", "uninstall", "install"] as const)
    await expect(manager.mutate(action, "npm:example")).rejects.toThrow(
      "safety has not been established",
    );
  expect(calls.length).toBe(count);
  manager.setMutationGuard(async () => {
    throw new PackageManagerError("Package is in use by a pending task");
  });
  const events: string[] = [];
  await expect(
    packageOperation(
      "uninstall",
      { opId: "busy", source: "npm:example" },
      (event) => {
        events.push(event.status);
      },
      () => {},
      () => {},
      manager,
    ),
  ).rejects.toThrow("in use");
  expect(events).toEqual(["running", "error"]);
  expect(await manager.snapshot()).toEqual(before);
  expect(calls.length).toBe(count);
  let leased = false;
  manager.setMutationGuard(async (request) => {
    expect(request).toEqual({
      action: "uninstall",
      currentGeneration: before.generation as string,
      sources: ["npm:example"],
    });
    leased = true;
    return () => {
      leased = false;
    };
  });
  control.beforeInstall = async () => {
    expect(leased).toBe(true);
    expect(await manager.snapshot()).toEqual(before);
  };
  await manager.mutate("uninstall", "npm:example");
  expect(leased).toBe(false);
  expect(await manager.listInstalled()).toEqual([]);
});

test("shared generations retain Git artifacts and prior files; guarded rollback is offline", async () => {
  const { manager, calls, control } = await fixture();
  await manager.mutate("install", "https://github.com/personal/private");
  const initial = await manager.snapshot();
  control.beforeInstall = async () => {
    expect(await manager.snapshot()).toEqual(initial);
  };
  await manager.mutate("install", "example");
  const next = await manager.snapshot();
  expect(next.previous).toBe(initial.generation);
  const path = directory(manager, next.generation);
  expect(
    await readFile(join(path, initial.packages[0].artifact as string), "utf8"),
  ).toContain("@personal/private");
  expect((await readJson(join(path, "package.json"))).dependencies).toEqual({
    "@personal/private": `file:./${initial.packages[0].artifact}`,
    example: "1.2.3",
  });
  await expect(manager.rollback()).rejects.toThrow("safety");
  allowMutations(manager);
  const count = calls.length;
  await manager.rollback();
  expect((await manager.snapshot()).generation).toBe(initial.generation);
  expect((await manager.snapshot()).packages).toEqual(initial.packages);
  expect(calls.length).toBe(count);
  await expect(
    manager.moduleLocation(
      "https://github.com/personal/private",
      next.generation,
    ),
  ).rejects.toThrow("generation changed");
});

test("catalog pins bare installs/updates; listing compares local targets without keyword inference", async () => {
  const { options, control, calls } = await fixture();
  const entry: DurableCatalogEntry = {
    nativeCore: "1.5.0",
    target: "npm:example@1.2.3",
    card: {
      name: "example",
      version: "1.2.3",
      description: "reviewed",
      date: "",
      monthlyDownloads: 0,
      types: ["extension"],
    },
  };
  const manager = new DurablePackageManager({ ...options, catalog: [entry] });
  await manager.mutate("install", "example");
  expect(calls[0].args[1]).toBe("example@1.2.3");
  entry.target = "npm:example@2.0.0";
  const count = calls.length;
  expect((await manager.listInstalled())[0]).toMatchObject({
    updateAvailable: true,
    types: [],
  });
  expect(calls.length).toBe(count);
  control.version = "2.0.0";
  allowMutations(manager);
  await manager.mutate("update", "npm:example");
  expect((await manager.snapshot()).packages[0].target).toBe(
    "npm:example@2.0.0",
  );
  expect((await manager.listInstalled())[0].updateAvailable).toBe(false);
});

test("duplicate/incompatible native core and unsafe metadata fail closed", async () => {
  for (const variant of [
    "duplicate",
    "alias",
    "peer",
    "config-peer",
    "dependency",
    "lock",
    "version",
  ]) {
    const { manager, control } = await fixture();
    if (variant === "duplicate") control.duplicateCore = true;
    if (variant === "alias") control.aliasCore = true;
    if (variant === "peer") control.peer = "^2.0.0";
    if (variant === "config-peer") control.configPeer = "^2.0.0";
    if (variant === "dependency") control.nativeDependency = true;
    if (variant === "lock") control.invalidLock = true;
    if (variant === "version") control.malformedVersion = true;
    await expect(manager.mutate("install", "example")).rejects.toThrow();
    expect(await manager.snapshot()).toEqual({ packages: [] });
  }
});

test("operation events distinguish install from load and never leak subprocess output/tokens", async () => {
  const { manager, control } = await fixture();
  const events: string[] = [];
  let notified = 0;
  const operate = () =>
    packageOperation(
      "install",
      { opId: "op", name: "example" },
      (event) => {
        events.push(event.status);
        expect(JSON.stringify(event)).not.toContain("token-secret");
      },
      () => {
        notified++;
      },
      () => {},
      manager,
    );
  control.fail = "view";
  await expect(operate()).rejects.toThrow("credentials");
  expect(events).toEqual(["running", "error"]);
  control.fail = "";
  control.throwSecret = true;
  await expect(operate()).rejects.toThrow("RTK");
  control.throwSecret = false;
  await operate();
  expect(events).toEqual([
    "running",
    "error",
    "running",
    "error",
    "running",
    "done",
  ]);
  expect(notified).toBe(1);
});
