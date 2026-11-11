import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import config from "../electrobun.config";
import {
  copySdkRuntime,
  SDK_RUNTIME_EXTERNALS,
  SDK_RUNTIME_ROOTS,
  SDK_RUNTIME_STAGE,
  sdkStageMatches,
} from "./sdk-runtime-assets";

const fixtures: string[] = [];
afterEach(() => {
  for (const path of fixtures.splice(0))
    rmSync(path, { recursive: true, force: true });
});
function fixture() {
  const root = mkdtempSync(
    join(process.env.PI_SCRATCH_DIR ?? tmpdir(), "sdk-copy-test-"),
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
    roots: ["sdk"],
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

describe("SDK runtime production packaging", () => {
  test("Electrobun wires external roots, closure copy and existing native hook", () => {
    expect(config.build.bun.external).toEqual(SDK_RUNTIME_EXTERNALS);
    expect(config.build.copy["build/sdk-runtime/node_modules"]).toBe(
      "node_modules",
    );
    expect(config.scripts.preBuild).toBe("scripts/sdk-runtime-assets.ts");
    expect(config.scripts.postBuild).toBe("scripts/post-build.ts");
    expect(config.build.win.bundleCEF).toBe(false);
  });
  test("stage reuse compares installed bytes, rejects extras and does not repair or follow stage links", () => {
    const f = fixture();
    const pkgDir = pkg(join(f.installRoot, "sdk"), "sdk");
    copySdkRuntime(f);
    expect(sdkStageMatches(f)).toBe(true);
    const entry = join(pkgDir, "index.js");
    const original = readFileSync(entry);
    writeFileSync(entry, "changed without a version bump");
    expect(sdkStageMatches(f)).toBe(false);
    writeFileSync(entry, original);
    writeFileSync(join(f.destination, "extra"), "extra");
    expect(sdkStageMatches(f)).toBe(false);
    rmSync(join(f.destination, "extra"));
    link(pkgDir, join(f.destination, "unsafe"));
    expect(sdkStageMatches(f)).toBe(false);
    expect(readFileSync(entry)).toEqual(original);
  });
  test("pnpm links, exports-hidden manifests, cycles, assets, versions and manifest edges survive without links", () => {
    const f = fixture();
    const sdk = pkg(
      join(f.installRoot, ".pnpm/sdk/node_modules/sdk"),
      "sdk",
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
      { dependencies: { shared: "1", sdk: "1" } },
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
    link(sdk, join(f.installRoot, "sdk"));
    link(alpha, join(dirname(sdk), "alpha"));
    link(beta, join(dirname(sdk), "beta"));
    link(one, join(dirname(alpha), "shared"));
    link(sdk, join(dirname(alpha), "sdk"));
    link(two, join(dirname(beta), "shared"));
    pkg(join(f.installRoot, "forbidden-dev"), "forbidden-dev");
    mkdirSync(join(sdk, "themes"));
    writeFileSync(join(sdk, "themes/dark.json"), "{}");
    link(join(sdk, "themes"), join(sdk, "theme-alias"));
    const manifest = copySdkRuntime(f);
    expect(sdkStageMatches(f)).toBe(true);
    expect(
      manifest.packages.map((p) => `${p.name}@${p.version}`).sort(),
    ).toEqual([
      "alpha@1.0.0",
      "beta@1.0.0",
      "sdk@1.5.0",
      "shared@1.0.0",
      "shared@2.0.0",
    ]);
    expect(
      readFileSync(
        join(f.destination, "node_modules/sdk/theme-alias/dark.json"),
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
  });
  test("an interrupted rebuild preserves the previous stage and never trusts partial next contents", () => {
    const f = fixture();
    for (const name of SDK_RUNTIME_ROOTS) pkg(join(f.installRoot, name), name);
    const script = join(f.projectDir, "scripts", "sdk-runtime-assets.ts");
    mkdirSync(dirname(script), { recursive: true });
    copyFileSync(join(import.meta.dir, "sdk-runtime-assets.ts"), script);
    const stage = join(f.projectDir, SDK_RUNTIME_STAGE);
    const options = { ...f, destination: stage, roots: SDK_RUNTIME_ROOTS };
    copySdkRuntime(options);
    const run = () =>
      Bun.spawnSync([process.execPath, "--no-install", script], {
        cwd: f.projectDir,
        stdout: "pipe",
        stderr: "pipe",
      });
    const outside = join(f.root, "outside-stage");
    mkdirSync(outside);
    writeFileSync(join(outside, "private"), "keep outside data");
    link(outside, join(stage, "extra-link"));
    const rebuilt = run();
    expect(rebuilt.exitCode, rebuilt.stderr.toString()).toBe(0);
    expect(readFileSync(join(outside, "private"), "utf8")).toBe(
      "keep outside data",
    );
    expect(existsSync(join(stage, "extra-link"))).toBe(false);
    expect(sdkStageMatches(options)).toBe(true);
    const temporary = `${stage}.next`;
    mkdirSync(temporary);
    writeFileSync(join(temporary, "incomplete"), "keep for review");
    const reused = run();
    expect(reused.exitCode, reused.stderr.toString()).toBe(0);
    expect(reused.stdout.toString()).toContain("Reusing verified SDK runtime");
    const entry = join("node_modules", SDK_RUNTIME_ROOTS[0], "index.js");
    const original = readFileSync(join(stage, entry), "utf8");
    writeFileSync(join(f.projectDir, entry), "updated installed source");
    const interrupted = run();
    expect(interrupted.exitCode).not.toBe(0);
    expect(interrupted.stderr.toString()).toContain(
      "Remove interrupted SDK stage first",
    );
    expect(readFileSync(join(stage, entry), "utf8")).toBe(original);
    expect(readFileSync(join(temporary, "incomplete"), "utf8")).toBe(
      "keep for review",
    );
    expect(sdkStageMatches(options)).toBe(false);
  });
  test("required missing dependency fails without partial output", () => {
    const f = fixture();
    pkg(join(f.installRoot, "sdk"), "sdk", "1", {
      dependencies: { missing: "1" },
    });
    expect(() => copySdkRuntime(f)).toThrow(
      "Missing installed production dependency",
    );
    expect(existsSync(f.destination)).toBe(false);
  });
  test("Durable is rejected even as optional dependency", () => {
    const f = fixture();
    pkg(join(f.installRoot, "sdk"), "sdk", "1", {
      optionalDependencies: { "@earendil-works/pi-durable": "1" },
    });
    expect(() => copySdkRuntime(f)).toThrow("Durable is forbidden");
  });
  test("dependency traversal and manifest identity mismatch are rejected", () => {
    const f = fixture();
    const sdk = pkg(join(f.installRoot, "sdk"), "sdk", "1", {
      dependencies: { "../escape": "1" },
    });
    expect(() => copySdkRuntime(f)).toThrow("Unsafe package name");
    pkg(sdk, "other");
    expect(() => copySdkRuntime(f)).toThrow("Invalid package identity");
  });
  test("package links outside installation are rejected", () => {
    const f = fixture();
    const outside = pkg(join(f.root, "outside"), "sdk");
    link(outside, join(f.installRoot, "sdk"));
    expect(() => copySdkRuntime(f)).toThrow("outside install root");
  });
  test("escaping and cyclic package-internal junctions fail closed and clean partial output", () => {
    const f = fixture();
    const sdk = pkg(join(f.installRoot, "sdk"), "sdk");
    const outside = join(f.root, "outside");
    mkdirSync(outside);
    writeFileSync(join(outside, "private"), "not copied");
    link(outside, join(sdk, "escape"));
    expect(() => copySdkRuntime(f)).toThrow("symlink escapes");
    expect(existsSync(f.destination)).toBe(false);
    const cyclic = fixture();
    const cyclicSdk = pkg(join(cyclic.installRoot, "sdk"), "sdk");
    link(cyclicSdk, join(cyclicSdk, "cycle"));
    expect(() => copySdkRuntime(cyclic)).toThrow("symlink cycle");
    expect(existsSync(cyclic.destination)).toBe(false);
  });
  test("destination-parent junction cannot bypass source overlap protection", () => {
    const f = fixture();
    pkg(join(f.installRoot, "sdk"), "sdk");
    const alias = join(f.root, "install-alias");
    link(f.installRoot, alias);
    expect(() =>
      copySdkRuntime({ ...f, destination: join(alias, "output") }),
    ).toThrow("overlaps");
    expect(existsSync(join(f.installRoot, "output"))).toBe(false);
  });
  test("broken package links fail instead of being followed or emitted", () => {
    const f = fixture();
    const sdk = pkg(join(f.installRoot, "sdk"), "sdk");
    const target = join(sdk, "target");
    mkdirSync(target);
    link(target, join(sdk, "broken"));
    rmSync(target, { recursive: true });
    expect(() => copySdkRuntime(f)).toThrow();
    expect(existsSync(f.destination)).toBe(false);
  });
  test("existing destinations and source overlap are never overwritten", () => {
    const f = fixture();
    pkg(join(f.installRoot, "sdk"), "sdk");
    mkdirSync(f.destination);
    writeFileSync(join(f.destination, "keep"), "keep");
    expect(() => copySdkRuntime(f)).toThrow("already exists");
    expect(readFileSync(join(f.destination, "keep"), "utf8")).toBe("keep");
    expect(() =>
      copySdkRuntime({ ...f, destination: join(f.installRoot, "output") }),
    ).toThrow("overlaps");
  });
});
