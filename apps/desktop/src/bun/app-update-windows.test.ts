import { afterEach, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(
    dirs.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

// Real Windows helpers in temporary directories, without touching Scoop or scheduling tasks.
const windowsTest = process.platform === "win32" ? test : test.skip;
windowsTest("scheduled update worker starts PowerShell hidden", async () => {
  const base = await mkdtemp(join(tmpdir(), "pig-update-test-"));
  dirs.push(base);
  const config = join(base, "config 日本語.json");
  const capture = join(base, "action.json");
  const runner = join(base, "launch.ps1");
  const script = join(import.meta.dir, "../../scripts/app-update.ps1");
  await writeFile(
    config,
    JSON.stringify({
      method: "portable",
      task: `pig-update-test-${crypto.randomUUID()}`,
    }),
  );
  await writeFile(
    runner,
    `param([string]$Script, [string]$Config, [string]$Capture)
$ErrorActionPreference = 'Stop'
function New-ScheduledTaskAction {
  param($Execute, $Argument, $WorkingDirectory)
  [pscustomobject]@{ Execute = $Execute; Arguments = $Argument; WorkingDirectory = $WorkingDirectory }
}
function New-ScheduledTaskPrincipal { param($UserId, $LogonType, $RunLevel) }
function New-ScheduledTaskSettingsSet {
  param($ExecutionTimeLimit, [switch]$AllowStartIfOnBatteries, [switch]$DontStopIfGoingOnBatteries)
}
function Register-ScheduledTask {
  param($TaskName, $Action, $Principal, $Settings, [switch]$Force)
  $Action | Select-Object Execute, Arguments, WorkingDirectory | ConvertTo-Json | Set-Content -LiteralPath $Capture -Encoding UTF8
}
function Start-ScheduledTask { param($TaskName) }
& $Script -Config $Config -Launch
`,
  );
  const ps = join(
    process.env.SystemRoot ?? "C:\\Windows",
    "System32/WindowsPowerShell/v1.0/powershell.exe",
  );
  const child = Bun.spawn(
    [
      ps,
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      runner,
      "-Script",
      script,
      "-Config",
      config,
      "-Capture",
      capture,
    ],
    { stdout: "ignore", stderr: "pipe", windowsHide: true },
  );
  const stderr = await new Response(child.stderr).text();
  expect({ code: await child.exited, stderr }).toEqual({ code: 0, stderr: "" });
  const action = JSON.parse(
    (await readFile(capture, "utf8")).replace(/^\uFEFF/, ""),
  );
  expect(action.Execute).toBe(ps);
  expect(action.Arguments).toBe(
    `-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "${script}" -Config "${config}"`,
  );
  expect(action.WorkingDirectory).toBe(base);
});
windowsTest(
  "Windows ZIP preparation validates hashes, traversal, duplicates and bundle provenance",
  async () => {
    const base = await mkdtemp(join(tmpdir(), "pig-update-test-"));
    dirs.push(base);
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
      await writeFile(
        config,
        JSON.stringify({
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
        }),
      );
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
