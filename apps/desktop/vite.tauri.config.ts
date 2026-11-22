import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  root: fileURLToPath(new URL("./src/tauri-preview", import.meta.url)),
  base: "./",
  // Do not load the Electrobun-generated tsconfig for this independent build.
  esbuild: { tsconfigRaw: '{"compilerOptions":{"target":"ES2022"}}' },
  build: {
    outDir: "../../build/tauri-preview",
    emptyOutDir: true,
  },
});
