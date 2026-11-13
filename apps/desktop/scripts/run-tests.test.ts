import { expect, test } from "bun:test";
import { relative } from "node:path";
import { fileURLToPath } from "node:url";
import { runTests, testFiles } from "./run-tests";

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
