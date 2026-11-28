import { lstatSync } from "node:fs";
import { copyFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { buildChatHistoryWorker, buildStatisticsWorker } from "./build-workers";
import { SDK_RUNTIME_EXTERNALS, stageSdkRuntime } from "./sdk-runtime-assets";

function refuseLink(path: string) {
  if (lstatSync(path, { throwIfNoEntry: false })?.isSymbolicLink())
    throw new Error(`Refusing to stage through a symlink: ${path}`);
}

/** An unpackaged Windows install: resource_dir() is the directory of pig.exe. */
export async function stageTauriApp(
  desktop: string,
  executable: string,
  smoke: boolean,
) {
  const output = join(
    desktop,
    "build",
    smoke ? "tauri-portable-smoke" : "tauri-portable",
  );
  const host = join(output, "host");
  const app = join(host, "app");
  const bin = join(host, "bin");
  const bundle = join(app, "bun");
  const modules = join(app, "node_modules");
  for (const path of [
    join(desktop, "build"),
    output,
    host,
    app,
    bin,
    bundle,
    modules,
  ])
    refuseLink(path);
  await mkdir(bin, { recursive: true });
  // The SDK stage must not contain our generated files while it is being verified.
  const sdk = stageSdkRuntime(desktop);
  const result = await Bun.build({
    entrypoints: [join(desktop, "src/bun/tauri-host.ts")],
    target: "bun",
    external: SDK_RUNTIME_EXTERNALS,
    outdir: bundle,
    naming: "tauri-host.js",
  });
  if (!result.success)
    throw new AggregateError(result.logs, "Bun host build failed");
  await Promise.all([
    buildStatisticsWorker(desktop),
    buildChatHistoryWorker(desktop),
  ]);

  const native = Bun.spawn(
    [
      "robocopy.exe",
      join(sdk, "node_modules"),
      modules,
      "/MIR",
      "/XJ",
      "/MT:8",
      "/R:1",
      "/W:1",
      "/NFL",
      "/NDL",
      "/NJH",
      "/NJS",
      "/NP",
    ],
    { stdout: "inherit", stderr: "inherit", windowsHide: true },
  );
  if ((await native.exited) >= 8)
    throw new Error("Could not stage the Pi SDK.");
  await Promise.all([
    copyFile(process.execPath, join(bin, "bun.exe")),
    copyFile(executable, join(output, "pig.exe")),
    copyFile(
      join(dirname(executable), "pig-remote.exe"),
      join(output, "pig-remote.exe"),
    ),
    copyFile(
      join(sdk, "sdk-runtime-manifest.json"),
      join(app, "sdk-runtime-manifest.json"),
    ),
    copyFile(
      join(desktop, "build/statistics/statistics-worker.js"),
      join(bundle, "statistics-worker.js"),
    ),
    copyFile(
      join(desktop, "build/chat-history/chat-history-worker.js"),
      join(bundle, "chat-history-worker.js"),
    ),
  ]);
  return output;
}
