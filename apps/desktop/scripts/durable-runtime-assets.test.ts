import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import config from "../electrobun.config";
import {
  copyDurableRuntime,
  DURABLE_NATIVE_ROOTS,
  DURABLE_RUNTIME_EXTERNALS,
  DURABLE_RUNTIME_MANIFEST,
  DURABLE_RUNTIME_ROOTS,
  DURABLE_RUNTIME_STAGE,
  stageDurableRuntime,
} from "./durable-runtime-assets";

const fixtures: string[] = [];
afterEach(() => {
  for (const path of fixtures.splice(0))
    rmSync(path, { recursive: true, force: true });
});
function fixture() {
  const root = mkdtempSync(
    join(process.env.PI_SCRATCH_DIR ?? tmpdir(), "durable-copy-test-"),
  );
  fixtures.push(root);
  const projectDir = join(root, "project");
  const installRoot = join(projectDir, "node_modules");
  mkdirSync(installRoot, { recursive: true });
  return {
    root,
    projectDir,
    installRoot,
    destination: join(root, "payload"),
    roots: ["runtime-fixture"],
  };
}
function pkg(path: string, name: string, version = "1.0.0", extra = {}) {
  mkdirSync(path, { recursive: true });
  writeFileSync(
    join(path, "package.json"),
    JSON.stringify({ name, version, main: "index.js", ...extra }),
  );
  writeFileSync(
    join(path, "index.js"),
    `module.exports=${JSON.stringify(version)};`,
  );
  return path;
}
function link(target: string, path: string) {
  mkdirSync(dirname(path), { recursive: true });
  symlinkSync(resolve(target), path, "junction");
}
function noLinks(path: string) {
  expect(lstatSync(path).isSymbolicLink()).toBe(false);
  if (lstatSync(path).isDirectory())
    for (const child of readdirSync(path)) noLinks(join(path, child));
}
function nativeFixture() {
  const f = fixture();
  for (const name of DURABLE_RUNTIME_ROOTS)
    pkg(
      join(f.installRoot, name),
      name,
      name === "@pig/config" ? "0.1.0" : "1.5.0",
    );
  return { ...f, stage: join(f.projectDir, DURABLE_RUNTIME_STAGE) };
}

describe("Durable runtime production packaging", () => {
  test("Electrobun wires native roots, assets, manifest and existing native hook", () => {
    expect(config.build.bun.external).toEqual(DURABLE_RUNTIME_EXTERNALS);
    expect(DURABLE_RUNTIME_ROOTS).toEqual([
      "@earendil-works/pi-durable",
      "@earendil-works/pi-ai",
      "@earendil-works/chord",
      "@pig/config",
    ]);
    expect(DURABLE_RUNTIME_EXTERNALS).toContain("@silvia-odwyer/photon/*");
    expect(DURABLE_RUNTIME_EXTERNALS).toContain(
      "@earendil-works/pi-codemode/*",
    );
    expect(config.build.copy[`${DURABLE_RUNTIME_STAGE}/node_modules`]).toBe(
      "node_modules",
    );
    expect(
      config.build.copy[`${DURABLE_RUNTIME_STAGE}/${DURABLE_RUNTIME_MANIFEST}`],
    ).toBe(DURABLE_RUNTIME_MANIFEST);
    expect(config.scripts.preBuild).toBe("scripts/durable-runtime-assets.ts");
    expect(config.scripts.postBuild).toBe("scripts/windows-native.ts");
    expect(config.build.win.bundleCEF).toBe(false);
    expect(config.app.identifier).toBe("dev.piris.desktop");
  });
  test("pnpm links, exports-hidden manifests, cycles, assets, versions and manifest edges survive without links", () => {
    const f = fixture();
    const runtime = pkg(
      join(f.installRoot, ".pnpm/runtime/node_modules/runtime-fixture"),
      "runtime-fixture",
      "1.5.0",
      {
        dependencies: { alpha: "1", beta: "1" },
        devDependencies: { "forbidden-dev": "1" },
        optionalDependencies: { absent: "1" },
        peerDependencies: { "absent-peer": "1" },
        peerDependenciesMeta: { "absent-peer": { optional: true } },
        exports: { ".": "./index.js" },
      },
    );
    const alpha = pkg(
      join(f.installRoot, ".pnpm/alpha/node_modules/alpha"),
      "alpha",
      "1.0.0",
      { dependencies: { shared: "1", "runtime-fixture": "1" } },
    );
    const beta = pkg(
      join(f.installRoot, ".pnpm/beta/node_modules/beta"),
      "beta",
      "1.0.0",
      { dependencies: { shared: "2" } },
    );
    const one = pkg(
      join(f.installRoot, ".pnpm/shared1/node_modules/shared"),
      "shared",
    );
    const two = pkg(
      join(f.installRoot, ".pnpm/shared2/node_modules/shared"),
      "shared",
      "2.0.0",
    );
    link(runtime, join(f.installRoot, "runtime-fixture"));
    link(alpha, join(dirname(runtime), "alpha"));
    link(beta, join(dirname(runtime), "beta"));
    link(one, join(dirname(alpha), "shared"));
    link(runtime, join(dirname(alpha), "runtime-fixture"));
    link(two, join(dirname(beta), "shared"));
    pkg(join(f.installRoot, "forbidden-dev"), "forbidden-dev");
    mkdirSync(join(runtime, "assets"));
    writeFileSync(join(runtime, "assets/data.json"), "{}");
    link(join(runtime, "assets"), join(runtime, "asset-alias"));
    const manifest = copyDurableRuntime(f);
    expect(
      manifest.packages.map((p) => `${p.name}@${p.version}`).sort(),
    ).toEqual([
      "alpha@1.0.0",
      "beta@1.0.0",
      "runtime-fixture@1.5.0",
      "shared@1.0.0",
      "shared@2.0.0",
    ]);
    expect(
      readFileSync(
        join(
          f.destination,
          "node_modules/runtime-fixture/asset-alias/data.json",
        ),
        "utf8",
      ),
    ).toBe("{}");
    noLinks(f.destination);
    for (const item of manifest.packages) {
      expect(
        createHash("sha256")
          .update(readFileSync(join(f.destination, item.path, "package.json")))
          .digest("hex"),
      ).toBe(item.packageJsonSha256);
      for (const [name, path] of Object.entries(item.dependencies)) {
        expect(
          JSON.parse(
            readFileSync(join(f.destination, path, "package.json"), "utf8"),
          ).name,
        ).toBe(name);
        expect(
          Bun.resolveSync(name, `${join(f.destination, item.path)}/`),
        ).toBe(join(f.destination, path, "index.js"));
      }
    }
    expect(JSON.stringify(manifest)).not.toContain(f.projectDir);
    expect(
      JSON.parse(
        readFileSync(join(f.destination, DURABLE_RUNTIME_MANIFEST), "utf8"),
      ),
    ).toEqual(manifest);
  });
  test("native closure preserves Photon WASM and adjacent CodeMode worker/QuickJS assets, not unrelated installed packages", () => {
    const f = nativeFixture();
    pkg(
      join(f.installRoot, DURABLE_RUNTIME_ROOTS[0]),
      DURABLE_RUNTIME_ROOTS[0],
      "1.5.0",
      {
        dependencies: {
          "@earendil-works/pi-codemode": "1.5.0",
          "@silvia-odwyer/photon": "0.3.3",
        },
      },
    );
    const codemode = pkg(
      join(f.installRoot, "@earendil-works/pi-codemode"),
      "@earendil-works/pi-codemode",
      "1.5.0",
      { dependencies: { "quickjs-wasi": "3.6.2" } },
    );
    const photon = pkg(
      join(f.installRoot, "@silvia-odwyer/photon"),
      "@silvia-odwyer/photon",
      "0.3.3",
    );
    const quickjs = pkg(
      join(f.installRoot, "quickjs-wasi"),
      "quickjs-wasi",
      "3.6.2",
    );
    mkdirSync(join(codemode, "dist/runtime"), { recursive: true });
    writeFileSync(join(codemode, "dist/runtime/worker.js"), "// pinned worker");
    const wasm = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]);
    writeFileSync(join(photon, "photon_rs_bg.wasm"), wasm);
    writeFileSync(join(quickjs, "quickjs.wasm"), wasm);
    pkg(
      join(f.installRoot, "@earendil-works/pi-coding-agent"),
      "@earendil-works/pi-coding-agent",
    );
    const manifest = copyDurableRuntime({ ...f, roots: DURABLE_RUNTIME_ROOTS });
    expect(manifest.packages).toHaveLength(7);
    expect(
      readFileSync(
        join(
          f.destination,
          "node_modules/@silvia-odwyer/photon/photon_rs_bg.wasm",
        ),
      ),
    ).toEqual(Buffer.from(wasm));
    expect(
      readFileSync(
        join(f.destination, "node_modules/quickjs-wasi/quickjs.wasm"),
      ),
    ).toEqual(Buffer.from(wasm));
    expect(
      readFileSync(
        join(
          f.destination,
          "node_modules/@earendil-works/pi-codemode/dist/runtime/worker.js",
        ),
        "utf8",
      ),
    ).toBe("// pinned worker");
    expect(
      existsSync(
        join(f.destination, "node_modules/@earendil-works/pi-coding-agent"),
      ),
    ).toBe(false);
  });
  test("required missing dependency fails without partial output", () => {
    const f = fixture();
    pkg(join(f.installRoot, "runtime-fixture"), "runtime-fixture", "1", {
      dependencies: { missing: "1" },
    });
    expect(() => copyDurableRuntime(f)).toThrow(
      "Missing installed production dependency",
    );
    expect(existsSync(f.destination)).toBe(false);
  });
  test.each([
    "@earendil-works/pi-coding-agent",
    "@earendil-works/pi-tui",
    "@mariozechner/pi-coding-agent",
    "@mariozechner/pi-tui",
    "@xterm/xterm",
    "@xterm/addon-fit",
    "xterm",
    "xterm-addon-fit",
  ])("SDK/TUI %s is rejected even as a missing optional dependency", (name) => {
    const f = fixture();
    pkg(join(f.installRoot, "runtime-fixture"), "runtime-fixture", "1", {
      optionalDependencies: { [name]: "1" },
    });
    expect(() => copyDurableRuntime(f)).toThrow("SDK/TUI package is forbidden");
    expect(existsSync(f.destination)).toBe(false);
  });
  test.each(
    DURABLE_NATIVE_ROOTS,
  )("native %s must match the fixed 1.5.0 baseline", (name) => {
    const f = fixture();
    pkg(join(f.installRoot, name), name, "1.6.0");
    expect(() => copyDurableRuntime({ ...f, roots: [name] })).toThrow(
      `${name}@1.5.0, installed 1.6.0`,
    );
  });
  test("dependency traversal and manifest identity mismatch are rejected", () => {
    const f = fixture();
    const runtime = pkg(
      join(f.installRoot, "runtime-fixture"),
      "runtime-fixture",
      "1",
      { dependencies: { "../escape": "1" } },
    );
    expect(() => copyDurableRuntime(f)).toThrow("Unsafe package name");
    pkg(runtime, "other");
    expect(() => copyDurableRuntime(f)).toThrow("Invalid package identity");
  });
  test("alias to an already visited source cannot bypass manifest identity validation", () => {
    const f = fixture();
    const runtime = pkg(
      join(f.installRoot, "runtime-fixture"),
      "runtime-fixture",
      "1",
      { dependencies: { alias: "1" } },
    );
    link(runtime, join(f.installRoot, "alias"));
    expect(() => copyDurableRuntime(f)).toThrow(
      "Invalid package identity for alias",
    );
  });
  test("package links outside installation are rejected", () => {
    const f = fixture();
    const outside = pkg(join(f.root, "outside"), "runtime-fixture");
    link(outside, join(f.installRoot, "runtime-fixture"));
    expect(() => copyDurableRuntime(f)).toThrow("outside install root");
  });
  test("escaping and cyclic package-internal junctions fail closed and clean partial output", () => {
    const f = fixture();
    const runtime = pkg(
      join(f.installRoot, "runtime-fixture"),
      "runtime-fixture",
    );
    const outside = join(f.root, "outside");
    mkdirSync(outside);
    writeFileSync(join(outside, "private"), "not copied");
    link(outside, join(runtime, "escape"));
    expect(() => copyDurableRuntime(f)).toThrow("symlink escapes");
    expect(existsSync(f.destination)).toBe(false);
    const cyclic = fixture();
    const cyclicRuntime = pkg(
      join(cyclic.installRoot, "runtime-fixture"),
      "runtime-fixture",
    );
    link(cyclicRuntime, join(cyclicRuntime, "cycle"));
    expect(() => copyDurableRuntime(cyclic)).toThrow("symlink cycle");
    expect(existsSync(cyclic.destination)).toBe(false);
  });
  test("destination-parent junction cannot bypass source overlap protection", () => {
    const f = fixture();
    pkg(join(f.installRoot, "runtime-fixture"), "runtime-fixture");
    const alias = join(f.root, "install-alias");
    link(f.installRoot, alias);
    expect(() =>
      copyDurableRuntime({ ...f, destination: join(alias, "output") }),
    ).toThrow("overlaps");
    expect(existsSync(join(f.installRoot, "output"))).toBe(false);
  });
  test("broken package links fail instead of being followed or emitted", () => {
    const f = fixture();
    const runtime = pkg(
      join(f.installRoot, "runtime-fixture"),
      "runtime-fixture",
    );
    const target = join(runtime, "target");
    mkdirSync(target);
    link(target, join(runtime, "broken"));
    rmSync(target, { recursive: true });
    expect(() => copyDurableRuntime(f)).toThrow();
    expect(existsSync(f.destination)).toBe(false);
  });
  test("existing destinations and source overlap are never overwritten", () => {
    const f = fixture();
    pkg(join(f.installRoot, "runtime-fixture"), "runtime-fixture");
    mkdirSync(f.destination);
    writeFileSync(join(f.destination, "keep"), "keep");
    expect(() => copyDurableRuntime(f)).toThrow("already exists");
    expect(readFileSync(join(f.destination, "keep"), "utf8")).toBe("keep");
    expect(() =>
      copyDurableRuntime({ ...f, destination: join(f.installRoot, "output") }),
    ).toThrow("overlaps");
  });
  test("completed staging replaces only its fixed generated directory; old SDK stage is untouched", () => {
    const f = nativeFixture();
    const old = join(f.projectDir, "build/sdk-runtime.next");
    mkdirSync(old, { recursive: true });
    writeFileSync(join(old, "keep"), "preexisting interrupted SDK build");
    stageDurableRuntime(f.projectDir);
    writeFileSync(join(f.stage, "obsolete"), "old generated payload");
    const manifest = stageDurableRuntime(f.projectDir);
    expect(manifest.roots).toEqual([...DURABLE_RUNTIME_ROOTS]);
    expect(existsSync(join(f.stage, "obsolete"))).toBe(false);
    expect(existsSync(`${f.stage}.next`)).toBe(false);
    expect(existsSync(`${f.stage}.previous`)).toBe(false);
    expect(readFileSync(join(old, "keep"), "utf8")).toBe(
      "preexisting interrupted SDK build",
    );
  });
  test("failed copy preserves the previously completed stage", () => {
    const f = nativeFixture();
    stageDurableRuntime(f.projectDir);
    writeFileSync(join(f.stage, "keep"), "previous valid stage");
    link(f.root, join(f.installRoot, DURABLE_RUNTIME_ROOTS[0], "escape"));
    expect(() => stageDurableRuntime(f.projectDir)).toThrow("symlink escapes");
    expect(readFileSync(join(f.stage, "keep"), "utf8")).toBe(
      "previous valid stage",
    );
    expect(existsSync(`${f.stage}.next`)).toBe(false);
  });
  test.each([
    ".next",
    ".previous",
  ])("interrupted %s stage fails with a bounded recovery path", (suffix) => {
    const f = nativeFixture();
    mkdirSync(`${f.stage}${suffix}`, { recursive: true });
    writeFileSync(join(`${f.stage}${suffix}`, "keep"), "review first");
    expect(() => stageDurableRuntime(f.projectDir)).toThrow(
      `Interrupted Durable stage: ${f.stage}${suffix}`,
    );
    expect(readFileSync(join(`${f.stage}${suffix}`, "keep"), "utf8")).toBe(
      "review first",
    );
  });
  test.each([
    "build",
    DURABLE_RUNTIME_STAGE,
    `${DURABLE_RUNTIME_STAGE}.next`,
    `${DURABLE_RUNTIME_STAGE}.previous`,
  ])("build hook refuses junction at %s", (path) => {
    const f = nativeFixture();
    const outside = join(f.root, "outside");
    mkdirSync(outside);
    writeFileSync(join(outside, "keep"), "not generated");
    link(outside, join(f.projectDir, path));
    expect(() => stageDurableRuntime(f.projectDir)).toThrow(
      "must be a real directory",
    );
    expect(readFileSync(join(outside, "keep"), "utf8")).toBe("not generated");
  });
});

test("installed native closure relocates with real Photon WASM and CodeMode worker", async () => {
  const f = fixture();
  const manifest = copyDurableRuntime({
    projectDir: resolve(import.meta.dir, ".."),
    destination: f.destination,
  });
  const relocated = join(f.root, "relocated");
  for (let attempt = 0; ; attempt++) {
    try {
      renameSync(f.destination, relocated);
      break;
    } catch (error) {
      if (
        process.platform !== "win32" ||
        attempt >= 5 ||
        !["EPERM", "EACCES", "EBUSY"].includes(
          (error as NodeJS.ErrnoException).code ?? "",
        )
      )
        throw error;
      await Bun.sleep(100 * (attempt + 1));
    }
  }
  noLinks(relocated);
  for (const item of manifest.packages) {
    const bytes = readFileSync(join(relocated, item.path, "package.json"));
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(
      item.packageJsonSha256,
    );
    expect(JSON.parse(bytes.toString())).toMatchObject({
      name: item.name,
      version: item.version,
    });
    for (const [name, path] of Object.entries(item.dependencies)) {
      expect(
        JSON.parse(readFileSync(join(relocated, path, "package.json"), "utf8"))
          .name,
      ).toBe(name);
    }
  }
  const locate = (name: string) => Bun.resolveSync(name, `${relocated}/`);
  const load = (name: string) => import(pathToFileURL(locate(name)).href);
  for (const name of DURABLE_RUNTIME_ROOTS) {
    expect(locate(name).startsWith(relocated)).toBe(true);
    expect(await load(name)).toBeDefined();
  }
  // Exercise the actual bundled config loader, not the repository resolver. An
  // external adapter's value import of @pig/config must resolve to the staged API.
  const externalApi = join(relocated, "node_modules", "manual-config-api");
  pkg(externalApi, "manual-config-api", "1.0.0", {
    type: "module",
    peerDependencies: { "@pig/config": "0.1.0" },
  });
  writeFileSync(
    join(externalApi, "index.js"),
    'export {defineConfig as nativeConfig} from "@pig/config";',
  );
  const configFile = join(relocated, "pig.config.ts");
  writeFileSync(
    configFile,
    'import {nativeConfig} from "manual-config-api"; import {defineExtension} from "@earendil-works/pi-durable"; export default nativeConfig({apiVersion:2,runtime:{extensions:[defineExtension({name:"relocated.fixture"})],profiles:{plain:{extensions:[],tools:[]}},defaultProfile:"plain"}});',
  );
  const built = await Bun.build({
    entrypoints: [resolve(import.meta.dir, "../src/bun/config-loader.ts")],
    outdir: relocated,
    naming: "config-loader.mjs",
    target: "bun",
    format: "esm",
    external: [...DURABLE_RUNTIME_EXTERNALS],
  });
  expect(built.success).toBe(true);
  const { ConfigLoader } = await import(
    pathToFileURL(join(relocated, "config-loader.mjs")).href
  );
  const loader = new ConfigLoader(configFile);
  const candidate = await loader.prepare();
  expect(loader.error).toBeUndefined();
  expect(candidate?.config.apiVersion).toBe(2);
  expect(candidate?.config.runtime.extensions[0].name).toBe(
    "relocated.fixture",
  );
  expect(candidate?.config.runtime.profiles.plain.extensions).toEqual([]);
  const native = await load("@earendil-works/pi-durable");
  const registry = native.createRegistry();
  registry.install(candidate.config.runtime.extensions[0]);
  expect(registry.snapshot().extension("relocated.fixture")).toBeDefined();
  await loader.discard(candidate);
  const photon = await load("@silvia-odwyer/photon");
  photon.initSync({
    module: readFileSync(locate("@silvia-odwyer/photon/photon_rs_bg.wasm")),
  });
  const image = new photon.PhotonImage(new Uint8Array([255, 0, 0, 255]), 1, 1);
  try {
    expect(image.get_width()).toBe(1);
    expect(image.get_bytes().length).toBeGreaterThan(0);
  } finally {
    image.free();
  }
  const { CodemodeSandbox } = await load("@earendil-works/pi-codemode");
  const exits: Promise<void>[] = [];
  const sandbox = new CodemodeSandbox({
    timeoutMs: 5_000,
    onWorkerStarted: (exited: Promise<void>) => exits.push(exited),
  });
  try {
    expect(await sandbox.execute("return 42;")).toMatchObject({
      ok: true,
      value: 42,
    });
  } finally {
    await sandbox.close();
    await Promise.all(exits);
  }
}, 60_000);
