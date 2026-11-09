import { randomUUID } from "node:crypto";
import {
  mkdtemp,
  readFile,
  realpath,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { isBuiltin } from "node:module";
import {
  dirname,
  extname,
  isAbsolute,
  join,
  relative,
  resolve,
} from "node:path";
import { pathToFileURL } from "node:url";
import type { PigConfig } from "../../../../packages/config/src/index";
import { viewActions } from "../../../../packages/config/src/models";
import { validateConfig } from "./config-validation";

const MAX_SOURCE_BYTES = 1024 * 1024;
const MAX_BUNDLE_BYTES = 4 * 1024 * 1024;
const CORE_VERSION = "1.5.0";
const CORE_PACKAGES = new Set([
  "@earendil-works/pi-durable",
  "@earendil-works/pi-ai",
  "@earendil-works/chord",
]);
const packageName = (specifier: string) =>
  specifier.startsWith("@")
    ? specifier.split("/").slice(0, 2).join("/")
    : specifier.split("/")[0];

export interface ConfigDependency {
  path: string;
  kind: "source" | "package";
  name?: string;
  version?: string;
}
export interface ConfigCandidate {
  readonly config: PigConfig;
  /** Identity, NOT a schema/closure compatibility fingerprint. */
  readonly revision: string;
  readonly dependencies: readonly ConfigDependency[];
  readonly diagnostics: readonly string[];
}
export type ConfigApplyDecision =
  | { status: "pending" | "rejected"; reason: string }
  | {
      status: "ready";
      /** Host has staged all work. Synchronous atomic publication; must preserve last-good on throw. */
      apply?: () => void;
      /** Release the host's safety/transition lease, including on cache-cleanup failure. */
      release?: () => void;
    };
/** Must inspect ALL live/pending/background/child tasks, approvals and task/doc compatibility. */
export type ConfigApplyGate = (
  candidate: ConfigCandidate,
  accepted: ConfigCandidate | undefined,
) => ConfigApplyDecision | Promise<ConfigApplyDecision>;
export interface ConfigLoaderOptions {
  /** Explicit managed dependency workspace, read anew per prepare. Never auto-install/discover packages. */
  moduleRoot?:
    | string
    | (() => string | undefined | Promise<string | undefined>);
  /** Entry/relative-bundle imports only. External packages' internals use their REAL resolver. */
  resolveModule?: (
    specifier: string,
    fromDirectory: string,
  ) => string | Promise<string>;
  canApply?: ConfigApplyGate;
}

type Manifest = { file: string; root: string; value: Record<string, unknown> };

/** Audit static external imports at their actual importers, not merely aliases at the config entry. */
class ModuleAudit {
  readonly dependencies = new Map<string, ConfigDependency>();
  private readonly visited = new Set<string>();
  private readonly manifests = new Map<string, Manifest>();
  private scannedBytes = 0;

  async manifest(file: string): Promise<Manifest> {
    let directory = dirname(file);
    while (true) {
      const cached = this.manifests.get(directory);
      if (cached) return cached;
      const path = join(directory, "package.json");
      try {
        const value: unknown = JSON.parse(await readFile(path, "utf8"));
        if (!value || typeof value !== "object" || Array.isArray(value))
          throw new Error(`Invalid manifest: ${path}`);
        const manifest = {
          file: path,
          root: directory,
          value: value as Record<string, unknown>,
        };
        this.manifests.set(directory, manifest);
        return manifest;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      const parent = dirname(directory);
      if (parent === directory)
        throw new Error(`Cannot find package manifest for ${file}`);
      directory = parent;
    }
  }

  async core(specifier: string, file: string): Promise<void> {
    const name = packageName(specifier);
    const manifest = await this.manifest(file);
    if (manifest.value.name !== name || manifest.value.version !== CORE_VERSION)
      throw new Error(
        `Core version mismatch: ${name} requires ${CORE_VERSION} at ${manifest.file}`,
      );
    const expected = await realpath(
      Bun.resolveSync(specifier, import.meta.dir),
    );
    if (file !== expected)
      throw new Error(
        `Core realpath mismatch: ${specifier}\nResolved: ${file}\nHost: ${expected}; unify package peers (entry aliases do not fix internal copies)`,
      );
  }

  async localCore(resolved: string): Promise<string | undefined> {
    const file = await realpath(resolved);
    let manifest: Manifest;
    try {
      manifest = await this.manifest(file);
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.startsWith("Cannot find package manifest")
      )
        return undefined;
      throw error;
    }
    const name = String(manifest.value.name);
    if (!CORE_PACKAGES.has(name)) return undefined;
    if (manifest.value.version !== CORE_VERSION)
      throw new Error(
        `Core version mismatch: ${name} requires ${CORE_VERSION}`,
      );
    const host = await this.manifest(
      await realpath(Bun.resolveSync(name, import.meta.dir)),
    );
    const expected = await realpath(
      join(host.root, relative(manifest.root, file)),
    );
    if (file !== expected)
      throw new Error(
        `Core realpath mismatch: ${name} at ${file}; host is ${expected}`,
      );
    await this.scan(file, true);
    return file;
  }

  async inspect(specifier: string, resolved: string): Promise<string> {
    const file = await realpath(resolved);
    const name = packageName(specifier);
    if (CORE_PACKAGES.has(name)) await this.core(specifier, file);
    if (name === "@pig/config") {
      const expected = await realpath(
        Bun.resolveSync("@pig/config", import.meta.dir),
      );
      if (file !== expected)
        throw new Error(
          `@pig/config realpath mismatch: ${file}; external packages must use the host v2 API`,
        );
    }
    await this.scan(file, CORE_PACKAGES.has(name) || name === "@pig/config");
    return file;
  }

  private async scan(file: string, hostCore = false): Promise<void> {
    if (this.visited.has(file)) return;
    this.visited.add(file);
    if (this.visited.size > 2048)
      throw new Error("External module audit exceeds 2048 files");
    const manifest = await this.manifest(file);
    const { name, version } = manifest.value;
    this.dependencies.set(manifest.file, {
      path: manifest.file,
      kind: "package",
      ...(typeof name === "string" ? { name } : {}),
      ...(typeof version === "string" ? { version } : {}),
    });
    for (const kind of ["peerDependencies", "dependencies"] as const) {
      const dependencies = manifest.value[kind];
      if (
        !dependencies ||
        typeof dependencies !== "object" ||
        Array.isArray(dependencies)
      )
        continue;
      for (const [peer, range] of Object.entries(dependencies)) {
        if (!CORE_PACKAGES.has(peer)) continue;
        if (
          typeof range !== "string" ||
          !Bun.semver.satisfies(CORE_VERSION, range)
        )
          throw new Error(
            `Core peer mismatch: ${String(name)} requires ${peer}@${String(range)}, host is ${CORE_VERSION}`,
          );
        // Do NOT use the entry resolve hook here: runtime external imports do not use it either.
        const actual = await realpath(Bun.resolveSync(peer, dirname(file)));
        await this.core(peer, actual);
      }
    }
    if (hostCore) return; // Already app-owned; its native core peers were checked above.
    const extension = extname(file);
    if (
      ![".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts"].includes(
        extension,
      )
    )
      return;
    const source = await readFile(file, "utf8");
    this.scannedBytes += Buffer.byteLength(source);
    if (this.scannedBytes > 16 * MAX_SOURCE_BYTES)
      throw new Error("External module audit exceeds 16 MiB");
    const loader = extension.endsWith("tsx")
      ? "tsx"
      : extension.endsWith("jsx")
        ? "jsx"
        : /\.[cm]?ts$/.test(extension)
          ? "ts"
          : "js";
    for (const imported of new Bun.Transpiler({ loader }).scanImports(source)) {
      if (
        isBuiltin(imported.path) ||
        imported.path === "bun" ||
        imported.path.startsWith("bun:")
      )
        continue;
      const target = Bun.resolveSync(imported.path, dirname(file));
      if (imported.path.startsWith(".") || isAbsolute(imported.path)) {
        if (!(await this.localCore(target)))
          await this.scan(await realpath(target));
      } else await this.inspect(imported.path, target);
    }
  }
}

/** Explicit user-global trusted code only. Preparing is NEVER accepting/applying. */
export class ConfigLoader {
  config: PigConfig = { apiVersion: 2 };
  accepted?: ConfigCandidate;
  candidate?: ConfigCandidate;
  error?: string;
  status: "idle" | "prepared" | "pending" | "rejected" | "accepted" = "idle";
  readonly file: string;
  private queue: Promise<unknown> = Promise.resolve();
  private cache?: string;

  constructor(
    file: string,
    private readonly options: ConfigLoaderOptions = {},
  ) {
    this.file = resolve(file);
  }

  private serial<T>(work: () => Promise<T>): Promise<T> {
    const next = this.queue.then(work);
    this.queue = next.catch(() => {});
    return next;
  }

  prepare(): Promise<ConfigCandidate | undefined> {
    return this.serial(() => this.prepareCandidate());
  }
  accept(
    candidate: ConfigCandidate,
    gate = this.options.canApply,
  ): Promise<boolean> {
    return this.serial(() => this.acceptCandidate(candidate, gate));
  }
  reload(gate = this.options.canApply): Promise<boolean> {
    return this.serial(async () => {
      const candidate = await this.prepareCandidate();
      return candidate ? this.acceptCandidate(candidate, gate) : false;
    });
  }
  discard(candidate = this.candidate): Promise<void> {
    return this.serial(async () => {
      if (candidate !== this.candidate)
        throw new Error("STALE_CONFIG_CANDIDATE");
      await this.cleanup();
      this.candidate = undefined;
      this.status = "idle";
    });
  }
  private async cleanup(): Promise<void> {
    if (this.cache) await rm(this.cache, { recursive: true, force: true });
    this.cache = undefined;
  }
  private diagnostic(error: unknown): void {
    this.error = `${this.file}: ${error instanceof Error ? error.message : String(error)}`;
    this.status = "rejected";
  }

  private async prepareCandidate(): Promise<ConfigCandidate | undefined> {
    try {
      await this.cleanup();
      this.candidate = undefined;
      let exists = true;
      try {
        if ((await stat(this.file)).size > MAX_SOURCE_BYTES)
          throw new Error("Config source exceeds 1 MiB");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        exists = false;
      }
      const audit = new ModuleAudit();
      let config: PigConfig = { apiVersion: 2 };
      if (exists) {
        const root =
          typeof this.options.moduleRoot === "function"
            ? await this.options.moduleRoot()
            : this.options.moduleRoot;
        // Sibling placement preserves package resolution, but external imports are made absolute explicitly.
        this.cache = await mkdtemp(
          join(dirname(this.file), ".pig-config-cache-"),
        );
        const output = join(this.cache, "config.mjs");
        const build = await Bun.build({
          entrypoints: [this.file],
          target: "bun",
          format: "esm",
          // Audited dependencies stay external, through an explicit ESM reference.
          // Bun 1.3 ignores an onResolve path rewrite when external:true.
          splitting: false,
          throw: false,
          plugins: [
            {
              name: "pig-config-api",
              setup: (builder) => {
                const generatedReferences = new Set<string>();
                builder.onResolve({ filter: /^@pig\/config$/ }, () => ({
                  path: "api",
                  namespace: "pig-config",
                }));
                builder.onLoad(
                  { filter: /.*/, namespace: "pig-config" },
                  () => ({
                    contents: `export const defineConfig = (config) => config; export const viewActions = ${viewActions.toString()};`,
                    loader: "js",
                  }),
                );
                builder.onResolve(
                  { filter: /.*/, namespace: "file" },
                  async (args) => {
                    // The explicit trusted entry is source, not an external dependency.
                    // Re-resolving it from Bun's synthetic "." importer is unreliable
                    // after native modules initialize (including isolated Host children).
                    if (args.kind === "entry-point-build")
                      return { path: this.file };
                    if (generatedReferences.has(args.path))
                      return { path: args.path, external: true };
                    if (
                      isBuiltin(args.path) ||
                      args.path === "bun" ||
                      args.path.startsWith("bun:")
                    )
                      return;
                    if (isAbsolute(args.path) || args.path.startsWith(".")) {
                      const resolved = Bun.resolveSync(
                        args.path,
                        args.resolveDir || dirname(args.importer || this.file),
                      );
                      const core = await audit.localCore(resolved);
                      return core
                        ? { path: core, namespace: "pig-dependency" }
                        : undefined;
                    }
                    const from = root
                      ? resolve(root)
                      : args.resolveDir || dirname(args.importer || this.file);
                    const resolved = this.options.resolveModule
                      ? await this.options.resolveModule(args.path, from)
                      : Bun.resolveSync(args.path, from);
                    if (!isAbsolute(resolved))
                      throw new Error(
                        "resolveModule must return an absolute module file",
                      );
                    return {
                      path: await audit.inspect(args.path, resolved),
                      namespace: "pig-dependency",
                    };
                  },
                );
                builder.onLoad(
                  { filter: /.*/, namespace: "pig-dependency" },
                  async (args) => {
                    const target = pathToFileURL(args.path).href;
                    generatedReferences.add(target);
                    // Only explicitly imported, audited TRUSTED dependencies are
                    // evaluated. Preparing config already executes trusted code;
                    // it is not a metadata-only operation or a sandbox.
                    const names = Object.getOwnPropertyNames(
                      await import(target),
                    );
                    const exports = names
                      .map(
                        (name) =>
                          `${JSON.stringify(name)} as ${JSON.stringify(name)}`,
                      )
                      .join(", ");
                    return {
                      contents: `export { ${exports} } from ${JSON.stringify(target)};`,
                      loader: "js",
                    };
                  },
                );
                builder.onLoad(
                  { filter: /\.[cm]?[jt]sx?$/, namespace: "file" },
                  (args) => {
                    audit.dependencies.set(args.path, {
                      path: args.path,
                      kind: "source",
                    });
                    return undefined;
                  },
                );
              },
            },
          ],
        });
        if (!build.success)
          throw new Error(
            build.logs.map(String).join("\n") || "Config build failed",
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
        config = validateConfig(module.default);
      }
      const candidate: ConfigCandidate = {
        config,
        revision: randomUUID(),
        dependencies: [...audit.dependencies.values()],
        diagnostics: [
          "Trusted code: static module checks are not a sandbox or a closure/schema compatibility proof. External npm modules retain Bun's process cache.",
        ],
      };
      this.candidate = candidate;
      this.status = "prepared";
      this.error = undefined;
      return candidate;
    } catch (error) {
      this.diagnostic(error);
      try {
        await this.cleanup();
      } catch (error) {
        this.error += `\nCache cleanup failed: ${String(error)}`;
      }
      return undefined;
    }
  }

  private async acceptCandidate(
    candidate: ConfigCandidate,
    gate?: ConfigApplyGate,
  ): Promise<boolean> {
    let decision: ConfigApplyDecision | undefined;
    try {
      if (candidate !== this.candidate)
        throw new Error("STALE_CONFIG_CANDIDATE");
      // Runtime presence/removal always needs the host's real safety gate, never a running-only guess.
      decision = gate
        ? await gate(candidate, this.accepted)
        : candidate.config.runtime !== undefined ||
            this.config.runtime !== undefined
          ? {
              status: "pending",
              reason:
                "Native runtime apply requires a host safety gate for tasks, approvals and task/document compatibility",
            }
          : { status: "ready" };
      if (decision.status !== "ready") {
        this.status = decision.status;
        this.error = `${this.file}: ${decision.reason}`;
        return false;
      }
      if (decision.apply?.constructor.name === "AsyncFunction")
        throw new Error(
          "Host apply must publish synchronously; stage asynchronous work in canApply",
        );
      // Cleanup MUST succeed before either host publication or accepted config changes.
      await this.cleanup();
      const applied: unknown = decision.apply?.();
      if (applied !== undefined) {
        if (applied instanceof Promise) void applied.catch(() => {});
        throw new Error(
          "Host apply must publish synchronously and return void",
        );
      }
      this.config = candidate.config;
      this.accepted = candidate;
      this.candidate = undefined;
      this.status = "accepted";
      this.error = undefined;
      return true;
    } catch (error) {
      this.diagnostic(error);
      return false;
    } finally {
      if (decision?.status === "ready") {
        try {
          decision.release?.();
        } catch (error) {
          this.error = `${this.error ?? this.file}\nHost safety lease release failed: ${String(error)}`;
        }
      }
    }
  }
}
