import { copyFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";

// shortcut: pinned to Electrobun 1.18.1/win-x64; remove when upgrading to native drag support.
const commit = "4eba723c85b97559e1d9e13439d9a92ede0832e8";
const assets = [
  [
    "source.tar.gz",
    `https://github.com/blackboardsh/electrobun/archive/${commit}.tar.gz`,
    "ebac371b8f46604e860277e9b3557dfaaa6340715f9b92fa3e9e433dfa827ae7",
  ],
  [
    "cef.tar.bz2",
    "https://cef-builds.spotifycdn.com/cef_binary_147.0.10%2Bgd58e84d%2Bchromium-147.0.7727.118_windows64_minimal.tar.bz2",
    "41aa67ef79f9d202636e5f2365c68f447de7b26b1c84e6f318bbdcc0e037c16c",
  ],
  [
    "dawn.tar.gz",
    "https://github.com/blackboardsh/electrobun-dawn/releases/download/v0.2.3/electrobun-dawn-win32-x64.tar.gz",
    "534ffa9145c968f10d778634c34b698dbdbd02f2416d9ac480aaf71e91ec96f1",
  ],
  [
    "webview2.zip",
    "https://api.nuget.org/v3-flatcontainer/microsoft.web.webview2/1.0.4314.35/microsoft.web.webview2.1.0.4314.35.nupkg",
    "90778deb1b77e36292828b4b5833c9255c27533f40e0ddd55891ae718944edc4",
  ],
] as const;

export function patchNativeSource(source: string) {
  const settings = `view->setWebView(webview);
                            {
                                ComPtr<ICoreWebView2Settings> settings;
                                if (SUCCEEDED(webview->get_Settings(&settings)) && settings) {
                                    ComPtr<ICoreWebView2Settings9> settings9;
                                    if (SUCCEEDED(settings.As(&settings9)) && settings9) {
                                        settings9->put_IsNonClientRegionSupportEnabled(TRUE);
                                    }
                                }
                            }`;
  const style =
    "windowStyle = WS_VISIBLE | WS_CAPTION | WS_THICKFRAME | WS_CLIPCHILDREN | WS_CLIPSIBLINGS;";
  const resize = `            // WebView2 operations must be called from main thread to avoid TYPE_E_BADVARTYPE
            MainThreadDispatcher::dispatch_async([this, frame]() {
                HRESULT result = controller->put_Bounds(frame);
                if (FAILED(result)) {
                    char errorLog[256];
                    sprintf_s(errorLog, "[WebView2] put_Bounds failed for webview %u, HRESULT: 0x%08X", webviewId, result);
                    ::log(errorLog);
                }
            });`;
  for (const [before, after] of [
    ["view->setWebView(webview);", settings],
    [
      style,
      `${style.slice(0, -1)} | WS_SYSMENU | WS_MINIMIZEBOX | WS_MAXIMIZEBOX;`,
    ],
    [
      resize,
      resize
        .replace(
          "MainThreadDispatcher::dispatch_async([this, frame]() {",
          "auto applyBounds = [this, frame]() {",
        )
        .replace(
          "HRESULT result = controller->put_Bounds(frame);",
          `// Queued Bun updates must not restore an old size after WM_SIZE.
                RECT bounds = frame;
                if (fullSize && (!GetClientRect(hwnd, &bounds) || IsIconic(hwnd) || IsRectEmpty(&bounds))) return;
                HRESULT result = controller->put_Bounds(bounds);`,
        )
        .replace(
          "            });",
          `            };
            // WM_SIZE already runs on the UI thread; update before Windows paints.
            if (GetCurrentThreadId() == g_mainThreadId) applyBounds();
            else MainThreadDispatcher::dispatch_async(applyBounds);`,
        ),
    ],
  ]) {
    if (source.split(before).length !== 2)
      throw new Error(`Unexpected Electrobun native source: ${before}`);
    source = source.replace(before, after);
  }
  return source;
}

function run(args: string[], cwd: string, env = process.env) {
  const result = Bun.spawnSync(args, {
    cwd,
    env,
    stdio: ["ignore", "inherit", "inherit"],
  });
  if (result.exitCode !== 0)
    throw new Error(`Native build failed (${result.exitCode}): ${args[0]}`);
}

async function digest(path: string) {
  return new Bun.CryptoHasher("sha256")
    .update(await Bun.file(path).arrayBuffer())
    .digest("hex");
}

async function main() {
  if (process.env.ELECTROBUN_OS !== "win") return;
  if (process.platform !== "win32" || process.env.ELECTROBUN_ARCH !== "x64")
    throw new Error(
      "The native drag backport requires a Windows x64 build host/target.",
    );
  const { version } = await Bun.file(
    resolve("node_modules/electrobun/package.json"),
  ).json();
  if (version !== "1.18.1")
    throw new Error(
      "Revisit the native drag backport after upgrading Electrobun.",
    );
  const buildDir = process.env.ELECTROBUN_BUILD_DIR;
  const name = process.env.ELECTROBUN_APP_NAME;
  if (!buildDir || !name)
    throw new Error("Run this script through Electrobun postBuild.");
  const destination = resolve(buildDir, name, "bin/libNativeWrapper.dll");
  if (!existsSync(destination))
    throw new Error(`Native bundle DLL missing: ${destination}`);
  const cache = resolve(
    process.env.PI_SCRATCH_DIR ?? "build",
    "native-drag-build",
  );
  const work = join(cache, "work");
  const root = join(work, "package");
  // MSBuild tracking paths must stay short even inside a long session directory.
  const cefBuild = join(work, "b");
  const native = join(root, "src/native/win");
  const dll = join(native, "build/libNativeWrapper.dll");
  const fingerprintFile = join(cache, "fingerprint");
  const fingerprint = await digest(import.meta.path);
  if (
    !existsSync(dll) ||
    !(await Bun.file(fingerprintFile).exists()) ||
    (await Bun.file(fingerprintFile).text()) !== fingerprint
  ) {
    const archives = join(cache, "archives");
    mkdirSync(archives, { recursive: true });
    for (const [file, url, hash] of assets) {
      const path = join(archives, file);
      if (!existsSync(path) || (await digest(path)) !== hash) {
        console.log(`[native] Downloading ${file}`);
        const response = await fetch(url, {
          signal: AbortSignal.timeout(600_000),
        });
        if (!response.ok)
          throw new Error(
            `Native SDK download failed: ${response.status} ${url}`,
          );
        await Bun.write(`${path}.download`, response);
        if ((await digest(`${path}.download`)) !== hash)
          throw new Error(`Native SDK hash mismatch: ${file}`);
        rmSync(path, { force: true });
        await Bun.write(path, Bun.file(`${path}.download`));
        rmSync(`${path}.download`);
      }
    }
    rmSync(work, { recursive: true, force: true });
    mkdirSync(work, { recursive: true });
    run(
      [
        "tar.exe",
        "-xf",
        join(archives, "source.tar.gz"),
        "-C",
        work,
        "--strip-components=1",
      ],
      work,
    );
    const cef = join(root, "vendors/cef");
    const dawn = join(root, "vendors/wgpu/win-x64");
    const webview = join(root, "vendors/webview2/Microsoft.Web.WebView2");
    for (const [archive, target, strip] of [
      ["cef.tar.bz2", cef, true],
      ["dawn.tar.gz", dawn, true],
      ["webview2.zip", webview, false],
    ] as const) {
      mkdirSync(target, { recursive: true });
      run(
        [
          "tar.exe",
          "-xf",
          join(archives, archive),
          "-C",
          target,
          ...(strip ? ["--strip-components=1"] : []),
        ],
        work,
      );
    }
    await Bun.write(
      join(native, "nativeWrapper-pig.cpp"),
      patchNativeSource(
        await Bun.file(join(native, "nativeWrapper.cpp")).text(),
      ),
    );
    const vswhere = join(
      process.env["ProgramFiles(x86)"] ?? "C:/Program Files (x86)",
      "Microsoft Visual Studio/Installer/vswhere.exe",
    );
    const installation = Bun.spawnSync([
      vswhere,
      "-latest",
      "-products",
      "*",
      "-requires",
      "Microsoft.VisualStudio.Component.VC.Tools.x86.x64",
      "-property",
      "installationPath",
    ]);
    if (installation.exitCode !== 0 || !installation.stdout.toString().trim())
      throw new Error(
        "Install Visual Studio C++ Build Tools with CMake and the Windows SDK.",
      );
    const vcvars = join(
      installation.stdout.toString().trim(),
      "VC/Auxiliary/Build/vcvars64.bat",
    );
    const variables = Bun.spawnSync(
      ["cmd.exe", "/d", "/u", "/s", "/c", `"call "${vcvars}" >nul && set"`],
      { windowsVerbatimArguments: true },
    );
    if (variables.exitCode !== 0)
      throw new Error(
        `Cannot initialize Visual Studio: ${variables.stderr.toString()}`,
      );
    const env = Object.fromEntries(
      Object.entries(process.env).map(([key, value]) => [
        key.toUpperCase(),
        value,
      ]),
    );
    for (const line of variables.stdout.toString("utf16le").split(/\r?\n/)) {
      const equals = line.indexOf("=");
      if (equals > 0)
        env[line.slice(0, equals).toUpperCase()] = line.slice(equals + 1);
    }
    const tool = (name: string) => {
      const path = Bun.which(name, { PATH: env.PATH });
      if (!path) throw new Error(`Visual Studio build tool missing: ${name}`);
      return path;
    };
    const generator = env.VISUALSTUDIOVERSION?.startsWith("18.")
      ? "Visual Studio 18 2026"
      : "Visual Studio 17 2022";
    run(
      [
        tool("cmake"),
        "-S",
        cef,
        "-B",
        cefBuild,
        "-G",
        generator,
        "-A",
        "x64",
        "-DCEF_USE_SANDBOX=OFF",
        "-DCMAKE_BUILD_TYPE=Release",
      ],
      root,
      env,
    );
    run(
      [
        tool("cmake"),
        "--build",
        cefBuild,
        "--config",
        "Release",
        "--target",
        "libcef_dll_wrapper",
        "--parallel",
        "4",
      ],
      root,
      env,
    );
    mkdirSync(join(native, "build"), { recursive: true });
    const object = join(native, "build/nativeWrapper.obj");
    run(
      [
        tool("cl"),
        "/c",
        "/EHsc",
        "/std:c++20",
        "/utf-8",
        "/DNOMINMAX",
        "/MT",
        `/I${join(webview, "build/native/include")}`,
        `/I${cef}`,
        `/I${join(dawn, "include")}`,
        "/D_USRDLL",
        "/D_WINDLL",
        `/Fo${object}`,
        join(native, "nativeWrapper-pig.cpp"),
      ],
      root,
      env,
    );
    run(
      [
        tool("link"),
        "/DLL",
        `/OUT:${dll}`,
        "user32.lib",
        "ole32.lib",
        "shell32.lib",
        "shlwapi.lib",
        "advapi32.lib",
        "dcomp.lib",
        "d2d1.lib",
        "d3d12.lib",
        "kernel32.lib",
        "comctl32.lib",
        join(dawn, "lib/webgpu_dawn.lib"),
        join(webview, "build/native/x64/WebView2LoaderStatic.lib"),
        join(cef, "Release/libcef.lib"),
        join(cefBuild, "libcef_dll_wrapper/Release/libcef_dll_wrapper.lib"),
        "delayimp.lib",
        "/DELAYLOAD:libcef.dll",
        "/DELAYLOAD:webgpu_dawn.dll",
        "libcmt.lib",
        `/IMPLIB:${join(native, "build/libNativeWrapper.lib")}`,
        object,
      ],
      root,
      env,
    );
    await Bun.write(fingerprintFile, fingerprint);
  }
  copyFileSync(dll, destination);
  console.log(
    "[native] Installed Electrobun 1.18.1 native app-region backport.",
  );
}

if (import.meta.main) await main();
