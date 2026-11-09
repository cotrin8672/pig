import { watch } from "node:fs";

// Dev loop: Vite serves the webview with HMR (index.ts loads it when :5173 answers).
// Bun host changes restart the app here, not via `electrobun dev --watch`: on Windows
// that kills only the launcher, so the still-running app keeps build/ locked (EACCES).
const rtk = Bun.which("rtk");
if (!rtk)
  throw new Error(
    "RTK is required. Run dev through mise exec -- rtk proxy pnpm dev.",
  );
const executable = (name: string) => {
  const path = Bun.which(name);
  if (!path)
    throw new Error(`Development executable is missing from PATH: ${name}`);
  return path;
};
const run = (cmd: string[]) =>
  Bun.spawn([rtk, "proxy", executable(cmd[0]), ...cmd.slice(1)], {
    stdio: ["inherit", "inherit", "inherit"],
    detached: process.platform !== "win32",
  });
const killTree = (proc: Bun.Subprocess) => {
  if (proc.exitCode !== null) return;
  if (process.platform === "win32") {
    const result = Bun.spawnSync(
      [
        rtk,
        "proxy",
        executable("taskkill"),
        "/PID",
        String(proc.pid),
        "/T",
        "/F",
      ],
      { stdio: ["ignore", "ignore", "inherit"] },
    );
    if (result.exitCode !== 0 && proc.exitCode === null)
      throw new Error(`Could not stop development process tree ${proc.pid}`);
  } else {
    // RTK adds a supervisor: terminate the entire detached group, not only RTK.
    process.kill(-proc.pid, "SIGTERM");
  }
};

const vite = run(["vite"]);
for (let tries = 0; ; tries++) {
  try {
    await fetch("http://localhost:5173", { method: "HEAD" });
    break;
  } catch {
    if (tries > 300 || vite.exitCode !== null) {
      killTree(vite);
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
  killTree(vite);
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
      killTree(vite);
      process.exit(0);
    }
    console.log(`[dev] App exited (${code}); waiting for the next change...`);
    while (current === app) await Bun.sleep(200);
  }
  await Bun.sleep(100);
}
