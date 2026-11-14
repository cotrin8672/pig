// Read-only dependency study and synthetic in-memory builds. Does not import
// application modules, execute SDK code, install packages, or launch pig.
import { dirname, extname, relative, resolve } from "node:path";

const sdkPackage = "@earendil-works/pi-coding-agent";
const sdkEndpoint = (path: string) =>
  path.startsWith("@earendil-works/pi-") ||
  path.replaceAll("\\", "/").endsWith("/bun/sdk.ts");
const localGraph = new Map<string, string[]>();
// index.ts only claims the single instance, then dynamically imports app.ts.
const entry = resolve(import.meta.dir, "../src/bun/app.ts");

async function visit(file: string) {
  if (localGraph.has(file)) return;
  const edges: string[] = [];
  localGraph.set(file, edges);
  const transpiler = new Bun.Transpiler({
    loader: extname(file) === ".tsx" ? "tsx" : "ts",
    target: "bun",
  });
  // Remove type-only dependencies before scanning runtime imports. Dynamic
  // imports are not traversed; sdk.ts is an explicit endpoint because its
  // dynamic SDK import is awaited at module top level.
  const code = transpiler.transformSync(await Bun.file(file).text());
  for (const dependency of transpiler.scan(code).imports) {
    if (dependency.kind === "dynamic-import") continue;
    if (dependency.path.startsWith("@earendil-works/pi-")) {
      edges.push(dependency.path);
      continue;
    }
    if (!dependency.path.startsWith(".")) continue;
    const target = Bun.resolveSync(dependency.path, dirname(file));
    if (!/\.(?:tsx?|js)$/.test(target)) continue;
    edges.push(target);
    await visit(target);
  }
}

function sdkPath(start: string): string[] | undefined {
  const queue = [[start]];
  const seen = new Set<string>();
  while (queue.length) {
    const chain = queue.shift();
    if (!chain) continue;
    const last = chain[chain.length - 1];
    if (sdkEndpoint(last))
      return chain.map((path) =>
        localGraph.has(path)
          ? relative(process.cwd(), path).replaceAll("\\", "/")
          : path,
      );
    if (seen.has(last)) continue;
    seen.add(last);
    for (const next of localGraph.get(last) ?? []) queue.push([...chain, next]);
  }
}

await visit(entry);
console.info(
  JSON.stringify({
    scope: "local static-import paths; not a complete production module graph",
    localModulesVisited: localGraph.size,
    sdkPaths: (localGraph.get(entry) ?? [])
      .map(sdkPath)
      .filter((path) => path !== undefined),
  }),
);

const variants = [
  { name: "local-dynamic-import-single-file", splitting: false },
  { name: "local-dynamic-import-split", splitting: true },
  { name: "dynamic-sdk-import-in-factory", splitting: false },
  { name: "runtime-url-separate-artifact", splitting: false },
];
const scanner = new Bun.Transpiler({ loader: "js", target: "bun" });
for (const variant of variants) {
  const result = await Bun.build({
    entrypoints: ["startup-study:entry"],
    target: "bun",
    format: "esm",
    splitting: variant.splitting,
    external: [sdkPackage],
    plugins: [
      {
        name: "startup-boundary-study",
        setup(build) {
          build.onResolve({ filter: /^startup-study:/ }, (args) => ({
            path: args.path,
            namespace: "startup-study",
          }));
          build.onLoad(
            { filter: /.*/, namespace: "startup-study" },
            (args) => ({
              loader: "js",
              contents:
                args.path === "startup-study:entry"
                  ? variant.name === "runtime-url-separate-artifact"
                    ? 'console.log("SHELL"); export const start = () => import(new URL("../services/app-services.js", import.meta.url).href);'
                    : 'console.log("SHELL"); export const start = () => import("startup-study:service");'
                  : variant.name === "dynamic-sdk-import-in-factory"
                    ? `export async function create() { const { ModelRuntime } = await import(${JSON.stringify(sdkPackage)}); return ModelRuntime.create(); }`
                    : `import { ModelRuntime } from ${JSON.stringify(sdkPackage)}; console.log("SERVICE"); export const create = () => ModelRuntime.create();`,
            }),
          );
        },
      },
    ],
  });
  if (!result.success) throw new Error(result.logs.join("\n"));
  console.info(
    JSON.stringify({
      bun: Bun.version,
      variant: variant.name,
      scope: "synthetic build only; not an Electrobun packaging/runtime test",
      outputs: await Promise.all(
        result.outputs.map(async (output) => {
          const code = await output.text();
          const imports = scanner.scan(code).imports;
          return {
            path: output.path,
            bytes: output.size,
            staticSdkImport: imports.some(
              (item) =>
                item.path === sdkPackage && item.kind !== "dynamic-import",
            ),
            dynamicSdkImport: imports.some(
              (item) =>
                item.path === sdkPackage && item.kind === "dynamic-import",
            ),
            runtimeArtifactUrl: code.includes("../services/app-services.js"),
          };
        }),
      ),
    }),
  );
}
