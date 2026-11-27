import { existsSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { availableParallelism, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { removeFixtureDirectory, startFixtureBrowser } from "./ui-browser";

export type TestSuite = "unit" | "integration" | "ui";
const desktop = fileURLToPath(new URL("..", import.meta.url));

// Real SDK startup, native processes and large storage fixtures belong off the PR path.
const integration = [
  "chat-history-import",
  "local-chat-history",
  "app-update-windows",
  "extension-ui",
  "fonts",
  "install-windows",
  "mcp-apps-sdk",
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
  "session-fork",
  "session-history",
  "session-host",
  "session-host-model-error",
  "session-host-performance",
  "session-host-postfix",
  "session-host-stop",
  "session-suspension",
  "steering-queue",
  "statistics-host",
  "tauri-host",
].map((name) => `src/bun/${name}.test.ts`);
const ui = [
  "browser-context-ui",
  "mcp-apps-ui",
  "chat-history-import-ui",
  "statistics-ui",
  "transcript-ui",
  "annotation-selection-ui",
  "remote-recovery-ui",
  "grep-ui",
  "sidebar-update-dot-ui",
  "sidebar-resize-ui",
  "resize-ui",
  "session-status-ui",
  "notification-center-ui",
  "primitives-ui",
  "session-resume-ui",
  "runtime-suspension-ui",
  "pane-updates-ui",
  "work-folding-ui",
  "history-paging-ui",
  "provider-usage-ui",
  "provider-usage-hover-ui",
  "provider-accounts-ui",
  "render-workers-ui",
  "render-reuse-ui",
  "render-retention-ui",
  "output-dom-ui",
  "syntax-ranges-ui",
  "syntax-streaming-ui",
  "dynamic-theme-ui",
  "search-ui",
  "composer-layers-ui",
  "composer-editor-ui",
  "message-edit-ui",
  "context-indicator-ui",
  "effort-chip-ui",
  "markdown-blocks-ui",
  "file-drop-ui",
  "inactive-pane-composer-ui",
  "widget-ui",
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

export function unitTestWorkers(
  cpuCount: number,
  override?: string,
  githubActions = false,
): number {
  // SQLite flushes and child SDK starts contend on hosted Windows runners.
  if (override === undefined) return Math.min(cpuCount, githubActions ? 2 : 8);
  const workers = Number(override);
  if (!/^[1-9]\d*$/.test(override) || !Number.isSafeInteger(workers))
    throw new Error("PIG_TEST_WORKERS must be a positive integer.");
  return workers;
}

export async function runTests(suite: TestSuite): Promise<number> {
  const env = { ...process.env };
  const workers =
    suite === "unit"
      ? unitTestWorkers(
          availableParallelism(),
          env.PIG_TEST_WORKERS,
          env.GITHUB_ACTIONS === "true",
        )
      : undefined;
  let browser: string | undefined;
  if (suite === "ui") {
    browser =
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
  const spawnTests = () =>
    Bun.spawn(
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
  if (browser === undefined) return spawnTests().exited;

  const directory = await mkdtemp(join(tmpdir(), "pig-ui-suite-"));
  let child: ReturnType<typeof spawnTests> | undefined;
  let interrupted: number | undefined;
  let code = 0;
  const stop = (code: number) => {
    interrupted ??= code;
    child?.kill();
  };
  const interrupt = () => stop(130);
  const terminate = () => stop(143);
  process.on("SIGINT", interrupt);
  process.on("SIGTERM", terminate);
  try {
    const instance = await startFixtureBrowser(browser, directory);
    try {
      if (interrupted === undefined) {
        env.PIG_UI_BROWSER_ENDPOINT = instance.endpoint;
        child = spawnTests();
        code = await child.exited;
      }
    } finally {
      await instance.close();
    }
  } finally {
    try {
      await removeFixtureDirectory(directory);
    } finally {
      process.off("SIGINT", interrupt);
      process.off("SIGTERM", terminate);
    }
  }
  return interrupted ?? code;
}

if (import.meta.main) {
  const suite = process.argv[2];
  if (suite !== "unit" && suite !== "integration" && suite !== "ui")
    throw new Error("Usage: bun scripts/run-tests.ts <unit|integration|ui>");
  process.exitCode = await runTests(suite);
}
