import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { workerPlugins } from "./scripts/worker-build";

export default defineConfig({
  define: { __VIRTUAL_TURNS__: process.env.VITE_VIRTUAL_TURNS !== "0" },
  plugins: [
    react(
      process.env.PIG_REACT_COMPILER === "1"
        ? {
            include: /[/\\]mainview[/\\]App\.tsx$/,
            babel: { plugins: ["babel-plugin-react-compiler"] },
          }
        : undefined,
    ),
    tailwindcss(),
  ],
  root: fileURLToPath(new URL("./src/mainview", import.meta.url)),
  base: "./",
  worker: { plugins: workerPlugins },
  build: {
    outDir: "../../build/tauri-webview",
    emptyOutDir: true,
  },
});
