import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

// Opt-in real Windows/WebView2 check; no credentials or existing app/profile are used.
if (process.platform !== "win32" || !process.argv[2])
  throw new Error(
    "Usage: bun scripts/windows-smoke.ts <extracted stable bundle>",
  );
const bundle = resolve(process.argv[2]);
let metadata: { channel?: string };
try {
  metadata = JSON.parse(
    await readFile(join(bundle, "Resources/version.json"), "utf8"),
  );
} catch (cause) {
  throw new Error("Cannot read the extracted bundle's version metadata", {
    cause,
  });
}
assert.equal(
  metadata.channel,
  "stable",
  "Use a stable bundle, not the Vite/dev launcher",
);
const root = await mkdtemp(join(tmpdir(), "pig-windows-smoke-"));
const runtime = join(bundle, "bin/bun.exe");
const results: unknown[] = [];
console.log(`Windows smoke artifacts: ${root}`);
for (const [backdrop, expected] of [
  ["acrylic", 3],
  ["none", 1],
  ["mica", 2],
] as const) {
  const profile = join(root, backdrop);
  const config = join(profile, ".config/pig");
  const roaming = join(profile, "Roaming");
  const local = join(profile, "Local");
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    HOME: profile,
    USERPROFILE: profile,
    APPDATA: roaming,
    LOCALAPPDATA: local,
    ELECTROBUN_CONSOLE: "1",
  };
  for (const key of Object.keys(env))
    if (
      /API_KEY|TOKEN|SECRET|PASSWORD|PI_CODING_AGENT_DIR|NODE_PATH|WEBVIEW2_/.test(
        key,
      )
    )
      delete env[key];
  await Promise.all(
    [config, roaming, local].map((path) => mkdir(path, { recursive: true })),
  );
  await writeFile(
    join(config, "appearance.json"),
    JSON.stringify({
      backdrop,
      effect: "acrylic",
      opacity: { none: 0.78, acrylic: 0.78, mica: 0.78 },
    }),
  );
  const home = Bun.spawnSync(
    [runtime, "-e", 'console.log(require("os").homedir())'],
    { env },
  );
  assert.equal(home.exitCode, 0);
  assert.equal(home.stdout.toString().trim(), profile, "HOME must be isolated");
  const log = join(profile, "stdout.log");
  const child = Bun.spawn([join(bundle, "bin/launcher.exe")], {
    cwd: join(bundle, "bin"),
    env,
    stdin: "ignore",
    stdout: Bun.file(log),
    stderr: Bun.file(join(profile, "stderr.log")),
  });
  const stop = () =>
    Bun.spawnSync(["taskkill.exe", "/PID", String(child.pid), "/T", "/F"], {
      stdout: "ignore",
      stderr: "ignore",
    });
  process.on("exit", stop);
  const timeout = setTimeout(() => {
    console.error("Native smoke timed out");
    process.exit(1);
  }, 90_000);
  try {
    let ready = false;
    for (let attempt = 0; attempt < 120; attempt++) {
      assert.equal(
        child.exitCode,
        null,
        "Launcher exited before the window was ready",
      );
      const output = await readFile(log, "utf8");
      if (output.includes("[window] pig started")) {
        ready = true;
        break;
      }
      await Bun.sleep(250);
    }
    assert(ready, "App startup timed out");
    // Allow the asynchronous WebView2 controller and bundled React view to finish loading.
    await Bun.sleep(4000);
    const children = Bun.spawnSync([
      "powershell.exe",
      "-NoProfile",
      "-Command",
      `Get-CimInstance Win32_Process -Filter 'ParentProcessId=${child.pid}' | Where-Object Name -eq 'bun.exe' | Select-Object -ExpandProperty ProcessId`,
    ]);
    const pid = Number(children.stdout.toString().trim());
    assert(Number.isSafeInteger(pid) && pid > 0, "Runtime child PID not found");
    async function probe(action: string, screenshot = true) {
      const proc = Bun.spawn(
        [
          "powershell.exe",
          "-NoProfile",
          "-File",
          join(import.meta.dir, "windows-smoke.ps1"),
          "-ProcessId",
          String(pid),
          "-Executable",
          runtime,
          "-Action",
          action,
          ...(screenshot
            ? ["-Screenshot", join(profile, `${results.length}-${action}.png`)]
            : []),
        ],
        { stdout: "pipe", stderr: "pipe" },
      );
      const [output, error, exit] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ]);
      assert.equal(exit, 0, error);
      if (action === "close") return undefined;
      const native = JSON.parse(output) as {
        width: number;
        height: number;
        style: number;
        exStyle: number;
        dpi: number;
        maximized: boolean;
        minimized: boolean;
        backdrop: number;
        surfaces: number[][];
      };
      if (!native.minimized) {
        assert(
          native.surfaces.some(
            ([width, height]) =>
              width === native.width && height === native.height,
          ),
          `WebView2/client bounds mismatch: ${output}`,
        );
      }
      assert.equal(native.style & 0x000f0000, 0x000f0000, "Resize/Snap styles");
      assert.equal(native.style & 0x00c00000, 0, "No standard caption");
      assert(native.exStyle & 0x00200000, "Composition transparency");
      assert.equal(native.backdrop, expected, "Requested DWM backdrop");
      results.push({ backdrop, action, native });
      await writeFile(
        join(root, "results.json"),
        JSON.stringify(results, null, 2),
      );
      console.log(
        `PASS ${backdrop}/${action}: ${native.width}x${native.height}, DPI ${native.dpi}`,
      );
      return native;
    }
    await probe("inspect");
    await probe("resize");
    assert((await probe("maximize"))?.maximized);
    await probe("activate");
    assert(!(await probe("restore"))?.maximized);
    assert((await probe("minimize", false))?.minimized);
    assert(!(await probe("restore"))?.minimized);
    await probe("activate");
    if (process.argv.includes("--interactive")) await probe("drag");
    await probe("close", false);
    assert.equal(
      await Promise.race([
        child.exited,
        Bun.sleep(10000).then(() => "timeout"),
      ]),
      0,
      "Native close must exit cleanly",
    );
    assert(!(await readFile(log, "utf8")).includes("Cannot apply backdrop"));
  } finally {
    clearTimeout(timeout);
    if (child.exitCode === null) stop();
    process.off("exit", stop);
  }
}
console.log(
  "PASS native geometry/backdrops/activation/close. Review screenshots separately; mixed-DPI monitors still need manual testing. Mouse dragging runs only with --interactive.",
);
