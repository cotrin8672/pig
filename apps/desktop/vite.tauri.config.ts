import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { workerModuleAliases } from "./scripts/worker-build";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  root: fileURLToPath(new URL("./src/mainview", import.meta.url)),
  base: "./",
  // Do not load the Electrobun-generated tsconfig for this independent build.
  esbuild: {
    tsconfigRaw: '{"compilerOptions":{"target":"ES2022","jsx":"react-jsx"}}',
  },
  resolve: {
    alias: [
      {
        find: /^\.\/rpc-transport$/,
        replacement: fileURLToPath(
          new URL("./src/mainview/rpc-transport-tauri.ts", import.meta.url),
        ),
      },
    ],
  },
  worker: {
    plugins: () => [
      {
        name: "worker-safe-dom-free-modules",
        enforce: "pre",
        resolveId(id) {
          if (Object.hasOwn(workerModuleAliases, id))
            return workerModuleAliases[id];
        },
      },
    ],
  },
  build: {
    outDir: "../../build/tauri-webview",
    emptyOutDir: true,
  },
});
