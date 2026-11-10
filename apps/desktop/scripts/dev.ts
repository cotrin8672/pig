import { watch } from "node:fs";

// Dev loop: Vite serves the webview with HMR (index.ts loads it when :5173 answers).
// Bun host changes restart the app here, not via `electrobun dev --watch`: on Windows
// that kills only the launcher, so the still-running app keeps build/ locked (EACCES).
const run = (cmd: string[]) =>
  Bun.spawn([Bun.which(cmd[0]) ?? cmd[0], ...cmd.slice(1)], {
    stdio: ["inherit", "inherit", "inherit"],
  });
const killTree = (proc: Bun.Subprocess) =>
  process.platform === "win32"
    ? Bun.spawnSync(["taskkill", "/PID", String(proc.pid), "/T", "/F"])
    : proc.kill();

const vite = run(["vite"]);
for (let tries = 0; ; tries++) {
  try {
    await fetch("http://localhost:5173", { method: "HEAD" });
    break;
  } catch {
    if (tries > 300 || vite.exitCode !== null) {
      vite.kill();
      throw new Error("Vite dev server did not start on :5173");
    }
    await Bun.sleep(100);
  }
}

let restarting = false;
let app = run(["electrobun", "dev"]);
let timer: ReturnType<typeof setTimeout> | undefined;
const restart = async () => {
  restarting = true;
  console.log("[dev] Bun host changed, restarting app...");
  killTree(app);
  await app.exited;
  app = run(["electrobun", "dev"]);
  restarting = false;
};
for (const dir of ["src/bun", "src/shared"])
  watch(dir, { recursive: true }, (_event, file) => {
    if (file?.includes(".test.")) return;
    clearTimeout(timer);
    timer = setTimeout(restart, 300);
  });

const stop = () => {
  killTree(app);
  vite.kill();
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
// Closing the window (exit 0) ends the session. A failed build (e.g. a file saved
// mid-edit) keeps watching; the next change triggers another build.
for (;;) {
  const current = app;
  const code = await current.exited;
  if (current === app && !restarting) {
    if (code === 0) {
      vite.kill();
      process.exit(0);
    }
    console.log(`[dev] App exited (${code}); waiting for the next change...`);
    while (current === app) await Bun.sleep(200);
  }
  await Bun.sleep(100);
}
