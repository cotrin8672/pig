import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const browser =
  process.env.PIG_UI_BROWSER ??
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
if (!existsSync(browser)) {
  console.error(
    "UI checks require Edge/Chromium. Install it or set PIG_UI_BROWSER to its executable; checks must not silently skip.",
  );
  process.exitCode = 1;
} else {
  const child = Bun.spawn(
    [
      process.execPath,
      "test",
      fileURLToPath(
        new URL("../src/mainview/transcript-ui.test.ts", import.meta.url),
      ),
      fileURLToPath(
        new URL("../src/mainview/provider-usage-ui.test.ts", import.meta.url),
      ),
      fileURLToPath(
        new URL(
          "../src/mainview/provider-accounts-ui.test.ts",
          import.meta.url,
        ),
      ),
      fileURLToPath(
        new URL("../src/mainview/render-workers-ui.test.ts", import.meta.url),
      ),
      fileURLToPath(
        new URL("../src/mainview/dynamic-theme-ui.test.ts", import.meta.url),
      ),
    ],
    {
      env: {
        ...process.env,
        PIG_UI_BROWSER: browser,
        PIG_REQUIRE_UI_TESTS: "1",
      },
      stdout: "inherit",
      stderr: "inherit",
    },
  );
  process.exitCode = await child.exited;
}
