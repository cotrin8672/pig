import { createRequire } from "node:module";
import type { Plugin } from "vite";

// Browser exports of these packages require document/DOMParser. Their default
// implementations use pure HTML entity tables/parse5 instead. Apply only to
// workers, identically in production and browser fixtures.
const require = createRequire(new URL("../package.json", import.meta.url));
export const workerModuleAliases: Record<string, string> = {
  "decode-named-character-reference": require.resolve(
    "decode-named-character-reference",
  ),
  "hast-util-from-html-isomorphic": require.resolve(
    "hast-util-from-html-isomorphic",
  ),
};

export function workerPlugins(): Plugin[] {
  return [
    {
      name: "worker-safe-dom-free-modules",
      enforce: "pre",
      resolveId(id) {
        if (Object.hasOwn(workerModuleAliases, id))
          return workerModuleAliases[id];
      },
    },
  ];
}
