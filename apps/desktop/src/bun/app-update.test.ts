import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
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
