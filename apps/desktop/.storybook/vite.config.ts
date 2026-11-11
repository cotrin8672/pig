import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [tailwindcss()],
  resolve: {
    alias: [
      {
        find: /^\.\/rpc$/,
        replacement: fileURLToPath(
          new URL("../src/stories/browser-rpc.ts", import.meta.url),
        ),
      },
    ],
  },
});
