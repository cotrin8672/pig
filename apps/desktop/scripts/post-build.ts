import { access, writeFile } from "node:fs/promises";
import { join } from "node:path";
import config from "../electrobun.config";

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
// Hutch passes the unsuffixed app name; only stable bundles omit the channel suffix.
const buildEnv = process.env.ELECTROBUN_BUILD_ENV;
if (!["dev", "canary", "stable"].includes(buildEnv ?? ""))
  throw new Error("Invalid Electrobun build environment");
const bundleName = `${appName.replaceAll(" ", "")}${buildEnv === "stable" ? "" : `-${buildEnv}`}`;
const resources = join(
  buildDir,
  `${bundleName}${process.env.ELECTROBUN_OS === "macos" ? ".app/Contents" : ""}`,
  "Resources",
);
// Refuse to silently create metadata in a different directory from the actual bundle.
await access(join(resources, "version.json"));
await writeFile(
  join(resources, "app-build.json"),
  JSON.stringify({
    channel,
    version,
    commit: process.env.PIG_RELEASE_COMMIT ?? "",
  }),
);
