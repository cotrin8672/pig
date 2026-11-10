import { readFile, stat } from "node:fs/promises";
import { extname, resolve } from "node:path";
import { parse } from "@babel/parser";
import React from "react";

const SOURCE_LIMIT = 1024 * 1024;
const BUNDLE_LIMIT = 4 * 1024 * 1024;
const bridge = 'globalThis[Symbol.for("pig.chat-renderers")]';

function assertStaticImports(source: string) {
  const pending: unknown[] = [
    parse(source, { sourceType: "unambiguous", createImportExpressions: true }),
  ];
  while (pending.length) {
    const value = pending.pop();
    if (!value || typeof value !== "object") continue;
    const node = value as {
      type?: string;
      callee?: { type?: string; name?: string };
    };
    if (
      node.type === "ImportExpression" ||
      (node.type === "CallExpression" &&
        node.callee?.type === "Identifier" &&
        node.callee.name === "require")
    )
      throw new Error(
        "Dynamic imports/require are unsupported in chat renderers",
      );
    for (const child of Object.values(value)) pending.push(child);
  }
}

export interface ChatRendererBundle {
  file: string;
  source: string | null;
  error?: string;
}

function facade(member: string, names: string[], defaultExport = false) {
  return [
    `const value = ${bridge}.${member};`,
    ...(defaultExport ? ["export default value;"] : []),
    ...names.map((name) => `export const ${name} = value.${name};`),
  ].join("\n");
}

const virtualModules: Record<string, string> = {
  react: facade(
    "react",
    Object.keys(React).filter(
      (name) => name !== "default" && /^[A-Za-z_$][\w$]*$/.test(name),
    ),
    true,
  ),
  "react/jsx-runtime": facade("jsxRuntime", ["Fragment", "jsx", "jsxs"]),
  "react/jsx-dev-runtime": facade("jsxDevRuntime", ["Fragment", "jsxDEV"]),
  "@pig/chat-renderers": facade("api", ["defineChatRenderers"]),
};

// This is explicitly trusted, user-global local code, not a sandbox. Compile
// only: never import/evaluate the user's module in the host. The frontend owns
// execution (and last-good retention), providing React and the identity-only API.
export class ChatRendererLoader {
  readonly file: string;

  constructor(file: string) {
    this.file = resolve(file);
  }

  async load(): Promise<ChatRendererBundle> {
    const file = this.file;
    try {
      try {
        if ((await stat(file)).size > SOURCE_LIMIT)
          throw new Error("Chat renderer source exceeds 1 MiB");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT")
          return { file, source: null };
        throw error;
      }
      const result = await Bun.build({
        entrypoints: [file],
        target: "browser",
        format: "esm",
        splitting: false,
        sourcemap: "none",
        throw: false,
        packages: "bundle",
        jsx: { runtime: "automatic", importSource: "react" },
        plugins: [
          {
            name: "chat-renderers",
            setup(build) {
              build.onResolve({ filter: /.*/ }, (args) => {
                if (args.kind === "dynamic-import")
                  throw new Error(
                    "Dynamic imports are unsupported in chat renderers",
                  );
                if (/^react-dom(?:\/|$)/.test(args.path))
                  throw new Error(
                    "react-dom imports are unsupported in chat renderers",
                  );
                // Give facades an ESM extension: Bun otherwise infers the
                // extensionless "react" virtual path as CommonJS.
                if (Object.hasOwn(virtualModules, args.path))
                  return {
                    path: `${args.path}.mjs`,
                    namespace: "chat-renderers",
                  };
                if (/^react\//.test(args.path))
                  throw new Error(`Unsupported React import: ${args.path}`);
                if (/\.(?:css|scss|sass|less)(?:[?#]|$)/i.test(args.path))
                  throw new Error(`CSS imports are unsupported: ${args.path}`);
              });
              build.onLoad(
                { filter: /.*/, namespace: "chat-renderers" },
                (args) => ({
                  contents: virtualModules[args.path.slice(0, -4)] ?? "",
                  loader: "js",
                }),
              );
              build.onLoad(
                { filter: /.*/, namespace: "file" },
                async (args) => {
                  const extension = extname(args.path).toLowerCase();
                  const loaders = {
                    ".js": "jsx",
                    ".jsx": "jsx",
                    ".mjs": "js",
                    ".cjs": "js",
                    ".ts": "ts",
                    ".tsx": "tsx",
                    ".json": "json",
                  } as const;
                  const loader = loaders[extension as keyof typeof loaders];
                  if (!loader)
                    throw new Error(
                      `Assets/imports are unsupported: ${args.path}`,
                    );
                  if ((await stat(args.path)).size > SOURCE_LIMIT)
                    throw new Error("Chat renderer source exceeds 1 MiB");
                  const contents = await readFile(args.path, "utf8");
                  if (Buffer.byteLength(contents) > SOURCE_LIMIT)
                    throw new Error("Chat renderer source exceeds 1 MiB");
                  if (loader !== "json") {
                    // Normalize comments/TS before checking computed imports too;
                    // onResolve alone cannot see import(variable).
                    const normalized = new Bun.Transpiler({
                      loader,
                      target: "browser",
                      minifyWhitespace: true,
                    }).transformSync(contents);
                    assertStaticImports(normalized);
                  }
                  return { contents, loader };
                },
              );
            },
          },
        ],
      });
      if (!result.success)
        throw new Error(result.logs.map((log) => log.message).join("\n"));
      const output = result.outputs[0];
      if (
        result.outputs.length !== 1 ||
        !output ||
        output.type !== "text/javascript;charset=utf-8"
      )
        throw new Error(
          "Chat renderers must produce a single JavaScript output; CSS/assets are unsupported",
        );
      if (output.size > BUNDLE_LIMIT)
        throw new Error("Chat renderer bundle exceeds 4 MiB");
      const source = await output.text();
      assertStaticImports(source);
      const imports = new Bun.Transpiler({ loader: "js" }).scan(source).imports;
      if (imports.length)
        throw new Error(
          "Unresolved imports are unsupported in chat renderer bundles",
        );
      return { file, source };
    } catch (error) {
      return {
        file,
        source: null,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}
