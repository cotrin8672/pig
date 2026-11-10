import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import React from "react";
import * as jsxDevRuntime from "react/jsx-dev-runtime";
import * as jsxRuntime from "react/jsx-runtime";
import { ChatRendererLoader } from "./chat-renderer-loader";

const roots: string[] = [];
const key = Symbol.for("pig.chat-renderers");
const globals = globalThis as typeof globalThis & Record<symbol, unknown>;
const previous = globals[key];
afterEach(async () => {
  if (previous === undefined) delete globals[key];
  else globals[key] = previous;
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});

async function fixture(source?: string) {
  const root = await mkdtemp(
    join(process.env.PI_SCRATCH_DIR || tmpdir(), "pig-renderers-test-"),
  );
  roots.push(root);
  const file = join(root, "chat-renderers.tsx");
  if (source !== undefined) await writeFile(file, source);
  return { root, file, loader: new ChatRendererLoader(file) };
}

async function evaluate(source: string | null) {
  if (source === null) throw new Error("Expected a compiled renderer bundle");
  globals[key] = {
    react: React,
    jsxRuntime,
    jsxDevRuntime,
    api: { defineChatRenderers: <T>(value: T) => value },
  };
  return import(
    `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`
  );
}

test("missing fixed file returns null without discovering other config", async () => {
  const { root, file, loader } = await fixture();
  await writeFile(join(root, "config.tsx"), "throw new Error('not this file')");
  expect(await loader.load()).toEqual({ file, source: null });
});

test("bundles TSX and relative modules, returns fresh browser ESM", async () => {
  const { root, loader } = await fixture(`
    import { defineChatRenderers } from '@pig/chat-renderers';
    import { Child } from './child';
    export default defineChatRenderers({ view: <Child /> });
  `);
  await writeFile(
    join(root, "child.tsx"),
    "export const Child = () => <span>first</span>;",
  );
  const first = await loader.load();
  expect(first.error).toBeUndefined();
  expect(first.source).toContain("first");
  const module = await evaluate(first.source);
  expect(module.default.view.type().props.children).toBe("first");
  expect(
    new Bun.Transpiler({ loader: "js" }).scan(first.source ?? "").imports,
  ).toEqual([]);
  await writeFile(
    join(root, "child.tsx"),
    "export const Child = () => <b>second</b>;",
  );
  expect((await loader.load()).source).toContain("second");
});

test("React default, named exports and both JSX runtimes use the frontend singletons", async () => {
  const { loader } = await fixture(`
    import React, { useState, useActionState, version } from 'react';
    import { jsx } from 'react/jsx-runtime';
    import { jsxDEV } from 'react/jsx-dev-runtime';
    import { defineChatRenderers } from '@pig/chat-renderers';
    const value = {};
    export default { React, useState, useActionState, version, jsx, jsxDEV,
      identity: defineChatRenderers(value) === value };
  `);
  const result = await loader.load();
  expect(result.error).toBeUndefined();
  const { default: value } = await evaluate(result.source);
  expect(value.React).toBe(React);
  expect(value.useState).toBe(React.useState);
  expect(value.useActionState).toBe(React.useActionState);
  expect(value.version).toBe(React.version);
  expect(value.jsx).toBe(jsxRuntime.jsx);
  expect(value.jsxDEV).toBe(jsxDevRuntime.jsxDEV);
  expect(value.identity).toBe(true);
  expect(result.source).not.toContain("react.development.js");
});

test("compilation never evaluates config or its relative dependencies in the host", async () => {
  const { root, loader } = await fixture(`
    import './side-effect';
    throw new Error('MUST_NOT_EVALUATE');
    export default <div />;
  `);
  await writeFile(
    join(root, "side-effect.ts"),
    "throw new Error('NO_HOST_IMPORT');",
  );
  const result = await loader.load();
  expect(result.error).toBeUndefined();
  expect(result.source).toContain("MUST_NOT_EVALUATE");
  expect(result.source).toContain("NO_HOST_IMPORT");
});

test("syntax failures return error/null and recovery and removal work", async () => {
  const { file, loader } = await fixture("export default <div>;");
  const result = await loader.load();
  expect(result.source).toBeNull();
  expect(result.error).toBeTruthy();
  await writeFile(file, "export default <div />;");
  expect((await loader.load()).source).toBeString();
  await rm(file);
  expect(await loader.load()).toEqual({ file, source: null });
});

test("rejects source over 1 MiB, including relative modules", async () => {
  const { root, file, loader } = await fixture(" ".repeat(1024 * 1024 + 1));
  expect(await loader.load()).toMatchObject({
    source: null,
    error: expect.stringContaining("1 MiB"),
  });
  await writeFile(file, "export { default } from './large';");
  await writeFile(join(root, "large.ts"), " ".repeat(1024 * 1024 + 1));
  expect(await loader.load()).toMatchObject({
    source: null,
    error: expect.stringContaining("1 MiB"),
  });
});

test("rejects a bundle over 4 MiB even when individual sources fit", async () => {
  const { root, file, loader } = await fixture();
  const imports: string[] = [];
  for (let i = 0; i < 5; i++) {
    await writeFile(
      join(root, `part${i}.ts`),
      `export default '${"x".repeat(900_000)}';`,
    );
    imports.push(`import part${i} from './part${i}';`);
  }
  await writeFile(
    file,
    `${imports.join("\n")}\nexport default [part0, part1, part2, part3, part4];`,
  );
  expect(await loader.load()).toMatchObject({
    source: null,
    error: expect.stringContaining("4 MiB"),
  });
});

for (const [specifier, message] of [
  ["react-dom", "react-dom"],
  ["react-dom/client", "react-dom"],
  ["react-dom/server", "react-dom"],
  ["react/unsupported", "Unsupported React"],
  ["./style.css", "CSS"],
  ["./icon.svg", "unsupported"],
  ["./image.png", "unsupported"],
  ["does-not-exist-pig-renderers", "resolve"],
  ["https://example.com/module.js", "resolve"],
]) {
  test(`rejects unsupported import ${specifier}`, async () => {
    const { root, loader } = await fixture(
      `import value from '${specifier}'; export default value;`,
    );
    await writeFile(join(root, "style.css"), "body {}");
    await writeFile(join(root, "icon.svg"), "<svg />");
    await writeFile(join(root, "image.png"), "image");
    const result = await loader.load();
    expect(result.source).toBeNull();
    expect(result.error).toContain(message);
  });
}

for (const expression of [
  "import('./child')",
  "import /* comment */ ('./child')",
  "import(globalThis.moduleName)",
  "require(globalThis.moduleName)",
]) {
  test(`rejects dynamic import/require: ${expression}`, async () => {
    const { loader } = await fixture(`export default ${expression};`);
    const result = await loader.load();
    expect(result.source).toBeNull();
    expect(result.error).toContain("unsupported");
  });
}

test("bundles resolvable third-party browser imports without externals", async () => {
  const { root, loader } = await fixture(
    "export { value as default } from 'renderer-helper';",
  );
  const directory = join(root, "node_modules", "renderer-helper");
  await mkdir(directory, { recursive: true });
  await writeFile(
    join(directory, "package.json"),
    JSON.stringify({ name: "renderer-helper", main: "index.js" }),
  );
  await writeFile(
    join(directory, "index.js"),
    "export const value = 'bundled-helper';",
  );
  const result = await loader.load();
  expect(result.error).toBeUndefined();
  expect((await evaluate(result.source)).default).toBe("bundled-helper");
});

test("import-like text in strings, templates, JSX and comments is not a dynamic import", async () => {
  const { loader } = await fixture(`
    // import('this is just a comment')
    const literal = "import(";
    const template = \`require( text\`;
    export default () => <pre>{literal + template + /import[(]/.source}</pre>;
  `);
  const bundle = await loader.load();
  expect(bundle.error).toBeUndefined();
  expect(bundle.source).not.toBeNull();
});
