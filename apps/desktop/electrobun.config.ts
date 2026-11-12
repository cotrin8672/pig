import type { ElectrobunConfig } from "electrobun";
import {
  SDK_RUNTIME_EXTERNALS,
  SDK_RUNTIME_STAGE,
} from "./scripts/sdk-runtime-assets";

export default {
  app: { name: "pig", identifier: "dev.pig.desktop", version: "0.4.0" },
  build: {
    mainProcess: "bun",
    bun: { entrypoint: "src/bun/index.ts", external: SDK_RUNTIME_EXTERNALS },
    copy: {
      "dist/index.html": "views/mainview/index.html",
      "dist/assets": "views/mainview/assets",
      "scripts/app-update.ps1": "app-update.ps1",
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
    preBuild: "scripts/sdk-runtime-assets.ts",
    postBuild: "scripts/post-build.ts",
  },
} satisfies ElectrobunConfig;
