import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type {
  AdapterKeymap,
  PigConfig,
  SessionAdapter,
} from "../../../../packages/config/src/index";
import { viewActions } from "../../../../packages/config/src/models";
import { normalizeCombo } from "../shared/keymap";

const MAX_ADAPTERS = 128;
const MAX_KEYMAPS = 512;
const MAX_SOURCE_BYTES = 1024 * 1024;
const MAX_BUNDLE_BYTES = 4 * 1024 * 1024;

function object(
  value: unknown,
  name: string,
  allowed: readonly string[],
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(`${name} must be an object`);
  const keys = Reflect.ownKeys(value);
  if (
    keys.length > allowed.length ||
    keys.some((key) => typeof key !== "string" || !allowed.includes(key))
  )
    throw new Error(`${name} has unsupported properties`);
  return value as Record<string, unknown>;
}

function text(value: unknown, name: string, max: number): string {
  if (typeof value !== "string" || !value.trim() || value.length > max)
    throw new Error(
      `${name} must be a nonempty string of at most ${max} characters`,
    );
  return value;
}

function array(value: unknown, name: string, max: number): unknown[] {
  if (!Array.isArray(value) || value.length > max)
    throw new Error(`${name} must be an array of at most ${max} entries`);
  return Array.from({ length: value.length }, (_, index) => value[index]);
}

function validate(value: unknown): PigConfig {
  const input = object(value, "config", [
    "apiVersion",
    "sessionAdapters",
    "keymaps",
  ]);
  if (input.apiVersion !== 1) throw new Error("apiVersion must be exactly 1");
  const config: PigConfig = { apiVersion: 1 };
  const ids = new Set<string>();
  if (input.sessionAdapters !== undefined) {
    config.sessionAdapters = array(
      input.sessionAdapters,
      "sessionAdapters",
      MAX_ADAPTERS,
    ).map((value, index) => {
      const name = `sessionAdapters[${index}]`;
      const adapter = object(value, name, ["id", "connect"]);
      const id = text(adapter.id, `${name}.id`, 128);
      if (ids.has(id)) throw new Error(`Duplicate adapter id: ${id}`);
      if (typeof adapter.connect !== "function")
        throw new Error(`${name}.connect must be a function`);
      ids.add(id);
      return { id, connect: adapter.connect as SessionAdapter["connect"] };
    });
  }
  if (input.keymaps !== undefined) {
    const combos = new Set<string>();
    config.keymaps = array(input.keymaps, "keymaps", MAX_KEYMAPS).map(
      (value, index) => {
        const name = `keymaps[${index}]`;
        const binding = object(value, name, [
          "keys",
          "adapter",
          "command",
          "when",
        ]);
        const keys = normalizeCombo(text(binding.keys, `${name}.keys`, 128));
        if (!keys)
          throw new Error(`${name}.keys is not a valid key combination`);
        const adapter = text(binding.adapter, `${name}.adapter`, 128);
        const command = text(binding.command, `${name}.command`, 256);
        if (!ids.has(adapter))
          throw new Error(`${name} references unknown adapter: ${adapter}`);
        const when = binding.when;
        if (when !== "chat" && when !== "composer" && when !== "panel")
          throw new Error(`${name}.when must be chat, composer, or panel`);
        const identity = `${when}:${keys}`;
        if (combos.has(identity))
          throw new Error(`Duplicate keymap conflict: ${identity}`);
        combos.add(identity);
        return { keys, adapter, command, when } satisfies AdapterKeymap;
      },
    );
  }
  return config;
}

/** Loads only the explicit user-global file. Config code is trusted host code, not sandboxed. */
export class ConfigLoader {
  config: PigConfig = { apiVersion: 1 };
  error?: string;
  readonly file: string;
  private pending: Promise<unknown> = Promise.resolve();

  constructor(file: string) {
    this.file = resolve(file);
  }

  reload(): Promise<boolean> {
    const next = this.pending.then(() => this.load());
    this.pending = next;
    return next;
  }

  private async load(): Promise<boolean> {
    let cache: string | undefined;
    try {
      let sourceBytes: number;
      try {
        sourceBytes = (await stat(this.file)).size;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        this.config = { apiVersion: 1 };
        this.error = undefined;
        return true;
      }
      if (sourceBytes > MAX_SOURCE_BYTES)
        throw new Error("Config source exceeds 1 MiB");
      // Sibling placement preserves runtime package resolution through the user's node_modules.
      // A fresh directory avoids Bun's module cache; remove it even after failed evaluation.
      cache = await mkdtemp(join(dirname(this.file), ".pig-config-cache-"));
      const output = join(cache, "config.mjs");
      const build = await Bun.build({
        entrypoints: [this.file],
        target: "bun",
        format: "esm",
        packages: "external",
        splitting: false,
        throw: false,
        plugins: [
          {
            name: "pig-config-api",
            setup(builder) {
              builder.onResolve({ filter: /^@pig\/config$/ }, () => ({
                path: "api",
                namespace: "pig-config",
              }));
              builder.onLoad({ filter: /.*/, namespace: "pig-config" }, () => ({
                contents: `export const defineConfig = (config) => config; export const viewActions = ${viewActions.toString()};`,
                loader: "js",
              }));
            },
          },
        ],
      });
      if (!build.success)
        throw new Error(
          build.logs.map((log) => String(log)).join("\n") ||
            "Config build failed",
        );
      if (build.outputs.length !== 1)
        throw new Error("Config must produce a single bundled module");
      const bundle = build.outputs[0];
      if (bundle.size > MAX_BUNDLE_BYTES)
        throw new Error("Config bundle exceeds 4 MiB");
      await writeFile(output, new Uint8Array(await bundle.arrayBuffer()), {
        mode: 0o600,
      });
      const module = await import(pathToFileURL(output).href);
      const config = validate(module.default);
      // Cleanup is part of success, so a cleanup failure also preserves the last good config.
      await rm(cache, { recursive: true, force: true });
      cache = undefined;
      this.config = config;
      this.error = undefined;
      return true;
    } catch (error) {
      this.error = `${this.file}: ${error instanceof Error ? error.message : String(error)}`;
      return false;
    } finally {
      if (cache) {
        try {
          await rm(cache, { recursive: true, force: true });
        } catch (error) {
          this.error = `${this.error ?? this.file}\nCache cleanup failed: ${String(error)}`;
        }
      }
    }
  }
}
