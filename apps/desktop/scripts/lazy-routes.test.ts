import { expect, test } from "bun:test";
import { basename, resolve } from "node:path";
import { build } from "vite";
import appConfig from "../electrobun.config";
import config from "../vite.config";

test("lazy routes keep bundled imports relative for HTTP and views://", async () => {
  const result = await build({
    ...config,
    configFile: false,
    root: resolve(import.meta.dir, "../src/mainview"),
    logLevel: "error",
    build: {
      ...config.build,
      write: false,
      minify: false,
      reportCompressedSize: false,
    },
  });
  const output = Array.isArray(result) ? result[0] : result;
  if (!("output" in output)) throw new Error("Expected a completed Vite build");
  const chunks = output.output.filter((item) => item.type === "chunk");
  const files = new Set(output.output.map((item) => item.fileName));
  const entry = chunks.find((chunk) => chunk.isEntry);
  if (!entry) throw new Error("Missing view entry");
  expect(config.base).toBe("./");
  expect(appConfig.build.copy["dist/assets"]).toBe("views/mainview/assets");
  expect(entry.code).toContain("import.meta.url");
  for (const name of ["Providers", "Settings", "Extensions"]) {
    const route = chunks.find((chunk) =>
      chunk.facadeModuleId?.endsWith(`/${name}.tsx`),
    );
    if (!route) throw new Error(`Missing lazy route ${name}`);
    expect(entry.dynamicImports).toContain(route.fileName);
    const specifier = `./${basename(route.fileName)}`;
    expect(entry.code).toContain(`import("${specifier}")`);
    for (const root of ["http://localhost:5173/", "views://mainview/"])
      expect(new URL(specifier, new URL(entry.fileName, root)).href).toBe(
        new URL(route.fileName, root).href,
      );
  }
  for (const chunk of chunks)
    for (const dependency of [...chunk.imports, ...chunk.dynamicImports]) {
      expect(dependency.startsWith("assets/")).toBe(true);
      expect(files.has(dependency)).toBe(true);
    }
}, 60_000);
