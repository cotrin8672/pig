import type { ElectrobunConfig } from "electrobun";

export default {
  // Keep the original identifier to preserve existing projects and appearance settings.
  app: { name: "pig", identifier: "dev.piris.desktop", version: "0.1.0" },
  build: {
    copy: {
      "dist/index.html": "views/mainview/index.html",
      "dist/assets": "views/mainview/assets",
    },
    watchIgnore: ["dist/**"],
    mac: { bundleCEF: false },
    linux: { bundleCEF: false },
    win: { bundleCEF: false },
  },
  scripts: { postBuild: "scripts/windows-native.ts" },
} satisfies ElectrobunConfig;
