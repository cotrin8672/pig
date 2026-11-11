import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import config from "../electrobun.config";

// shortcut: Electrobun 1.18.1's compiled CLI resolves rcedit from its CI path, so
// win.icon is never embedded. Embed it here; remove when upgrading fixes it.
function embedWindowsIcon() {
  const buildDir = process.env.ELECTROBUN_BUILD_DIR;
  const name = process.env.ELECTROBUN_APP_NAME;
  const icon = config.build.win.icon;
  if (!buildDir || !name)
    throw new Error("Run this script through Electrobun postBuild.");
  const electrobun = dirname(
    createRequire(import.meta.url).resolve("electrobun/package.json"),
  );
  const rcedit = join(
    dirname(createRequire(electrobun).resolve("rcedit/package.json")),
    "bin/rcedit-x64.exe",
  );
  for (const exe of ["launcher.exe", "bun.exe"]) {
    const result = Bun.spawnSync(
      [
        rcedit,
        resolve(buildDir, name, "bin", exe),
        "--set-icon",
        resolve(icon),
      ],
      { stdio: ["ignore", "inherit", "inherit"] },
    );
    if (result.exitCode !== 0)
      throw new Error(`rcedit failed for ${exe} (${result.exitCode})`);
  }
  console.log(`[icon] Embedded ${icon} into launcher.exe and bun.exe.`);
}

if (process.env.ELECTROBUN_OS === "win") embedWindowsIcon();
const native = Bun.spawnSync(
  [process.execPath, join(import.meta.dir, "windows-native.ts")],
  { stdio: ["ignore", "inherit", "inherit"] },
);
if (native.exitCode !== 0) process.exit(native.exitCode ?? 1);

const buildDir = process.env.ELECTROBUN_BUILD_DIR;
const appName = process.env.ELECTROBUN_APP_NAME;
if (!buildDir || !appName)
  throw new Error("Missing Electrobun build destination");
const channel = process.env.PIG_RELEASE_CHANNEL ?? "dev";
const version = process.env.PIG_RELEASE_VERSION ?? config.app.version;
if (
  !["stable", "nightly", "dev"].includes(channel) ||
  (channel === "stable" && version !== config.app.version)
)
  throw new Error("Invalid app release metadata");
const resources = join(buildDir, appName, "Resources");
await mkdir(resources, { recursive: true });
await writeFile(
  join(resources, "app-build.json"),
  JSON.stringify({
    channel,
    version,
    commit: process.env.PIG_RELEASE_COMMIT ?? "",
  }),
);
