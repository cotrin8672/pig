import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  newerVersion,
  parseBuild,
  parseChecksum,
  parseRelease,
  releaseBase,
  updateZip,
} from "../shared/app-update";
import { AppUpdater, detectInstall } from "./app-update";

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(
    dirs.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});
async function fixture() {
  const path = await mkdtemp(join(tmpdir(), "pig-update-test-"));
  dirs.push(path);
  return path;
}
async function put(path: string, value: unknown) {
  await writeFile(path, JSON.stringify(value));
}
function release(version = "0.3.0") {
  return {
    tag_name: `v${version}`,
    draft: false,
    prerelease: false,
    assets: [updateZip, `${updateZip}.sha256`].map((name) => ({
      name,
      browser_download_url: `${releaseBase}/v${version}/${name}`,
    })),
  };
}

describe("Stable app updates", () => {
  test("version comparison is numeric, strictly newer, and rejects prereleases", () => {
    expect(newerVersion("0.10.0", "0.9.0")).toBe(true);
    expect(newerVersion("1.0.0", "0.99.99")).toBe(true);
    expect(newerVersion("0.2.0", "0.2.0")).toBe(false);
    expect(newerVersion("0.1.0", "0.2.0")).toBe(false);
    for (const value of [
      "nightly",
      "0.3.0-nightly.1",
      "v0.3.0",
      "01.2.3",
      "../x",
    ]) {
      expect(newerVersion(value, "0.2.0")).toBe(false);
      expect(newerVersion("0.3.0", value)).toBe(false);
    }
  });
  test("release must be stable and contain the exact repository assets", () => {
    expect(parseRelease(release()).version).toBe("0.3.0");
    for (const invalid of [
      null,
      {},
      release("0.3.0-rc.1"),
      { ...release(), draft: true },
      { ...release(), prerelease: true },
      { ...release(), assets: [] },
      {
        ...release(),
        assets: [
          {
            name: updateZip,
            browser_download_url: "https://evil.test/update.zip",
          },
        ],
      },
    ])
      expect(() => parseRelease(invalid)).toThrow();
  });
  test("checksum accepts published format, not arbitrary filenames or garbage", () => {
    const hash = "a".repeat(64);
    expect(parseChecksum(`${hash.toUpperCase()}  ${updateZip}\n`)).toBe(hash);
    expect(parseChecksum(hash)).toBe(hash);
    expect(() => parseChecksum(`${hash}  other.zip`)).toThrow();
    expect(() => parseChecksum("bad")).toThrow();
  });
  test("build provenance cannot enable an unclassified build", () => {
    expect(
      parseBuild({ channel: "stable", version: "0.2.0", commit: "abc" })
        ?.channel,
    ).toBe("stable");
    expect(
      parseBuild({ channel: "stable", version: "nightly", commit: "abc" }),
    ).toBeUndefined();
    expect(parseBuild({ channel: "stable", version: "0.2.0" })).toBeUndefined();
    expect(
      parseBuild({ channel: "unknown", version: "0.2.0", commit: "abc" }),
    ).toBeUndefined();
  });
  test("detects the owning Scoop installation, not the existence of Scoop on PATH", async () => {
    const base = await fixture();
    const root = join(base, "apps/pig/0.2.0");
    await mkdir(root, { recursive: true });
    expect((await detectInstall(root)).method).toBe("disabled");
    await put(join(root, "scoop-install.json"), { bucket: "pig" });
    await mkdir(join(base, "apps/scoop/current/bin"), { recursive: true });
    await writeFile(join(base, "apps/scoop/current/bin/scoop.ps1"), "");
    await mkdir(join(base, "buckets/pig/bucket"), { recursive: true });
    await put(join(base, "buckets/pig/bucket/pig.json"), {});
    expect((await detectInstall(root)).method).toBe("scoop");
    const portable = join(base, "portable");
    await mkdir(portable);
    expect((await detectInstall(portable)).method).toBe("portable");
    await put(join(portable, "scoop-install.json"), { bucket: "pig" });
    expect((await detectInstall(portable)).method).toBe("disabled");
    const nightly = join(base, "apps/pig-nightly/nightly");
    await mkdir(nightly, { recursive: true });
    await put(join(nightly, "scoop-install.json"), { bucket: "pig" });
    expect((await detectInstall(nightly)).reason).toBe("nightly");
    await put(join(root, "scoop-install.json"), { bucket: "../../other" });
    expect((await detectInstall(root)).method).toBe("disabled");
  });
  test("Nightly and missing metadata never check or install", async () => {
    const base = await fixture();
    await mkdir(join(base, "bin"));
    await mkdir(join(base, "Resources"));
    const exe = join(base, "bin/bun.exe");
    await writeFile(exe, "");
    const updater = new AppUpdater(
      exe,
      join(base, "result.json"),
      () => {},
      async () => {
        throw new Error("Must not shut down");
      },
    );
    await put(join(base, "Resources/app-build.json"), {
      channel: "nightly",
      version: "0.2.0-nightly.1",
      commit: "abc",
    });
    expect((await updater.info()).reason).toBe("nightly");
    await updater.check();
    await updater.apply();
    expect((await updater.info()).status).toBe("idle");
  });
});

// Test the real Windows extraction code in temporary directories, without touching Scoop or scheduling tasks.
const windowsTest = process.platform === "win32" ? test : test.skip;
windowsTest(
  "Windows ZIP preparation validates hashes, traversal, duplicates and bundle provenance",
  async () => {
    const base = await fixture();
    const script = join(import.meta.dir, "../../scripts/app-update.ps1");
    const ps = join(
      process.env.SystemRoot ?? "C:\\Windows",
      "System32/WindowsPowerShell/v1.0/powershell.exe",
    );
    // PowerShell creates fixtures so the test needs no ZIP dependency.
    const setup = join(base, "fixtures.ps1");
    await writeFile(
      setup,
      `param([string]$Base)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
foreach ($kind in @('good', 'traversal', 'duplicate', 'nightly')) {
  $zip = [IO.Compression.ZipFile]::Open((Join-Path $Base "$kind.zip"), 'Create')
  try {
    $entries = @{
      'bin/launcher.exe' = 'fixture';
      'Resources/app-build.json' = ('{"channel":"' + $(if ($kind -eq 'nightly') {'nightly'} else {'stable'}) + '","version":"0.3.0","commit":"abc"}');
      'Resources/version.json' = '{"identifier":"dev.pig.desktop","channel":"stable","version":"0.3.0"}'
    }
    if ($kind -eq 'traversal') { $entries['../outside.txt'] = 'bad' }
    foreach ($name in $entries.Keys) {
      $entry = $zip.CreateEntry($name)
      $writer = [IO.StreamWriter]::new($entry.Open())
      $writer.Write($entries[$name]); $writer.Dispose()
    }
    if ($kind -eq 'duplicate') { $zip.CreateEntry('BIN/launcher.exe') | Out-Null }
  } finally { $zip.Dispose() }
}
`,
    );
    async function run(file: string, args: string[]) {
      const child = Bun.spawn(
        [
          ps,
          "-NoProfile",
          "-NonInteractive",
          "-ExecutionPolicy",
          "Bypass",
          "-File",
          file,
          ...args,
        ],
        { stdout: "pipe", stderr: "pipe", windowsHide: true },
      );
      const stderr = await new Response(child.stderr).text();
      return { code: await child.exited, stderr };
    }
    const setupResult = await run(setup, ["-Base", base]);
    expect(setupResult).toEqual({ code: 0, stderr: "" });
    for (const kind of [
      "good",
      "traversal",
      "duplicate",
      "nightly",
      "bad-hash",
    ]) {
      const zip = join(base, `${kind === "bad-hash" ? "good" : kind}.zip`);
      const config = join(base, `${kind}.json`);
      const stage = join(base, `stage ${kind} 日本語`);
      await put(config, {
        method: "portable",
        version: "0.3.0",
        zip,
        stage,
        hash:
          kind === "bad-hash"
            ? "0".repeat(64)
            : new Bun.CryptoHasher("sha256")
                .update(await readFile(zip))
                .digest("hex"),
      });
      const result = await run(script, ["-Config", config, "-Prepare"]);
      if (kind === "good") {
        expect(result).toEqual({ code: 0, stderr: "" });
        expect(await Bun.file(join(stage, "bin/launcher.exe")).text()).toBe(
          "fixture",
        );
      } else {
        expect(result.code).toBe(1);
        expect(result.stderr).toContain("App update failed");
      }
    }
    expect(await Bun.file(join(base, "outside.txt")).exists()).toBe(false);
  },
  30_000,
);
