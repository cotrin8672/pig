import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { stageTauriApp } from "./stage-tauri-app";
import { tauriSmokeProfile } from "./tauri-smoke-profile";

if (process.platform !== "win32")
  throw new Error("The Tauri app targets Windows/WebView2.");

const desktop = fileURLToPath(new URL("..", import.meta.url));
const smoke = process.argv.includes("--smoke");
const packageApp = process.argv.includes("--package");
const env = {
  ...process.env,
  PIG_TAURI_BUN: process.execPath,
  PIG_TAURI_SMOKE: smoke ? "1" : "",
};
const target = resolve(
  desktop,
  process.env.CARGO_TARGET_DIR ?? "src-tauri/target",
);
const executable = join(
  target,
  packageApp && !smoke ? "release" : "debug",
  "pig-tauri-preview.exe",
);

for (const args of [
  [
    "node",
    join(desktop, "node_modules/vite/bin/vite.js"),
    "build",
    ...(smoke ? ["--mode", "tauri-smoke"] : []),
  ],
  [
    "cargo",
    "build",
    "--locked",
    "--manifest-path",
    "src-tauri/Cargo.toml",
    "-p",
    "pig-tauri-preview",
    "-p",
    "pig-remote",
    "--target-dir",
    target,
    ...(packageApp && !smoke ? ["--release"] : []),
  ],
]) {
  const child = Bun.spawn(args, {
    cwd: desktop,
    env,
    stdout: "inherit",
    stderr: "inherit",
  });
  const code = await child.exited;
  if (code !== 0) process.exit(code ?? 1);
}

const portable = packageApp
  ? await stageTauriApp(desktop, executable, smoke)
  : undefined;
if (portable && !smoke) {
  console.log(`Portable Tauri build: ${portable}`);
  process.exit(0);
}

const fixture = smoke ? await tauriSmokeProfile() : undefined;
let relocated: string | undefined;
try {
  const runtimeEnv: NodeJS.ProcessEnv = env;
  if (fixture) {
    for (const name of Object.keys(runtimeEnv)) {
      if (
        /API_KEY|TOKEN|SECRET|PASSWORD|PI_CODING_AGENT_|NODE_PATH|WEBVIEW2_|_PROXY/i.test(
          name,
        )
      )
        delete runtimeEnv[name];
    }
    Object.assign(runtimeEnv, fixture.env);
  }
  if (portable) {
    relocated = await mkdtemp(join(tmpdir(), "pig-tauri-relocated-"));
    await cp(portable, relocated, { recursive: true });
    delete runtimeEnv.PIG_TAURI_BUN;
    const system = runtimeEnv.SystemRoot ?? "C:\\Windows";
    for (const key of Object.keys(runtimeEnv))
      if (key.toLowerCase() === "path") delete runtimeEnv[key];
    runtimeEnv.Path = `${system}\\System32;${system}`;
  }
  const app = Bun.spawn([relocated ? join(relocated, "pig.exe") : executable], {
    cwd: relocated ?? desktop,
    env: runtimeEnv,
    stdout: smoke ? "pipe" : "inherit",
    stderr: "inherit",
    timeout: smoke ? 55_000 : undefined,
  });
  const [code, output] = await Promise.all([
    app.exited,
    app.stdout ? new Response(app.stdout).text() : "",
  ]);
  if (output) process.stdout.write(output);
  if (
    fixture &&
    (!output.split(/\r?\n/).includes("pig-tauri-smoke: pass") ||
      fixture.requests() !== 1)
  ) {
    throw new Error(
      `Tauri native smoke did not pass (model requests: ${fixture.requests()}).`,
    );
  }
  process.exitCode = code ?? 1;
} finally {
  await fixture?.dispose();
  if (relocated)
    await rm(relocated, {
      recursive: true,
      force: true,
      maxRetries: 8,
      retryDelay: 100,
    });
}
