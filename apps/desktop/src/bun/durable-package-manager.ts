import { createHash, randomUUID } from "node:crypto";
import {
  copyFile,
  mkdir,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
  isExactPackageVersion,
  isPackageName,
  type PackageSource,
  parsePackageSource,
} from "../shared/packages";
import type { InstalledPackage, PackageOpStatus } from "../shared/rpc-schema";
import { runCommand } from "./command-executor";
import { desktopConfigDir } from "./desktop-config";
import {
  type DurableCatalogEntry,
  durablePackageCatalog,
} from "./durable-package-catalog";
import { withPackageLock } from "./package-queue";

export const nativeCoreNames = [
  "@earendil-works/pi-durable",
  "@earendil-works/pi-ai",
  "@earendil-works/chord",
] as const;
export type NativeCoreName = (typeof nativeCoreNames)[number];
export const hostModuleNames = [...nativeCoreNames, "@pig/config"] as const;
export type HostModuleName = (typeof hostModuleNames)[number];
export const hostModuleVersions: Readonly<Record<HostModuleName, string>> =
  Object.freeze({
    "@earendil-works/pi-durable": "1.5.0",
    "@earendil-works/pi-ai": "1.5.0",
    "@earendil-works/chord": "1.5.0",
    "@pig/config": "0.1.0",
  });
type CorePaths = Readonly<Record<HostModuleName, string>>;
type Action = PackageOpStatus["action"];

/** Only controlled, non-secret diagnostics may cross the operation/event boundary. */
export class PackageManagerError extends Error {}

export interface MutationSafetyRequest {
  action: Action | "rollback";
  currentGeneration: string;
  /** All current sources: a shared dependency workspace is replaced as a unit. */
  sources: readonly string[];
}
/** Acquire a host admission/lifecycle lease; throw to hold/reject. Release MUST NOT throw. */
export type MutationSafetyGuard = (
  request: MutationSafetyRequest,
) => Promise<() => void>;

export interface ManagedPackage {
  source: string;
  request: string;
  target: string;
  name: string;
  version: string;
  description?: string;
  artifact?: string;
}
export interface PackageSnapshot {
  generation?: string;
  previous?: string;
  packages: ManagedPackage[];
}
interface Pointer {
  generation: string;
  previous?: string;
}
interface ManagerOptions {
  root?: string;
  command?: typeof runCommand;
  corePaths?: CorePaths;
  safetyGuard?: MutationSafetyGuard;
  catalog?: readonly DurableCatalogEntry[];
}
const object = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const fail = (message: string): never => {
  throw new PackageManagerError(message);
};
const generationId = (value: unknown): value is string =>
  typeof value === "string" && /^[0-9a-f-]{36}$/.test(value);
const artifactName = (source: string, target: string) =>
  `sources/${createHash("sha256").update(`${source}\n${target}`).digest("hex")}.tar`;
const parsed = (source: unknown) => {
  try {
    return parsePackageSource(source);
  } catch {
    return fail(
      "Invalid package source: use an npm name/spec or a canonical GitHub repository URL without credentials",
    );
  }
};
async function json(
  file: string,
  maxBytes = 1024 * 1024,
): Promise<Record<string, unknown>> {
  if ((await stat(file)).size > maxBytes)
    return fail("Managed package metadata exceeds its size limit");
  return object(JSON.parse(await readFile(file, "utf8")));
}
function contained(root: string, path: string) {
  const rel = relative(root, path);
  return !isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${sep}`);
}
const isCore = (name: string) => hostModuleNames.some((core) => core === name);

// Windows scanners can briefly hold a newly written file/directory open. Retry the
// atomic rename only, never a fetch, install, activation or partial pointer write.
async function atomicRename(from: string, to: string) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await rename(from, to);
    } catch (error) {
      if (
        process.platform !== "win32" ||
        attempt >= 5 ||
        !["EPERM", "EACCES", "EBUSY"].includes(
          (error as NodeJS.ErrnoException).code ?? "",
        )
      )
        throw error;
      await Bun.sleep(25 * (attempt + 1));
    }
  }
}

/** No constructor/startup/reload work. Reads use immutable generations and never spawn or fetch. */
export class DurablePackageManager {
  readonly root: string;
  private readonly command: typeof runCommand;
  private readonly catalog: readonly DurableCatalogEntry[];
  private guard?: MutationSafetyGuard;
  constructor(private readonly options: ManagerOptions = {}) {
    this.root = resolve(options.root ?? join(desktopConfigDir, "extensions"));
    this.command = options.command ?? runCommand;
    this.catalog = options.catalog ?? durablePackageCatalog;
    this.guard = options.safetyGuard;
  }

  setMutationGuard(guard: MutationSafetyGuard | undefined) {
    this.guard = guard;
  }

  private generationPath(id: string) {
    return join(this.root, "generations", id);
  }
  private async pointer(): Promise<Pointer | undefined> {
    let value: Record<string, unknown>;
    try {
      value = await json(join(this.root, "current.json"), 8192);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      return fail("Cannot read managed package generation pointer");
    }
    if (
      value.schemaVersion !== 1 ||
      !generationId(value.generation) ||
      (value.previous !== undefined && !generationId(value.previous))
    )
      return fail("Invalid managed package generation pointer");
    return {
      generation: value.generation,
      previous: value.previous as string | undefined,
    };
  }

  private async generation(id: string): Promise<ManagedPackage[]> {
    try {
      const value = await json(
        join(this.generationPath(id), "installed.json"),
        2 * 1024 * 1024,
      );
      if (
        value.schemaVersion !== 1 ||
        value.generation !== id ||
        !Array.isArray(value.packages) ||
        value.packages.length > 256
      )
        return fail("Invalid managed package state");
      const entries: ManagedPackage[] = value.packages.map((item: unknown) => {
        const entry = object(item);
        const request = parsed(entry.request);
        const target = parsed(entry.target);
        if (
          entry.source !== request.source ||
          target.source !== request.source ||
          !isPackageName(entry.name) ||
          isCore(entry.name) ||
          !isExactPackageVersion(entry.version) ||
          (entry.description !== undefined &&
            (typeof entry.description !== "string" ||
              entry.description.length > 2000))
        )
          return fail("Invalid managed package state");
        if (request.kind !== target.kind)
          return fail("Invalid managed package target");
        if (target.kind === "npm") {
          if (
            target.name !== entry.name ||
            target.selector !== entry.version ||
            entry.artifact !== undefined
          )
            return fail("Invalid managed npm target");
        } else if (
          !target.ref ||
          !/^[0-9a-f]{40}$/.test(target.ref) ||
          entry.artifact !== artifactName(request.source, target.request)
        )
          return fail("Invalid managed Git target");
        return {
          source: request.source,
          request: request.request,
          target: target.request,
          name: entry.name,
          version: entry.version,
          description: entry.description as string | undefined,
          artifact: entry.artifact as string | undefined,
        };
      });
      if (
        new Set(entries.map((e) => e.source)).size !== entries.length ||
        new Set(entries.map((e) => e.name)).size !== entries.length
      )
        return fail("Duplicate managed package state");
      return entries;
    } catch (error) {
      if (error instanceof PackageManagerError) throw error;
      return fail(
        "Cannot read managed package state; current installation was not changed",
      );
    }
  }

  async snapshot(): Promise<PackageSnapshot> {
    const pointer = await this.pointer();
    return {
      ...pointer,
      packages: pointer ? await this.generation(pointer.generation) : [],
    };
  }

  async listInstalled(): Promise<InstalledPackage[]> {
    const { packages } = await this.snapshot();
    return packages.map((entry) => {
      const catalog = this.catalog.find(
        (item) => parsed(item.target).source === entry.source,
      );
      const matches =
        catalog && parsed(catalog.target).request === entry.target;
      return {
        source: entry.source,
        scope: "user",
        name: entry.name,
        version: entry.version,
        description: entry.description,
        types: [...(matches ? catalog.card.types : [])],
        updateAvailable: catalog ? !matches : false,
      };
    });
  }

  /** Config-owner seam: path data only. Explicit trusted import/selection is a separate operation.
   * The loader must externalize native core imports to these SAME real paths, not bundle copies.
   */
  async moduleLocation(source: string, expectedGeneration?: string) {
    const snapshot = await this.snapshot();
    if (expectedGeneration && snapshot.generation !== expectedGeneration)
      return fail(
        "Managed package generation changed; validate configuration again",
      );
    const entry = snapshot.packages.find(
      (pkg) => pkg.source === parsed(source).source,
    );
    if (!entry || !snapshot.generation)
      return fail("Package source is not installed");
    const directory = join(
      this.generationPath(snapshot.generation),
      "node_modules",
      entry.name,
    );
    const corePaths = await this.hostCorePaths();
    await this.checkCoreLinks(
      this.generationPath(snapshot.generation),
      corePaths,
    );
    if (
      !contained(
        await realpath(this.generationPath(snapshot.generation)),
        await realpath(directory),
      )
    )
      return fail("Installed module escapes its generation");
    return {
      generation: snapshot.generation,
      name: entry.name,
      directory,
      resolveFrom: join(
        this.generationPath(snapshot.generation),
        "package.json",
      ),
      corePaths,
      compatibility: "unverified" as const,
    };
  }

  private async execute(
    program: "npm" | "git",
    args: readonly string[],
    cwd: string,
  ) {
    // Existing npmrc, Git helpers, SSH config and agent remain usable. Never pass tokens in argv.
    try {
      const result = await this.command(program, args, {
        cwd,
        timeout: 120_000,
        maxBuffer: 2 * 1024 * 1024,
        env: {
          ...process.env,
          CI: "true",
          GIT_TERMINAL_PROMPT: "0",
          GCM_INTERACTIVE: "Never",
          GIT_SSH_COMMAND: "ssh -oBatchMode=yes",
          NPM_CONFIG_IGNORE_SCRIPTS: "true",
          NPM_CONFIG_LOGS_MAX: "0",
        },
      });
      if (result.exitCode !== 0)
        return fail(
          `${program} package command failed (exit ${result.exitCode}); check source access and existing ${program === "git" ? "Git/SSH" : "npmrc"} credentials. No interactive sign-in is attempted`,
        );
      return result.stdout;
    } catch (error) {
      if (error instanceof PackageManagerError) throw error;
      return fail(
        `${program} package command could not complete; ensure RTK and ${program} are available and credentials work noninteractively`,
      );
    }
  }

  private async hostCorePaths(): Promise<CorePaths> {
    const paths = {} as Record<HostModuleName, string>;
    for (const name of hostModuleNames) {
      try {
        let directory = this.options.corePaths?.[name];
        if (!directory) {
          directory = dirname(fileURLToPath(import.meta.resolve(name)));
          while (true) {
            try {
              if ((await json(join(directory, "package.json"))).name === name)
                break;
            } catch {
              /* Walk to package root, without importing code. */
            }
            const parent = dirname(directory);
            if (parent === directory)
              return fail(
                "Cannot locate host native core; installation was not changed",
              );
            directory = parent;
          }
        }
        const manifest = await json(join(directory, "package.json"));
        if (
          manifest.name !== name ||
          manifest.version !== hostModuleVersions[name]
        )
          return fail(
            "Host shared module version does not match its pinned version; no duplicate will be installed",
          );
        paths[name] = await realpath(directory);
      } catch (error) {
        if (error instanceof PackageManagerError) throw error;
        return fail(
          "Cannot locate pinned host shared modules; no duplicate will be installed",
        );
      }
    }
    return paths;
  }

  private peerPolicy(manifest: Record<string, unknown>) {
    for (const name of hostModuleNames) {
      if (
        Object.hasOwn(object(manifest.dependencies), name) ||
        Object.hasOwn(object(manifest.optionalDependencies), name)
      )
        return fail(
          "Native core must be a peer dependency, not a downloaded dependency; no duplicate core will be loaded",
        );
      const range = object(manifest.peerDependencies)[name];
      if (
        range !== undefined &&
        (typeof range !== "string" ||
          !Bun.semver.satisfies(hostModuleVersions[name], range))
      )
        return fail(
          "Package shared-module peer requirement does not accept the host's pinned version",
        );
    }
  }

  private async validateWorkspace(
    directory: string,
    entries: ManagedPackage[],
  ) {
    const lock = await json(
      join(directory, "package-lock.json"),
      20 * 1024 * 1024,
    );
    if (
      lock.lockfileVersion !== 3 ||
      !Object.keys(object(lock.packages)).length
    )
      return fail("npm did not produce a supported dependency lockfile");
    const paths = Object.keys(object(lock.packages));
    if (paths.length > 20_000)
      return fail("Managed dependency workspace exceeds its package limit");
    for (const path of paths) {
      if (!path) continue;
      if (
        path.length > 2048 ||
        path.includes("\\") ||
        path
          .split("/")
          .some((part) => !part || part === "." || part === "..") ||
        !path.startsWith("node_modules/")
      )
        return fail("Unsafe dependency lockfile path");
      const metadata = object(object(lock.packages)[path]);
      if (metadata.link)
        return fail(
          "Linked dependencies are not supported in managed extensions",
        );
      if (
        hostModuleNames.some(
          (name) =>
            path === `node_modules/${name}` ||
            path.endsWith(`/node_modules/${name}`),
        )
      )
        return fail(
          "Dependency resolution downloaded a duplicate native core; use host core peers instead",
        );
      const packageDir = join(directory, ...path.split("/"));
      try {
        if (!contained(await realpath(directory), await realpath(packageDir)))
          return fail("Dependency escapes its managed generation");
        const manifest = await json(join(packageDir, "package.json"));
        if (typeof manifest.name === "string" && isCore(manifest.name))
          return fail(
            "Dependency resolution downloaded an aliased native core; use host core peers instead",
          );
        this.peerPolicy(manifest);
      } catch (error) {
        // npm may omit an optional dependency on this platform.
        if (
          (error as NodeJS.ErrnoException).code !== "ENOENT" ||
          !metadata.optional
        )
          throw error;
      }
    }
    for (const entry of entries) {
      const manifest = await json(
        join(directory, "node_modules", entry.name, "package.json"),
      );
      if (
        manifest.name !== entry.name ||
        !isExactPackageVersion(manifest.version) ||
        manifest.version !== entry.version
      )
        return fail("Installed package does not match its pinned target");
      entry.description =
        typeof manifest.description === "string"
          ? manifest.description.slice(0, 2000)
          : undefined;
    }
  }

  private async linkCore(directory: string, paths: CorePaths) {
    for (const name of hostModuleNames) {
      await mkdir(dirname(join(directory, "node_modules", name)), {
        recursive: true,
      });
      await symlink(
        paths[name],
        join(directory, "node_modules", name),
        process.platform === "win32" ? "junction" : "dir",
      );
    }
    await this.checkCoreLinks(directory, paths);
  }
  private async checkCoreLinks(directory: string, paths: CorePaths) {
    for (const name of hostModuleNames)
      if (
        (await realpath(join(directory, "node_modules", name))) !== paths[name]
      )
        return fail(
          "Installed native core identity differs from the host; configuration must not load this generation",
        );
  }

  private catalogRequest(source: PackageSource, updating = false) {
    const catalog = this.catalog.find(
      (entry) => parsed(entry.target).source === source.source,
    );
    if (!catalog) return source;
    const target = parsed(catalog.target);
    if (
      catalog.nativeCore !== "1.5.0" ||
      (target.kind === "npm"
        ? !isExactPackageVersion(target.selector)
        : !target.ref || !/^[0-9a-f]{40}$/.test(target.ref))
    )
      return fail("Catalog target is not pinned for native core 1.5.0");
    // Bare catalog clicks and explicit updates use the reviewed pin.
    return updating || (source.kind === "npm" ? !source.selector : !source.ref)
      ? target
      : source;
  }

  private async fetchTarget(
    source: PackageSource,
    directory: string,
  ): Promise<ManagedPackage> {
    if (source.kind === "npm") {
      if (isCore(source.name) || source.name === "node_modules")
        return fail("Host core is not an installable extension");
      const output = await this.execute(
        "npm",
        [
          "view",
          `${source.name}@${source.selector ?? "latest"}`,
          "version",
          "--json",
          "--ignore-scripts",
          "--logs-max=0",
        ],
        directory,
      );
      let value: unknown;
      try {
        value = JSON.parse(output);
      } catch {
        return fail("npm returned invalid version metadata");
      }
      const versions = Array.isArray(value) ? value : [value];
      if (!versions.length || !versions.every(isExactPackageVersion))
        return fail("npm did not resolve an exact package version");
      const version = versions[versions.length - 1] as string;
      if (
        source.selector &&
        isExactPackageVersion(source.selector) &&
        version !== source.selector
      )
        return fail("npm resolved a different version than the requested pin");
      return {
        source: source.source,
        request: source.request,
        target: `npm:${source.name}@${version}`,
        name: source.name,
        version,
      };
    }
    // Archive a pinned bare Git fetch: no checkout, submodules, npm Git prepare or package code.
    const repo = join(directory, ".fetch");
    const hooks = `core.hooksPath=${join(directory, ".no-hooks")}`;
    await this.execute("git", ["-c", hooks, "init", "--bare", repo], directory);
    const git = [
      "-C",
      repo,
      "-c",
      hooks,
      "-c",
      "protocol.file.allow=never",
      "-c",
      "protocol.ext.allow=never",
    ];
    await this.execute(
      "git",
      [
        ...git,
        "fetch",
        "--depth=1",
        "--no-tags",
        "--",
        source.url,
        source.ref ?? "HEAD",
      ],
      directory,
    );
    const commit = (
      await this.execute(
        "git",
        [...git, "rev-parse", "--verify", "FETCH_HEAD^{commit}"],
        directory,
      )
    ).trim();
    if (
      !/^[0-9a-f]{40}$/.test(commit) ||
      (source.ref && /^[0-9a-f]{40}$/.test(source.ref) && source.ref !== commit)
    )
      return fail("Git did not resolve the requested commit");
    let manifest: Record<string, unknown>;
    try {
      manifest = object(
        JSON.parse(
          await this.execute(
            "git",
            [...git, "show", `${commit}:package.json`],
            directory,
          ),
        ),
      );
    } catch (error) {
      if (error instanceof PackageManagerError) throw error;
      return fail("Git repository must contain a valid root package.json");
    }
    if (
      !isPackageName(manifest.name) ||
      isCore(manifest.name) ||
      manifest.name === "node_modules" ||
      !isExactPackageVersion(manifest.version)
    )
      return fail(
        "Git repository must contain an npm package with a valid name and version",
      );
    this.peerPolicy(manifest);
    const target = `${source.url}#${commit}`;
    const artifact = artifactName(source.source, target);
    await mkdir(join(directory, "sources"), { recursive: true });
    await this.execute(
      "git",
      [
        ...git,
        "archive",
        "--format=tar",
        "--prefix=package/",
        `--output=${join(directory, artifact)}`,
        commit,
      ],
      directory,
    );
    await rm(repo, { recursive: true, force: true });
    return {
      source: source.source,
      request: source.request,
      target,
      artifact,
      name: manifest.name,
      version: manifest.version,
    };
  }

  private async acquire(
    snapshot: PackageSnapshot,
    action: Action | "rollback",
  ) {
    if (!snapshot.generation || !this.guard)
      return fail(
        "Package mutation is held: native host lifecycle safety has not been established",
      );
    try {
      const release = await this.guard({
        action,
        currentGeneration: snapshot.generation,
        sources: snapshot.packages.map((entry) => entry.source),
      });
      if (typeof release !== "function")
        return fail(
          "Package mutation is held: native host did not grant a safety lease",
        );
      return release;
    } catch (error) {
      if (error instanceof PackageManagerError) throw error;
      return fail(
        "Package mutation is held: native host could not establish task/definition safety",
      );
    }
  }

  private async commit(pointer: Pointer, expected?: string) {
    if ((await this.pointer())?.generation !== expected)
      return fail(
        "Managed package generation changed during mutation; retry explicitly",
      );
    const temporary = join(this.root, `.current-${randomUUID()}.json`);
    try {
      await writeFile(
        temporary,
        JSON.stringify({ schemaVersion: 1, ...pointer }),
        {
          flag: "wx",
        },
      );
      await atomicRename(temporary, join(this.root, "current.json"));
    } finally {
      await rm(temporary, { force: true }).catch(() => {});
    }
  }

  async mutate(action: Action, input: string): Promise<void> {
    return withPackageLock(async () => {
      let stage: string | undefined;
      let final: string | undefined;
      let committed = false;
      let release: (() => void) | undefined;
      try {
        if (!["install", "update", "uninstall"].includes(action))
          return fail("Invalid package action");
        const source = parsed(input);
        const snapshot = await this.snapshot();
        const existing = snapshot.packages.find(
          (entry) => entry.source === source.source,
        );
        if (action !== "install" && !existing)
          return fail("Package source is not configured");
        if (action !== "install" || existing)
          release = await this.acquire(snapshot, action);
        if (!existing && snapshot.packages.length >= 256)
          return fail("Managed package limit reached");
        const id = randomUUID();
        stage = join(this.root, "generations", `.staging-${id}`);
        final = this.generationPath(id);
        await mkdir(stage, { recursive: true });
        const entries = snapshot.packages.filter((entry) => entry !== existing);
        if (action !== "uninstall") {
          const request = this.catalogRequest(
            action === "update" && existing ? parsed(existing.request) : source,
            action === "update",
          );
          const entry = await this.fetchTarget(request, stage);
          if (entries.some((item) => item.name === entry.name))
            return fail(
              "A different managed source already owns this package name",
            );
          entries.push(entry);
        }
        entries.sort((a, b) =>
          a.source < b.source ? -1 : a.source > b.source ? 1 : 0,
        );
        const corePaths = await this.hostCorePaths();
        if (snapshot.generation) {
          await copyFile(
            join(this.generationPath(snapshot.generation), "package-lock.json"),
            join(stage, "package-lock.json"),
          );
          for (const entry of entries)
            if (entry.artifact && entry.source !== source.source) {
              await mkdir(join(stage, "sources"), { recursive: true });
              await copyFile(
                join(this.generationPath(snapshot.generation), entry.artifact),
                join(stage, entry.artifact),
              );
            }
        }
        const dependencies = Object.fromEntries(
          entries.map((entry) => [
            entry.name,
            entry.artifact ? `file:./${entry.artifact}` : entry.version,
          ]),
        );
        await writeFile(
          join(stage, "package.json"),
          JSON.stringify(
            {
              name: "@pig/managed-extensions",
              version: "0.0.0",
              private: true,
              type: "module",
              dependencies,
            },
            null,
            2,
          ),
        );
        await this.execute(
          "npm",
          [
            "install",
            "--ignore-scripts",
            "--legacy-peer-deps",
            "--omit=dev",
            "--no-audit",
            "--no-fund",
            "--bin-links=false",
            "--package-lock=true",
            "--logs-max=0",
          ],
          stage,
        );
        await this.validateWorkspace(stage, entries);
        await this.linkCore(stage, corePaths);
        await writeFile(
          join(stage, "installed.json"),
          JSON.stringify(
            { schemaVersion: 1, generation: id, packages: entries },
            null,
            2,
          ),
        );
        await atomicRename(stage, final);
        await this.commit(
          { generation: id, previous: snapshot.generation },
          snapshot.generation,
        );
        committed = true;
      } catch (error) {
        if (error instanceof PackageManagerError) throw error;
        const code = object(error).code;
        const diagnostic =
          typeof code === "string" &&
          [
            "EPERM",
            "EACCES",
            "EBUSY",
            "ENOENT",
            "EEXIST",
            "ENOTEMPTY",
          ].includes(code)
            ? ` (${code})`
            : "";
        return fail(
          `Package transaction failed${diagnostic}; current installed files and generation were not changed`,
        );
      } finally {
        if (stage)
          await rm(stage, { recursive: true, force: true }).catch(() => {});
        if (final && !committed)
          await rm(final, { recursive: true, force: true }).catch(() => {});
        try {
          release?.();
        } catch {
          /* A committed installation must not be reported as rolled back. */
        }
      }
    });
  }

  /** Narrow explicit rollback; keeps both generations, performs no install or import. */
  async rollback(): Promise<void> {
    return withPackageLock(async () => {
      const snapshot = await this.snapshot();
      if (!snapshot.previous || !snapshot.generation)
        return fail("No prior managed package generation is available");
      const packages = await this.generation(snapshot.previous);
      const release = await this.acquire(
        { ...snapshot, packages: [...snapshot.packages, ...packages] },
        "rollback",
      );
      try {
        await this.checkCoreLinks(
          this.generationPath(snapshot.previous),
          await this.hostCorePaths(),
        );
        await this.commit(
          { generation: snapshot.previous, previous: snapshot.generation },
          snapshot.generation,
        );
      } finally {
        try {
          release();
        } catch {
          /* Lease releases must not throw. */
        }
      }
    });
  }
}

let manager: DurablePackageManager | undefined;
export const getPackageManager = () =>
  (manager ??= new DurablePackageManager());
