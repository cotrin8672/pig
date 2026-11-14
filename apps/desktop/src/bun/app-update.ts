import { createHash, randomUUID } from "node:crypto";
import {
  copyFile,
  mkdtemp,
  readFile,
  realpath,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import {
  type AppUpdateState,
  newerVersion,
  parseBuild,
  parseChecksum,
  parseRelease,
  releaseBase,
  stableVersion,
  updateZip,
} from "../shared/app-update";

async function json(path: string): Promise<unknown> {
  try {
    return JSON.parse((await readFile(path, "utf8")).replace(/^\uFEFF/, ""));
  } catch (error) {
    throw new Error(`Cannot read update metadata: ${path}`, { cause: error });
  }
}
async function exists(path: string) {
  return stat(path).then(
    () => true,
    () => false,
  );
}

// Marker presence must never fall through to direct file replacement, even if corrupt.
export async function detectInstall(root: string) {
  const markers = [
    "scoop-install.json",
    "install.json",
    "scoop-manifest.json",
    "manifest.json",
  ];
  const marked = (
    await Promise.all(markers.map((name) => exists(join(root, name))))
  ).some(Boolean);
  if (!marked) {
    // A Scoop-shaped path without metadata is ambiguous, not a portable installation.
    return basename(dirname(dirname(root))).toLowerCase() === "apps"
      ? { method: "disabled" as const }
      : { method: "portable" as const };
  }
  const app = basename(dirname(root)).toLowerCase();
  if (app === "pig-nightly")
    return { method: "disabled" as const, reason: "nightly" as const };
  if (
    app !== "pig" ||
    basename(dirname(dirname(root))).toLowerCase() !== "apps"
  )
    return { method: "disabled" as const };
  const scoopRoot = dirname(dirname(dirname(root)));
  const install = (await json(
    join(
      root,
      (await exists(join(root, "scoop-install.json")))
        ? "scoop-install.json"
        : "install.json",
    ),
  )) as { bucket?: unknown };
  if (
    typeof install.bucket !== "string" ||
    !/^[a-z\d_-]+$/i.test(install.bucket)
  )
    return { method: "disabled" as const };
  const scoop = join(scoopRoot, "apps/scoop/current/bin/scoop.ps1");
  const bucket = join(scoopRoot, "buckets", install.bucket);
  const manifest = (await exists(join(bucket, "bucket/pig.json")))
    ? join(bucket, "bucket/pig.json")
    : join(bucket, "pig.json");
  if (!(await exists(scoop)) || !(await exists(manifest)))
    return { method: "disabled" as const };
  return { method: "scoop" as const, scoop, manifest };
}

const powershell = join(
  process.env.SystemRoot ?? "C:\\Windows",
  "System32/WindowsPowerShell/v1.0/powershell.exe",
);
async function runHelper(
  script: string,
  config: string,
  mode: "-Prepare" | "-Launch",
) {
  const child = Bun.spawn(
    [
      powershell,
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      script,
      "-Config",
      config,
      mode,
    ],
    {
      stdout: "ignore",
      stderr: "pipe",
      windowsHide: true,
    },
  );
  const timeout = setTimeout(() => child.kill(), 5 * 60_000);
  try {
    const error = await new Response(child.stderr).text();
    if (await child.exited)
      throw new Error(error.trim() || "Update helper failed");
  } finally {
    clearTimeout(timeout);
  }
}

export class AppUpdater {
  private state: AppUpdateState = {
    version: "—",
    method: "disabled",
    status: "idle",
    reason: "unknown",
  };
  private initialized?: Promise<void>;
  private busy = false;
  private release?: ReturnType<typeof parseRelease> & { hash: string };
  private install?: Awaited<ReturnType<typeof detectInstall>>;
  private root = "";
  private originalRoot = "";

  constructor(
    private readonly executable: string,
    private readonly result: string,
    private readonly notify: (state: AppUpdateState) => void,
    private readonly shutdown: (
      handoff: () => Promise<() => Promise<void>>,
    ) => Promise<boolean>,
  ) {}

  private publish(patch: Partial<AppUpdateState>) {
    this.state = { ...this.state, ...patch };
    this.notify(this.state);
  }
  async info() {
    this.initialized ??= this.initialize();
    await this.initialized;
    return this.state;
  }
  private async initialize() {
    try {
      this.root = dirname(dirname(await realpath(this.executable)));
      this.originalRoot = dirname(dirname(this.executable));
      const build = parseBuild(
        await json(join(this.root, "Resources/app-build.json")),
      );
      if (!build) return;
      this.state.version = build.version;
      if (build.channel !== "stable") {
        this.state.reason =
          build.channel === "nightly" ? "nightly" : "development";
        return;
      }
      if (process.platform !== "win32" || process.arch !== "x64") {
        this.state.reason = "unsupported";
        return;
      }
      this.install = await detectInstall(this.root);
      this.state.method = this.install.method;
      this.state.reason =
        this.install.method === "disabled"
          ? (this.install.reason ?? "unknown")
          : undefined;
      if (await exists(this.result)) {
        const error = await json(this.result);
        if (typeof error === "string")
          this.state = { ...this.state, status: "error", error };
      }
    } catch (error) {
      // Missing build metadata is expected in development; never guess an update destination.
      console.warn("App update unavailable:", error);
    }
  }

  /** `background`: unprompted startup check; a failure leaves no error in the UI. */
  async check({ background = false } = {}) {
    await this.info();
    if (this.busy || this.state.method === "disabled") return;
    // Never replace a result the user already saw (e.g. a prior manual check).
    if (background && this.state.status !== "idle") return;
    this.busy = true;
    this.release = undefined;
    this.publish({ status: "checking", error: undefined, latest: undefined });
    try {
      const response = await fetch(
        "https://api.github.com/repos/cotrin8672/pig/releases/latest",
        {
          headers: { Accept: "application/vnd.github+json" },
          signal: AbortSignal.timeout(30_000),
        },
      );
      if (!response.ok) throw new Error(`GitHub: HTTP ${response.status}`);
      const release = parseRelease(await response.json());
      if (!newerVersion(release.version, this.state.version)) {
        this.publish({ status: "current" });
        return;
      }
      const checksum = await fetch(`${release.url}.sha256`, {
        signal: AbortSignal.timeout(30_000),
      });
      if (!checksum.ok) throw new Error(`Checksum: HTTP ${checksum.status}`);
      this.release = { ...release, hash: parseChecksum(await checksum.text()) };
      this.publish({ status: "available", latest: release.version });
    } catch (error) {
      if (background) {
        console.warn("Background update check failed:", error);
        this.publish({ status: "idle" });
      } else this.publish({ status: "error", error: String(error) });
    } finally {
      this.busy = false;
    }
  }

  async apply() {
    await this.info();
    if (
      this.busy ||
      !this.release ||
      !this.install ||
      this.install.method === "disabled"
    )
      return;
    this.busy = true;
    this.publish({ status: "preparing", error: undefined });
    let work: string | undefined;
    let stage: string | undefined;
    let handedOff = false;
    try {
      const release = this.release;
      work = await mkdtemp(join(tmpdir(), "pig-update-"));
      const script = join(work, "update.ps1");
      const config = join(work, "config.json");
      stage = join(dirname(this.root), `.pig-update-${randomUUID()}`);
      // Electrobun copies build.copy destinations under Resources/app.
      await copyFile(join(this.root, "Resources/app/app-update.ps1"), script);
      const zip = join(work, "update.zip");
      if (this.install.method === "portable") {
        if (!stableVersion(release.version))
          throw new Error("Invalid release version");
        const url = new URL(`${releaseBase}/v${release.version}/${updateZip}`);
        if (
          url.origin !== "https://github.com" ||
          !/^\/cotrin8672\/pig\/releases\/download\/v\d+\.\d+\.\d+\/pig-windows-x64\.zip$/.test(
            url.pathname,
          )
        )
          throw new Error("Untrusted update URL");
        const response = await fetch(url, {
          signal: AbortSignal.timeout(5 * 60_000),
        });
        if (!response.ok || !response.body)
          throw new Error(`Download: HTTP ${response.status}`);
        // Bound disk use even if a server omits or lies about Content-Length.
        const writer = Bun.file(zip).writer();
        const hash = createHash("sha256");
        let size = 0;
        const reader = response.body.getReader();
        try {
          while (true) {
            const { done, value: chunk } = await reader.read();
            if (done) break;
            size += chunk.length;
            if (size > 1024 ** 3)
              throw new Error("Update download exceeds 1 GiB");
            hash.update(chunk);
            writer.write(chunk);
            await writer.flush();
          }
        } finally {
          await reader.cancel().catch(() => {});
          await writer.end();
        }
        if (hash.digest("hex") !== release.hash)
          throw new Error("ZIP checksum mismatch");
      }
      await writeFile(
        config,
        JSON.stringify({
          ...this.install,
          ...release,
          root: this.root,
          originalRoot: this.originalRoot,
          zip,
          stage,
          result: this.result,
          pid: process.pid,
          task: `pig-update-${randomUUID()}`,
        }),
      );
      await runHelper(script, config, "-Prepare");
      const ready = join(work, "ready");
      const commitFile = join(work, "commit");
      const committed = await this.shutdown(async () => {
        await rm(this.result, { force: true });
        await runHelper(script, config, "-Launch");
        const deadline = Date.now() + 15_000;
        while (!(await exists(ready))) {
          if (Date.now() > deadline)
            throw new Error(
              "Update helper did not start. Use the CLI or update manually.",
            );
          await Bun.sleep(100);
        }
        return async () => {
          this.publish({ status: "restarting" });
          await writeFile(commitFile, "commit");
          handedOff = true;
        };
      });
      if (!committed) this.publish({ status: "available" });
    } catch (error) {
      this.publish({ status: "error", error: String(error) });
    } finally {
      if (!handedOff) {
        if (work)
          await writeFile(join(work, "cancel"), "cancel").catch(() => {});
        if (stage)
          await rm(stage, { force: true, recursive: true }).catch(() => {});
        // Retain failed preparation logs for troubleshooting; successful cancellation needs no ZIP.
        if (work)
          await rm(join(work, "update.zip"), { force: true }).catch(() => {});
      }
      this.busy = false;
    }
  }
}
