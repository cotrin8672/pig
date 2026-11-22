import { join } from "node:path";
import { fileURLToPath } from "node:url";

if (process.platform !== "win32")
  throw new Error("The Tauri preview targets Windows/WebView2.");

const desktop = fileURLToPath(new URL("..", import.meta.url));
const smoke = process.argv.includes("--smoke");
const env = {
  ...process.env,
  PIG_TAURI_BUN: process.execPath,
  PIG_TAURI_SMOKE: smoke ? "1" : "",
};
const executable = join(
  desktop,
  "src-tauri",
  "target",
  "debug",
  "pig-tauri-preview.exe",
);

for (const args of [
  [
    "node",
    join(desktop, "node_modules/vite/bin/vite.js"),
    "build",
    "--config",
    "vite.tauri.config.ts",
  ],
  [
    "cargo",
    "build",
    "--locked",
    "--manifest-path",
    "src-tauri/Cargo.toml",
    "--target-dir",
    "src-tauri/target",
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

const app = Bun.spawn([executable], {
  cwd: desktop,
  env,
  stdout: smoke ? "pipe" : "inherit",
  stderr: "inherit",
  timeout: smoke ? 20_000 : undefined,
});
const [code, output] = await Promise.all([
  app.exited,
  app.stdout ? new Response(app.stdout).text() : "",
]);
if (output) process.stdout.write(output);
if (smoke && !output.split(/\r?\n/).includes("pig-tauri-smoke: pass")) {
  console.error("The Tauri preview did not complete its smoke checks.");
  process.exitCode = 1;
} else {
  process.exitCode = code ?? 1;
}
