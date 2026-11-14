import { existsSync } from "node:fs";
import { availableParallelism } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export type TestSuite = "unit" | "integration" | "ui";
const desktop = fileURLToPath(new URL("..", import.meta.url));

// Real SDK startup, native processes and large storage fixtures belong off the PR path.
const integration = [
  "app-update-windows",
  "extension-ui",
  "fonts",
  "model-runtime",
  "model-runtime-performance",
  "model-settings",
  "optimistic-host",
  "pi-data",
  "pi-service",
  "provider-account-login",
  "sdk-tools",
  "selection-order",
  "send-recovery-host",
  "send-recovery-store",
  "session-accounts",
  "session-adapters",
  "session-delete",
  "session-diagnostics",
  "session-files",
  "session-history",
  "session-host",
  "session-host-model-error",
  "session-host-performance",
  "session-host-postfix",
  "session-host-stop",
  "steering-queue",
].map((name) => `src/bun/${name}.test.ts`);
const ui = [
  "transcript-ui",
  "grep-ui",
  "sidebar-update-dot-ui",
  "session-resume-ui",
  "pane-updates-ui",
  "work-folding-ui",
  "history-paging-ui",
  "provider-usage-ui",
  "provider-usage-hover-ui",
  "provider-accounts-ui",
  "render-workers-ui",
  "dynamic-theme-ui",
  "search-ui",
  "composer-layers-ui",
  "context-indicator-ui",
  "effort-chip-ui",
].map((name) => `src/mainview/${name}.test.ts`);

export function testFiles(suite: TestSuite): string[] {
  const source = [...new Bun.Glob("src/**/*.test.{ts,tsx}").scanSync(desktop)];
  // lazy-routes.test.ts describes an obsolete loading policy; it was never in CI.
  const scripts = [
    "scripts/ui-style-rules.test.ts",
    "scripts/sdk-runtime-assets.test.ts",
    "scripts/post-build.test.ts",
    "scripts/run-tests.test.ts",
  ];
  for (const file of [...integration, ...ui, ...scripts])
    if (!existsSync(resolve(desktop, file)))
      throw new Error(`Test suite references a missing file: ${file}`);
  const slow = new Set([...integration, ...ui]);
  return (
    suite === "integration"
      ? integration
      : suite === "ui"
        ? ui
        : [
            ...source.filter((file) => !slow.has(file.replaceAll("\\", "/"))),
            ...scripts,
          ]
  ).map((file) => resolve(desktop, file));
}

export function unitTestWorkers(cpuCount: number, override?: string): number {
  if (override === undefined) return Math.min(cpuCount, 8);
  const workers = Number(override);
  if (!/^[1-9]\d*$/.test(override) || !Number.isSafeInteger(workers))
    throw new Error("PIG_TEST_WORKERS must be a positive integer.");
  return workers;
}

export async function runTests(suite: TestSuite): Promise<number> {
  const env = { ...process.env };
  const workers =
    suite === "unit"
      ? unitTestWorkers(availableParallelism(), env.PIG_TEST_WORKERS)
      : undefined;
  if (suite === "ui") {
    const browser =
      env.PIG_UI_BROWSER ??
      "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
    if (!existsSync(browser))
      throw new Error(
        "UI checks require Edge/Chromium; set PIG_UI_BROWSER to its executable.",
      );
    env.PIG_UI_BROWSER = browser;
    env.PIG_REQUIRE_UI_TESTS = "1";
  }
  const files = testFiles(suite);
  console.log(
    `${suite}: ${files.length} test files${workers === undefined ? "" : `, ${workers} workers`}`,
  );
  const child = Bun.spawn(
    [
      process.execPath,
      "test",
      ...(workers === undefined ? [] : [`--parallel=${workers}`]),
      ...files,
    ],
    {
      cwd: resolve(desktop, "../.."),
      env,
      stdout: "inherit",
      stderr: "inherit",
    },
  );
  return child.exited;
}

if (import.meta.main) {
  const suite = process.argv[2];
  if (suite !== "unit" && suite !== "integration" && suite !== "ui")
    throw new Error("Usage: bun scripts/run-tests.ts <unit|integration|ui>");
  process.exitCode = await runTests(suite);
}
