import { afterEach, expect, test } from "bun:test";
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(
    dirs.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});
const windowsTest = process.platform === "win32" ? test : test.skip;
const installer = resolve(import.meta.dir, "../../../../install.ps1");
const powershell = join(
  process.env.SystemRoot ?? "C:\\Windows",
  "System32/WindowsPowerShell/v1.0/powershell.exe",
);

async function run(
  executable: string,
  script: string,
  args: string[],
  env = process.env,
) {
  const child = Bun.spawn(
    [
      executable,
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      script,
      ...args,
    ],
    { env, stdout: "pipe", stderr: "pipe", windowsHide: true },
  );
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { code, stdout, stderr };
}

async function fixture() {
  const base = await mkdtemp(join(tmpdir(), "pig-install-test-"));
  dirs.push(base);
  const setup = join(base, "fixtures.ps1");
  await writeFile(
    setup,
    `param([string]$Base)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
foreach ($kind in @('good', 'traversal', 'duplicate', 'ads', 'symlink', 'nightly', 'wrong-version')) {
  $zip = [IO.Compression.ZipFile]::Open((Join-Path $Base "$kind.zip"), 'Create')
  try {
    $entries = @{
      'bin/launcher.exe' = 'fixture';
      'Resources/app-update.ps1' = 'fixture';
      'Resources/app-build.json' = ('{"channel":"' + $(if ($kind -eq 'nightly') {'nightly'} else {'stable'}) + '","version":"0.3.0","commit":"abc"}');
      'Resources/version.json' = ('{"identifier":"dev.pig.desktop","channel":"stable","version":"' + $(if ($kind -eq 'wrong-version') {'0.2.0'} else {'0.3.0'}) + '"}')
    }
    if ($kind -eq 'traversal') { $entries['../../outside.txt'] = 'bad' }
    if ($kind -eq 'ads') { $entries['bin/launcher.exe:evil'] = 'bad' }
    foreach ($name in $entries.Keys) {
      $entry = $zip.CreateEntry($name)
      $writer = [IO.StreamWriter]::new($entry.Open())
      $writer.Write($entries[$name]); $writer.Dispose()
    }
    if ($kind -eq 'duplicate') { $zip.CreateEntry('BIN/launcher.exe') | Out-Null }
    if ($kind -eq 'symlink') {
      $entry = $zip.CreateEntry('linked')
      $entry.ExternalAttributes = -1610612736
    }
  } finally { $zip.Dispose() }
}
`,
  );
  const result = await run(powershell, setup, ["-Base", base]);
  expect({ code: result.code, stderr: result.stderr }).toEqual({
    code: 0,
    stderr: "",
  });
  const wrapper = join(base, "run.ps1");
  await writeFile(
    wrapper,
    `param([string]$Installer, [string]$CaseDir, [string]$FixtureZip)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
# Only network and user-registry writes are mocked. ZIP handling and COM shortcuts are real.
function Invoke-RestMethod {
  param($Uri, $Headers, $TimeoutSec)
  if ($Uri -cne 'https://api.github.com/repos/cotrin8672/pig/releases/latest') { throw 'Unexpected API URL' }
  Add-Content -LiteralPath "$CaseDir/downloads" -Value $Uri
  return (Get-Content -LiteralPath "$CaseDir/release.json" -Raw | ConvertFrom-Json)
}
function Invoke-WebRequest {
  param($Uri, $OutFile, [switch]$UseBasicParsing, $TimeoutSec)
  if ($Uri -cnotmatch '^https://github.com/cotrin8672/pig/releases/download/v0\\.3\\.0/pig-windows-x64\\.zip(\\.sha256)?$') { throw 'Unexpected download URL' }
  Add-Content -LiteralPath "$CaseDir/downloads" -Value $Uri
  if ($Uri.EndsWith('.sha256')) { Copy-Item -LiteralPath "$CaseDir/checksum" -Destination $OutFile }
  else { Copy-Item -LiteralPath $FixtureZip -Destination $OutFile }
}
function Get-ItemProperty {
  param($LiteralPath, $Name, $ErrorAction)
  if ($LiteralPath -ne 'HKCU:\\Environment' -or $Name -ne 'Path') { throw 'Unexpected registry read' }
  return [pscustomobject]@{ Path = [IO.File]::ReadAllText("$CaseDir/user-path") }
}
function Set-ItemProperty {
  param($LiteralPath, $Name, $Value)
  if ($LiteralPath -ne 'HKCU:\\Environment' -or $Name -ne 'Path') { throw 'Unexpected registry write' }
  [IO.File]::WriteAllText("$CaseDir/user-path", $Value)
  Add-Content -LiteralPath "$CaseDir/registry-writes" -Value 'Path'
}
try {
  $ErrorActionPreference = 'Continue'
  $ProgressPreference = 'Continue'
  Get-Content -LiteralPath $Installer -Raw | Invoke-Expression
  if ($ErrorActionPreference -ne 'Continue' -or $ProgressPreference -ne 'Continue' -or
      (Get-Command Assert-Bundle -ErrorAction SilentlyContinue)) { throw 'Installer leaked its scope' }
  $link = [PigInstall.Shortcut]::Read((Join-Path $env:APPDATA 'Microsoft\\Windows\\Start Menu\\Programs\\pig.lnk'))
  @{
    target = $link[0];
    workingDirectory = $link[1];
    path = $env:Path
  } | ConvertTo-Json | Set-Content -LiteralPath "$CaseDir/result.json" -Encoding UTF8
} catch {
  [Console]::Error.WriteLine($_.Exception.Message)
  [Console]::Error.WriteLine($_.ScriptStackTrace)
  exit 1
}
`,
  );
  async function prepare(kind: string, userPath = "C:\\Existing") {
    const caseDir = await mkdtemp(join(base, `${kind}-`));
    const env = {
      ...process.env,
      LOCALAPPDATA: join(caseDir, "local data 日本語"),
      APPDATA: join(caseDir, "roaming 日本語"),
      USERPROFILE: join(caseDir, "home 日本語"),
      PATH: [
        join(process.env.SystemRoot ?? "C:\\Windows", "System32"),
        join(
          process.env.SystemRoot ?? "C:\\Windows",
          "System32/WindowsPowerShell/v1.0",
        ),
      ].join(";"),
    };
    delete (env as NodeJS.ProcessEnv).Path;
    const app = join(env.LOCALAPPDATA, "Programs/pig");
    const bin = join(env.USERPROFILE, ".local/bin");
    const zip = join(base, `${kind === "bad-hash" ? "good" : kind}.zip`);
    const hash =
      kind === "bad-hash"
        ? "0".repeat(64)
        : new Bun.CryptoHasher("sha256")
            .update(await readFile(zip))
            .digest("hex");
    const release = {
      tag_name: "v0.3.0",
      draft: false,
      prerelease: false,
      assets: ["pig-windows-x64.zip", "pig-windows-x64.zip.sha256"].map(
        (name) => ({
          name,
          browser_download_url: `https://github.com/cotrin8672/pig/releases/download/v0.3.0/${name}`,
        }),
      ),
    };
    await writeFile(join(caseDir, "release.json"), JSON.stringify(release));
    await writeFile(
      join(caseDir, "checksum"),
      `${hash}  pig-windows-x64.zip\n`,
    );
    await writeFile(join(caseDir, "user-path"), userPath);
    return {
      caseDir,
      app,
      bin,
      env,
      release,
      execute: (executable = powershell) =>
        run(
          executable,
          wrapper,
          ["-Installer", installer, "-CaseDir", caseDir, "-FixtureZip", zip],
          env,
        ),
    };
  }
  return { prepare };
}

windowsTest(
  "one-line install verifies the bundle and registers a Unicode-safe command, PATH and real shortcut",
  async () => {
    const f = await fixture();
    for (const executable of [
      powershell,
      ...([Bun.which("pwsh")].filter(Boolean) as string[]),
    ]) {
      const c = await f.prepare("good");
      const first = await c.execute(executable);
      expect({ code: first.code, stderr: first.stderr }).toEqual({
        code: 0,
        stderr: "",
      });
      expect(await Bun.file(join(c.app, "bin/launcher.exe")).text()).toBe(
        "fixture",
      );
      const shim = await Bun.file(join(c.bin, "pig.cmd")).text();
      expect(shim).toContain(
        '"%LOCALAPPDATA%\\Programs\\pig\\bin\\launcher.exe"',
      );
      expect(shim).toContain("%*");
      const bin = await realpath(c.bin);
      expect(await Bun.file(join(c.caseDir, "user-path")).text()).toBe(
        `C:\\Existing;${bin}`,
      );
      const info = JSON.parse(
        (await Bun.file(join(c.caseDir, "result.json")).text()).replace(
          /^\uFEFF/,
          "",
        ),
      );
      expect(info.target).toBe(await realpath(join(c.app, "bin/launcher.exe")));
      expect(info.workingDirectory).toBe(await realpath(join(c.app, "bin")));
      expect(info.path.split(";")).toContain(bin);
      const requests = await Bun.file(join(c.caseDir, "downloads")).text();
      await writeFile(join(c.app, "keep"), "existing app files");
      const again = await c.execute(executable);
      expect({ code: again.code, stderr: again.stderr }).toEqual({
        code: 0,
        stderr: "",
      });
      expect(await Bun.file(join(c.app, "keep")).text()).toBe(
        "existing app files",
      );
      expect(await Bun.file(join(c.caseDir, "downloads")).text()).toBe(
        requests,
      );
      expect(
        (await Bun.file(join(c.caseDir, "registry-writes")).text()).trim(),
      ).toBe("Path");
    }
  },
  90_000,
);

windowsTest(
  "bad hashes, unsafe ZIPs and non-Stable bundles never install or leave staging files",
  async () => {
    const f = await fixture();
    for (const [kind, error] of [
      ["bad-hash", "ZIP checksum mismatch"],
      ["traversal", "Unsafe ZIP entry"],
      ["duplicate", "Invalid or duplicate ZIP entry"],
      ["ads", "Unsafe ZIP entry"],
      ["symlink", "Unsafe ZIP entry"],
      ["nightly", "Not a valid pig Stable portable bundle"],
      ["wrong-version", "Not a valid pig Stable portable bundle"],
    ]) {
      const c = await f.prepare(kind);
      const result = await c.execute();
      expect(result.code, `${kind}: ${result.stderr}`).toBe(1);
      expect(result.stderr, kind).toContain(error);
      expect(await Bun.file(join(c.app, "bin/launcher.exe")).exists()).toBe(
        false,
      );
      expect(await Bun.file(join(c.bin, "pig.cmd")).exists()).toBe(false);
      expect(
        (await readdir(dirname(c.app))).filter((name) =>
          name.startsWith(".pig-install-"),
        ),
      ).toEqual([]);
      expect(await Bun.file(join(c.caseDir, "user-path")).text()).toBe(
        "C:\\Existing",
      );
      expect(await Bun.file(join(c.caseDir, "outside.txt")).exists()).toBe(
        false,
      );
    }
  },
  60_000,
);

windowsTest(
  "installation preserves unrelated files and rejects foreign release URLs without downloading them",
  async () => {
    const f = await fixture();
    for (const kind of ["app", "command", "exe", "path-command", "release"]) {
      const c = await f.prepare("good");
      const candidates: Record<string, string> = {
        app: join(c.app, "keep"),
        command: join(c.bin, "pig.cmd"),
        exe: join(c.bin, "pig.exe"),
        "path-command": join(c.caseDir, "other", "pig.cmd"),
      };
      const existing = candidates[kind];
      if (existing) {
        await mkdir(dirname(existing), { recursive: true });
        await writeFile(existing, "user-owned data");
        if (kind === "path-command")
          c.env.PATH = `${dirname(existing)};${c.env.PATH}`;
      } else {
        c.release.assets[0].browser_download_url =
          "https://example.invalid/payload.zip";
        await writeFile(
          join(c.caseDir, "release.json"),
          JSON.stringify(c.release),
        );
      }
      const result = await c.execute();
      expect(result.code, result.stderr).toBe(1);
      if (existing)
        expect(await Bun.file(existing).text()).toBe("user-owned data");
      const requests = await Bun.file(join(c.caseDir, "downloads"))
        .text()
        .catch(() => "");
      expect(requests).not.toContain("/releases/download/");
    }
    const c = await f.prepare(
      "good",
      "C:\\Existing;%USERPROFILE%\\.local\\bin;C:\\Other",
    );
    const result = await c.execute();
    expect({ code: result.code, stderr: result.stderr }).toEqual({
      code: 0,
      stderr: "",
    });
    expect(await Bun.file(join(c.caseDir, "user-path")).text()).toBe(
      "C:\\Existing;%USERPROFILE%\\.local\\bin;C:\\Other",
    );
    expect(await Bun.file(join(c.caseDir, "registry-writes")).exists()).toBe(
      false,
    );
  },
  60_000,
);
