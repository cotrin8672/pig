import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

export const DURABLE_RUNTIME_VERSION = "1.5.0";
export const DURABLE_NATIVE_ROOTS = [
  "@earendil-works/pi-durable",
  "@earendil-works/pi-ai",
  "@earendil-works/chord",
] as const;
export const DURABLE_RUNTIME_ROOTS = [
  ...DURABLE_NATIVE_ROOTS,
  "@pig/config",
] as const;
// Preserve module-relative resolution for the native runtime, CodeMode worker /
// QuickJS WASM and Photon WASM, including direct imports from the desktop host.
export const DURABLE_RUNTIME_EXTERNALS = [
  ...DURABLE_RUNTIME_ROOTS,
  "@earendil-works/pi-codemode",
  "@silvia-odwyer/photon",
].flatMap((name) => [name, `${name}/*`]);
export const DURABLE_RUNTIME_STAGE = "build/durable-runtime";
export const DURABLE_RUNTIME_MANIFEST = "durable-runtime-manifest.json";

const pinnedPackages = new Map<string, string>([
  ...DURABLE_NATIVE_ROOTS.map(
    (name) => [name, DURABLE_RUNTIME_VERSION] as const,
  ),
  ["@earendil-works/pi-codemode", DURABLE_RUNTIME_VERSION],
  ["@silvia-odwyer/photon", "0.3.3"],
  ["@pig/config", "0.1.0"],
]);
type PackageManifest = {
  name: string;
  version: string;
  dependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  peerDependenciesMeta?: Record<string, { optional?: boolean }>;
};
type PackageNode = {
  source: string;
  manifest: PackageManifest;
  hash: string;
  deps: Map<string, PackageNode>;
};
type Placement = { node: PackageNode; path: string };
export type RuntimeManifest = {
  format: 1;
  roots: string[];
  packages: {
    name: string;
    version: string;
    path: string;
    packageJsonSha256: string;
    dependencies: Record<string, string>;
  }[];
};

function within(parent: string, child: string) {
  const rel = relative(parent, child);
  return (
    rel === "" ||
    (!isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${sep}`))
  );
}
function packageName(name: string) {
  if (
    typeof name !== "string" ||
    !/^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+$/.test(name) ||
    name.split("/").some((part) => part === "." || part === "..")
  )
    throw new Error(`Unsafe package name: ${name}`);
  if (
    /(?:^|\/)pi-(?:coding-agent|tui)$/.test(name) ||
    name === "xterm" ||
    name.startsWith("@xterm/") ||
    name.startsWith("xterm-addon-")
  )
    throw new Error(`SDK/TUI package is forbidden in Durable runtime: ${name}`);
}
function portable(path: string) {
  return path.split(sep).join("/");
}
function entryExists(path: string) {
  try {
    lstatSync(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}
function renameStage(source: string, destination: string) {
  // Windows indexers/antivirus can briefly hold freshly copied directories.
  // Retry only transient rename failures, on the caller's fixed stage paths.
  for (let attempt = 0; ; attempt++) {
    try {
      renameSync(source, destination);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (
        process.platform !== "win32" ||
        attempt >= 5 ||
        !["EACCES", "EPERM", "EBUSY"].includes(code ?? "")
      )
        throw error;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
    }
  }
}

function canonicalDestination(path: string): string {
  let parent = resolve(path);
  while (!existsSync(parent)) {
    const next = dirname(parent);
    if (next === parent)
      throw new Error(`No existing Durable destination parent: ${path}`);
    parent = next;
  }
  return resolve(realpathSync(parent), relative(parent, resolve(path)));
}

// Resolve manifests without require.resolve("pkg/package.json"): many packages
// hide that subpath via exports. Follow pnpm package links, never a registry/cache.
function installedPackage(name: string, from: string): string | undefined {
  packageName(name);
  for (let dir = from; ; dir = dirname(dir)) {
    const candidate = join(dir, "node_modules", name);
    if (existsSync(join(candidate, "package.json")))
      return realpathSync(candidate);
    if (dirname(dir) === dir) return undefined;
  }
}

function copyPackage(source: string, destination: string) {
  function copy(input: string, output: string, ancestors: Set<string>) {
    // Only package-internal symlinks may be materialized. Never follow a link
    // into user storage, another package, or a cycle; output contains no links.
    const actual = realpathSync(input);
    if (!within(source, actual))
      throw new Error(`Package symlink escapes package: ${input}`);
    const info = statSync(actual);
    if (info.isDirectory()) {
      if (ancestors.has(actual))
        throw new Error(`Package symlink cycle: ${input}`);
      const next = new Set(ancestors).add(actual);
      mkdirSync(output, { recursive: true });
      for (const entry of readdirSync(actual).sort()) {
        if (entry === "node_modules" || entry === ".git") continue;
        copy(join(actual, entry), join(output, entry), next);
      }
    } else if (info.isFile()) {
      copyFileSync(actual, output);
    } else throw new Error(`Unsupported package file: ${input}`);
  }
  copy(source, destination, new Set());
}

/** Copy only the installed production closure, preserving package identities and
 * conflicting versions with ordinary nested node_modules (no pnpm/store links).
 * Destination must not exist; callers control replacement of their own stage.
 */
export function copyDurableRuntime(options: {
  projectDir: string;
  destination: string;
  roots?: readonly string[];
  // Explicit trust boundary for pnpm links. Defaults to the workspace install.
  installRoot?: string;
}): RuntimeManifest {
  const project = realpathSync(options.projectDir);
  const destination = canonicalDestination(options.destination);
  const roots = options.roots ?? DURABLE_RUNTIME_ROOTS;
  let installRoot = options.installRoot;
  if (!installRoot) {
    for (let dir = project; ; dir = dirname(dir)) {
      if (existsSync(join(dir, "node_modules", ".pnpm"))) {
        installRoot = join(dir, "node_modules");
        break;
      }
      if (dirname(dir) === dir) {
        installRoot = join(project, "node_modules");
        break;
      }
    }
  }
  const allowed = realpathSync(installRoot);
  if (
    within(allowed, destination) ||
    within(destination, allowed) ||
    within(destination, project)
  )
    throw new Error("Durable destination overlaps source/install tree");
  if (entryExists(destination))
    throw new Error(`Durable destination already exists: ${destination}`);
  const graph = new Map<string, PackageNode>();
  function visit(
    name: string,
    from: string,
    optional = false,
  ): PackageNode | undefined {
    const source = installedPackage(name, from);
    if (!source) {
      if (optional) return undefined;
      throw new Error(
        `Missing installed production dependency ${name} from ${from}`,
      );
    }
    // The one app-owned workspace module is an explicit build-time root, not
    // permission to follow arbitrary package links outside the install tree.
    const hostConfig = resolve(import.meta.dir, "../../../packages/config");
    if (
      !within(allowed, source) &&
      !(
        name === "@pig/config" &&
        existsSync(hostConfig) &&
        source === realpathSync(hostConfig)
      )
    )
      throw new Error(`Dependency outside install root: ${name}`);
    const cached = graph.get(source);
    if (cached) {
      if (cached.manifest.name !== name)
        throw new Error(`Invalid package identity for ${name}`);
      return cached;
    }
    const manifestPath = realpathSync(join(source, "package.json"));
    if (!within(source, manifestPath))
      throw new Error(`Package manifest escapes package: ${name}`);
    const bytes = readFileSync(manifestPath);
    const manifest = JSON.parse(bytes.toString()) as PackageManifest;
    packageName(manifest.name);
    if (
      manifest.name !== name ||
      typeof manifest.version !== "string" ||
      !manifest.version
    )
      throw new Error(`Invalid package identity for ${name}`);
    const expected = pinnedPackages.get(name);
    if (expected && manifest.version !== expected)
      throw new Error(
        `Durable runtime requires ${name}@${expected}, installed ${manifest.version}`,
      );
    const node: PackageNode = {
      source,
      manifest,
      hash: createHash("sha256").update(bytes).digest("hex"),
      deps: new Map(),
    };
    graph.set(source, node);
    const deps = {
      ...manifest.peerDependencies,
      ...manifest.dependencies,
      ...manifest.optionalDependencies,
    };
    for (const dep of Object.keys(deps).sort()) {
      const isOptional =
        Object.hasOwn(manifest.optionalDependencies ?? {}, dep) ||
        (!Object.hasOwn(manifest.dependencies ?? {}, dep) &&
          manifest.peerDependenciesMeta?.[dep]?.optional === true);
      const child = visit(dep, source, isOptional);
      if (child) node.deps.set(dep, child);
    }
    return node;
  }
  const rootNodes = roots.map((name) => {
    const node = visit(name, project);
    if (!node) throw new Error(`Missing Durable root: ${name}`);
    return node;
  });
  // Hoist one identity per name. Other versions are nested at the requiring
  // package; each edge is checked against the nearest visible identity.
  const top = new Map<string, Placement>();
  for (const node of [...rootNodes, ...graph.values()]) {
    if (!top.has(node.manifest.name))
      top.set(node.manifest.name, {
        node,
        path: join(destination, "node_modules", node.manifest.name),
      });
  }
  const result: RuntimeManifest = {
    format: 1,
    roots: [...roots],
    packages: [],
  };
  function place(placement: Placement, visible: Map<string, Placement>) {
    const { node, path } = placement;
    copyPackage(node.source, path);
    const record: RuntimeManifest["packages"][number] = {
      name: node.manifest.name,
      version: node.manifest.version,
      path: portable(relative(destination, path)),
      packageJsonSha256: node.hash,
      dependencies: {},
    };
    result.packages.push(record);
    const children: Placement[] = [];
    const scope = new Map(visible);
    for (const [name, child] of node.deps) {
      let target = scope.get(name);
      if (target?.node !== child) {
        target = { node: child, path: join(path, "node_modules", name) };
        scope.set(name, target);
        children.push(target);
      }
      record.dependencies[name] = portable(relative(destination, target.path));
    }
    for (const child of children) place(child, scope);
  }
  try {
    mkdirSync(destination, { recursive: true });
    for (const placement of top.values()) place(placement, top);
    result.packages.sort((a, b) => a.path.localeCompare(b.path));
    writeFileSync(
      join(destination, DURABLE_RUNTIME_MANIFEST),
      `${JSON.stringify(result, null, 2)}\n`,
    );
    return result;
  } catch (error) {
    try {
      rmSync(destination, {
        recursive: true,
        force: true,
        maxRetries: 5,
        retryDelay: 100,
      });
    } catch (cleanup) {
      throw new AggregateError(
        [error, cleanup],
        `Durable copy failed; partial stage remains at ${destination}. Review/remove only this generated directory before retrying.`,
      );
    }
    throw error;
  }
}

/** Fixed generated paths only; never touches old SDK stages or any user data. */
export function stageDurableRuntime(projectDir: string): RuntimeManifest {
  const project = realpathSync(projectDir);
  const destination = join(project, DURABLE_RUNTIME_STAGE);
  const temporary = `${destination}.next`;
  const previous = `${destination}.previous`;
  const guarded = [dirname(destination), destination, temporary, previous];
  const checkPaths = () => {
    for (const path of guarded) {
      if (!entryExists(path)) continue;
      const info = lstatSync(path);
      if (info.isSymbolicLink() || !info.isDirectory())
        throw new Error(
          `Durable build/stage path must be a real directory: ${path}`,
        );
    }
  };
  checkPaths();
  for (const path of [temporary, previous]) {
    if (entryExists(path))
      throw new Error(
        `Interrupted Durable stage: ${path}. Review/remove only this generated directory before retrying; the current stage was not changed.`,
      );
  }
  const manifest = copyDurableRuntime({
    projectDir: project,
    destination: temporary,
  });
  checkPaths();
  const hadPrevious = entryExists(destination);
  // Windows cannot rename over a nonempty directory. Promote a completed stage
  // with atomic directory renames and restore the previous one if promotion fails.
  try {
    if (hadPrevious) renameStage(destination, previous);
    renameStage(temporary, destination);
  } catch (error) {
    if (hadPrevious && entryExists(previous) && !entryExists(destination)) {
      try {
        renameStage(previous, destination);
      } catch (rollback) {
        throw new AggregateError(
          [error, rollback],
          `Durable promotion and rollback failed. Preserve/review ${previous} and ${temporary} before retrying.`,
        );
      }
    }
    throw new Error(
      `Durable promotion failed (${String(error)}); completed stage remains at ${temporary}. Close processes holding build files and review that fixed path before retrying.`,
      { cause: error },
    );
  }
  if (hadPrevious) {
    checkPaths();
    try {
      rmSync(previous, {
        recursive: true,
        force: true,
        maxRetries: 5,
        retryDelay: 100,
      });
    } catch (error) {
      throw new Error(
        `Durable stage is ready, but old generated stage remains at ${previous}. Close processes holding it and remove only that directory before retrying.`,
        { cause: error },
      );
    }
  }
  return manifest;
}

if (import.meta.main) {
  const manifest = stageDurableRuntime(resolve(import.meta.dir, ".."));
  console.log(
    `[durable-runtime] Staged ${manifest.packages.length} package placements (native ${DURABLE_RUNTIME_VERSION}, no SDK/TUI).`,
  );
}
