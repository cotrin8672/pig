import type { ElectrobunConfig } from "electrobun";
import {
  DURABLE_RUNTIME_EXTERNALS,
  DURABLE_RUNTIME_MANIFEST,
  DURABLE_RUNTIME_STAGE,
} from "./scripts/durable-runtime-assets";

export default {
  // Keep the original identifier to preserve existing projects and appearance settings.
  app: { name: "pig", identifier: "dev.piris.desktop", version: "0.1.0" },
  build: {
    bun: { external: DURABLE_RUNTIME_EXTERNALS },
    copy: {
      "dist/index.html": "views/mainview/index.html",
      "dist/assets": "views/mainview/assets",
      [`${DURABLE_RUNTIME_STAGE}/node_modules`]: "node_modules",
      [`${DURABLE_RUNTIME_STAGE}/${DURABLE_RUNTIME_MANIFEST}`]:
        DURABLE_RUNTIME_MANIFEST,
    },
    watchIgnore: ["dist/**"],
    mac: { bundleCEF: false },
    linux: { bundleCEF: false },
    win: { bundleCEF: false },
  },
  scripts: {
    preBuild: "scripts/durable-runtime-assets.ts",
    postBuild: "scripts/windows-native.ts",
  },
} satisfies ElectrobunConfig;
