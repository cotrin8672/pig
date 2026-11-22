import type { ElectrobunConfig } from "electrobun";
import {
  SDK_RUNTIME_EXTERNALS,
  SDK_RUNTIME_STAGE,
} from "./scripts/sdk-runtime-assets";

export default {
  app: { name: "pig", identifier: "dev.pig.desktop", version: "0.12.0" },
  build: {
    mainProcess: "bun",
    bun: { entrypoint: "src/bun/index.ts", external: SDK_RUNTIME_EXTERNALS },
    copy: {
      "dist/index.html": "views/mainview/index.html",
      "dist/assets": "views/mainview/assets",
      "scripts/app-update.ps1": "app-update.ps1",
      "build/statistics/statistics-worker.js": "bun/statistics-worker.js",
      "build/chat-history/chat-history-worker.js": "bun/chat-history-worker.js",
      [`${SDK_RUNTIME_STAGE}/node_modules`]: "node_modules",
      [`${SDK_RUNTIME_STAGE}/sdk-runtime-manifest.json`]:
        "sdk-runtime-manifest.json",
    },
    watchIgnore: ["dist/**"],
    mac: { bundleCEF: false },
    linux: { bundleCEF: false, icon: "assets/icon.png" },
    win: { bundleCEF: false, icon: "assets/icon.ico" },
  },
  scripts: {
    preBuild: "scripts/pre-build.ts",
    postBuild: "scripts/post-build.ts",
  },
} satisfies ElectrobunConfig;
