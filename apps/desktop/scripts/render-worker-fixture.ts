import { fileURLToPath } from "node:url";
import type { BunPlugin } from "bun";
import { workerModuleAliases } from "./worker-build";

/** Bun's browser fixtures use the same self-contained blob workers as Vite's
 * ?worker&inline production build, rather than silently testing a UI fallback. */
export async function renderWorkerFixturePlugin(): Promise<BunPlugin> {
  const sources = new Map<string, string>();
  for (const name of ["syntax", "markdown", "mermaid"]) {
    const built = await Bun.build({
      entrypoints: [
        fileURLToPath(
          new URL(`../src/mainview/${name}.worker.ts`, import.meta.url),
        ),
      ],
      target: "browser",
      format: "iife",
      // Bun rewrites browserify's `typeof require&&require` (elkjs) to an
      // undeclared `__require` in IIFE output; declare it as absent.
      banner: "var __require;",
      minify: true,
      define: { "process.env.NODE_ENV": '"production"' },
      plugins: [
        {
          name: "worker-safe-dom-free-modules",
          setup(build) {
            build.onResolve(
              {
                filter:
                  /^(decode-named-character-reference|hast-util-from-html-isomorphic)$/,
              },
              (args) => ({ path: workerModuleAliases[args.path] }),
            );
          },
        },
      ],
    });
    if (!built.success) throw new Error(built.logs.map(String).join("\n"));
    sources.set(name, await built.outputs[0].text());
  }
  return {
    name: "inline-render-workers",
    setup(build) {
      build.onResolve(
        { filter: /\/(syntax|markdown|mermaid)\.worker\?worker&inline$/ },
        (args) => ({
          path: /(\w+)\.worker\?/.exec(args.path)?.[1] ?? "markdown",
          namespace: "inline-render-worker",
        }),
      );
      build.onLoad(
        { filter: /.*/, namespace: "inline-render-worker" },
        ({ path }) => ({
          loader: "js",
          contents: `export default class extends Worker { constructor() { const url=URL.createObjectURL(new Blob([${JSON.stringify(sources.get(path))}],{type:"text/javascript"})); try { super(url); } catch(error) { URL.revokeObjectURL(url); (globalThis.__fixtureWorkerErrors??=[]).push(String(error)); throw error; } this.addEventListener("message",()=>URL.revokeObjectURL(url),{once:true}); this.addEventListener("error",event=>{URL.revokeObjectURL(url);(globalThis.__fixtureWorkerErrors??=[]).push(event.message??"worker script error");}); } }`,
        }),
      );
    },
  };
}
