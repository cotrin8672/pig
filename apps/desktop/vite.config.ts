import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { electrobunViteAliases } from "./.hutch/devkit/api/config/electrobun-vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: electrobunViteAliases(
      fileURLToPath(new URL("./.hutch/devkit", import.meta.url)),
    ),
  },
  root: "src/mainview",
  base: "./",
  build: { outDir: "../../dist", emptyOutDir: true },
  server: { port: 5173, strictPort: true },
});
