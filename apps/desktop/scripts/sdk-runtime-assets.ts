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

// Keep these packages unbundled: their import.meta.url/package.json, loader aliases,
// theme JSON, QuickJS WASM and adjacent code-mode worker are runtime contracts.
export const SDK_RUNTIME_ROOTS = [
  "@earendil-works/pi-coding-agent",
  "@earendil-works/pi-ai",
  "@earendil-works/pi-tui",
] as const;
export const SDK_RUNTIME_EXTERNALS = SDK_RUNTIME_ROOTS.flatMap((name) => [
  name,
  `${name}/*`,
]);
export const SDK_RUNTIME_STAGE = "build/sdk-runtime";

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
  if (name.toLowerCase().includes("pi-durable"))
    throw new Error(`Durable is forbidden in SDK runtime: ${name}`);
}
function portable(path: string) {
  return path.split(sep).join("/");
}

function canonicalDestination(path: string): string {
  let parent = resolve(path);
  while (!existsSync(parent)) {
    const next = dirname(parent);
    if (next === parent)
      throw new Error(`No existing SDK destination parent: ${path}`);
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

// Check the complete stage, including unexpected files and links, before reusing it.
function stageEntries(root: string) {
  const entries = new Map<string, "file" | "directory">();
  function visit(path: string) {
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      const child = join(path, entry.name);
      if (entry.isDirectory() && !entry.isSymbolicLink()) {
        entries.set(child, "directory");
        visit(child);
      } else if (entry.isFile()) entries.set(child, "file");
      else throw new Error("Invalid SDK stage entry");
    }
  }
  if (!lstatSync(root).isDirectory()) throw new Error("Invalid SDK stage");
  visit(root);
  return entries;
}

function copyPackage(
  source: string,
  destination: string,
  verify?: ReturnType<typeof stageEntries>,
) {
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
      if (verify) {
        if (verify.get(output) !== "directory")
          throw new Error("SDK directory mismatch");
        verify.delete(output);
      } else mkdirSync(output, { recursive: true });
      for (const entry of readdirSync(actual).sort()) {
        if (entry === "node_modules" || entry === ".git") continue;
        copy(join(actual, entry), join(output, entry), next);
      }
    } else if (info.isFile()) {
      if (verify) {
        if (
          verify.get(output) !== "file" ||
          !readFileSync(actual).equals(readFileSync(output))
        )
          throw new Error("SDK file mismatch");
        verify.delete(output);
      } else copyFileSync(actual, output);
    } else throw new Error(`Unsupported package file: ${input}`);
  }
  copy(source, destination, new Set());
}

/** Copy only the installed production closure, preserving package identities and
 * conflicting versions with ordinary nested node_modules (no pnpm/store links).
 * Destination must not exist; callers control replacement of their own stage.
 */
type StageOptions = {
  projectDir: string;
  destination: string;
  roots?: readonly string[];
  // Explicit trust boundary for pnpm links. Defaults to the workspace install.
  installRoot?: string;
};
export function copySdkRuntime(options: StageOptions): RuntimeManifest {
  return assemble(options);
}

export function sdkStageMatches(options: StageOptions): boolean {
  try {
    const files = stageEntries(resolve(options.destination));
    assemble(options, files);
    return files.size === 0;
  } catch {
    // Missing, changed, or damaged stages are rebuilt via the same validated source graph.
    return false;
  }
}

function assemble(
  options: StageOptions,
  verify?: ReturnType<typeof stageEntries>,
): RuntimeManifest {
  const project = realpathSync(options.projectDir);
  const destination = canonicalDestination(options.destination);
  const roots = options.roots ?? SDK_RUNTIME_ROOTS;
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
    throw new Error("SDK destination overlaps source/install tree");
  if (
    !verify &&
    (existsSync(destination) ||
      (() => {
        try {
          lstatSync(destination);
          return true;
        } catch {
          return false;
        }
      })())
  )
    throw new Error(`SDK destination already exists: ${destination}`);
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
    if (!within(allowed, source))
      throw new Error(`Dependency outside install root: ${name}`);
    const cached = graph.get(source);
    if (cached) return cached;
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
    if (!node) throw new Error(`Missing SDK root: ${name}`);
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
    if (verify) {
      for (let p = dirname(path); p !== destination; p = dirname(p))
        verify.delete(p);
    }
    copyPackage(node.source, path, verify);
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
  if (!verify) {
    mkdirSync(dirname(destination), { recursive: true });
    mkdirSync(destination);
  }
  try {
    for (const placement of top.values()) place(placement, top);
    result.packages.sort((a, b) => a.path.localeCompare(b.path));
    const manifest = join(destination, "sdk-runtime-manifest.json");
    const json = `${JSON.stringify(result, null, 2)}\n`;
    if (verify) {
      if (
        verify.get(manifest) !== "file" ||
        readFileSync(manifest, "utf8") !== json
      )
        throw new Error("SDK manifest mismatch");
      verify.delete(manifest);
    } else writeFileSync(manifest, json);
    return result;
  } catch (error) {
    if (!verify) rmSync(destination, { recursive: true, force: true });
    throw error;
  }
}

/** Hutch (Electrobun 2) imports the preBuild hook and calls its default
 * export; `bun scripts/sdk-runtime-assets.ts` runs it directly. Both paths
 * must stage, so no work may hide behind import.meta.main or process.exit.
 */
export function stageSdkRuntime(
  projectDir = resolve(import.meta.dir, ".."),
): void {
  const destination = join(projectDir, SDK_RUNTIME_STAGE);
  if (
    existsSync(dirname(destination)) &&
    lstatSync(dirname(destination)).isSymbolicLink()
  )
    throw new Error("SDK build directory must not be a symlink");
  // This fixed, generated directory is the only path the build hook replaces.
  if (existsSync(destination) && lstatSync(destination).isSymbolicLink())
    throw new Error("SDK stage must not be a symlink");
  if (sdkStageMatches({ projectDir, destination })) {
    console.log("[sdk-runtime] Reusing verified SDK runtime.");
    return;
  }
  const temporary = `${destination}.next`;
  if (existsSync(temporary))
    throw new Error(`Remove interrupted SDK stage first: ${temporary}`);
  const manifest = copySdkRuntime({ projectDir, destination: temporary });
  rmSync(destination, { recursive: true, force: true });
  renameSync(temporary, destination);
  console.log(
    `[sdk-runtime] Staged ${manifest.packages.length} package placements (no Durable).`,
  );
}
export default function preBuild() {
  stageSdkRuntime();
}
if (import.meta.main) stageSdkRuntime();
