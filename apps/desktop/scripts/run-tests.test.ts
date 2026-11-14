import { expect, test } from "bun:test";
import { relative } from "node:path";
import { fileURLToPath } from "node:url";
import { runTests, testFiles, unitTestWorkers } from "./run-tests";

const desktop = fileURLToPath(new URL("..", import.meta.url));
const files = (suite: "unit" | "integration" | "ui") =>
  testFiles(suite).map((file) => relative(desktop, file).replaceAll("\\", "/"));

test("every source test belongs to exactly one suite; packaging checks stay on the fast path", () => {
  const unit = files("unit"),
    integration = files("integration"),
    ui = files("ui");
  const all = [...unit, ...integration, ...ui];
  expect(new Set(all).size).toBe(all.length);
  const source = [
    ...new Bun.Glob("src/**/*.test.{ts,tsx}").scanSync(desktop),
  ].map((file) => file.replaceAll("\\", "/"));
  expect(all.filter((file) => file.startsWith("src/")).sort()).toEqual(
    source.sort(),
  );
  expect(unit).toContain("scripts/sdk-runtime-assets.test.ts");
  expect(unit).toContain("scripts/post-build.test.ts");
  expect(unit).toContain("src/bun/app-update.test.ts");
  expect(integration).toContain("src/bun/session-adapters.test.ts");
  expect(integration).toContain("src/bun/app-update-windows.test.ts");
  expect(ui).toContain("src/mainview/transcript-ui.test.ts");
  expect(ui).not.toContain("src/mainview/sdk-ui.test.ts");
});

test("unit workers follow the CPU budget up to eight without oversubscribing small CI runners", () => {
  for (const cpuCount of [1, 2, 4, 8, 16, 32])
    expect(unitTestWorkers(cpuCount)).toBe(Math.min(cpuCount, 8));
});

test("unit workers can be overridden explicitly for local and CI comparisons", () => {
  expect(unitTestWorkers(16, "4")).toBe(4);
  expect(unitTestWorkers(16, "8")).toBe(8);
  expect(unitTestWorkers(2, "16")).toBe(16);
  for (const value of [
    "",
    "0",
    "-1",
    "1.5",
    "NaN",
    "Infinity",
    "4x",
    " 4",
    "1e2",
    "9007199254740992",
  ])
    expect(() => unitTestWorkers(16, value)).toThrow(
      "PIG_TEST_WORKERS must be a positive integer.",
    );
});

test("explicit UI checks fail instead of skipping when the browser is missing", async () => {
  const previous = process.env.PIG_UI_BROWSER;
  process.env.PIG_UI_BROWSER = fileURLToPath(
    new URL("./missing-browser.exe", import.meta.url),
  );
  try {
    await expect(runTests("ui")).rejects.toThrow(
      "UI checks require Edge/Chromium",
    );
  } finally {
    if (previous === undefined) delete process.env.PIG_UI_BROWSER;
    else process.env.PIG_UI_BROWSER = previous;
  }
});
