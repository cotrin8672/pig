import { readdir } from "node:fs/promises";
import { join } from "node:path";

export interface ProjectPath {
  path: string;
  directory: boolean;
}

const TTL = 5_000;
const MAX_FILES = 50_000;
const LIMIT = 50;
const SKIP = new Set([".git", "node_modules"]);
const MAX_CACHED_PROJECTS = 8;
/** Completed scans only; in-flight scans are shared separately so a slow scan
 * past its TTL is not restarted, and the completed cache stays bounded. */
const cache = new Map<string, { at: number; paths: ProjectPath[] }>();
const scanning = new Map<string, Promise<ProjectPath[]>>();

async function gitFiles(cwd: string) {
  const child = Bun.spawn(
    ["git", "ls-files", "-z", "--cached", "--others", "--exclude-standard"],
    { cwd, stdout: "pipe", stderr: "ignore", windowsHide: true },
  );
  const timer = setTimeout(() => child.kill(), 5_000);
  try {
    const [out, code] = await Promise.all([
      new Response(child.stdout).text(),
      child.exited,
    ]);
    if (code !== 0) return undefined;
    return out.split("\0").filter(Boolean).slice(0, MAX_FILES);
  } finally {
    clearTimeout(timer);
  }
}

async function walkFiles(cwd: string) {
  const files: string[] = [];
  const queue = [""];
  for (let next = 0; next < queue.length && files.length < MAX_FILES; next++) {
    const dir = queue[next];
    const entries = await readdir(join(cwd, dir), {
      withFileTypes: true,
    }).catch(() => []);
    for (const entry of entries) {
      if (SKIP.has(entry.name)) continue;
      const path = dir ? `${dir}/${entry.name}` : entry.name;
      if (entry.isDirectory()) queue.push(path);
      else files.push(path);
    }
  }
  return files;
}

async function scan(cwd: string): Promise<ProjectPath[]> {
  const files =
    (await gitFiles(cwd).catch(() => undefined)) ?? (await walkFiles(cwd));
  const directories = new Set<string>();
  for (const file of files)
    for (let i = file.indexOf("/"); i > 0; i = file.indexOf("/", i + 1))
      directories.add(file.slice(0, i));
  return [
    ...[...directories].map((path) => ({ path, directory: true })),
    ...files.map((path) => ({ path, directory: false })),
  ];
}

function projectPaths(cwd: string): Promise<ProjectPath[]> {
  const hit = cache.get(cwd);
  if (hit && Date.now() - hit.at < TTL) return Promise.resolve(hit.paths);
  const pending = scanning.get(cwd);
  if (pending) return pending;
  const at = Date.now();
  const paths = scan(cwd).then((value) => {
    cache.delete(cwd);
    cache.set(cwd, { at, paths: value });
    while (cache.size > MAX_CACHED_PROJECTS)
      cache.delete(cache.keys().next().value as string);
    return value;
  });
  scanning.set(cwd, paths);
  void paths
    .finally(() => {
      if (scanning.get(cwd) === paths) scanning.delete(cwd);
    })
    .catch(() => {});
  return paths;
}

/** Lower is better; undefined when the query does not match. */
function rank(path: string, query: string) {
  const lower = path.toLowerCase();
  const base = lower.slice(lower.lastIndexOf("/") + 1);
  if (base.startsWith(query)) return 0;
  if (lower.startsWith(query)) return 1;
  if (base.includes(query)) return 2;
  if (lower.includes(query)) return 3;
  let at = 0;
  for (const char of query) {
    at = lower.indexOf(char, at) + 1;
    if (!at) return undefined;
  }
  return 4;
}

/** Paths relative to the project folder for an `@` mention in the composer. */
export async function searchProjectPaths(cwd: string, query: string) {
  const paths = await projectPaths(cwd);
  const q = query.replace(/\\/g, "/").replace(/^\.\//, "").toLowerCase();
  if (!q)
    return paths
      .filter(({ path }) => !path.includes("/"))
      .sort(
        (a, b) =>
          Number(b.directory) - Number(a.directory) ||
          a.path.localeCompare(b.path),
      )
      .slice(0, LIMIT);
  // Keep only the best LIMIT matches (stable for ties, like a full sort).
  const order = (a: [number, ProjectPath], b: [number, ProjectPath]) =>
    a[0] - b[0] ||
    a[1].path.length - b[1].path.length ||
    a[1].path.localeCompare(b[1].path);
  const best: [number, ProjectPath][] = [];
  for (const item of paths) {
    const score = rank(item.path, q);
    if (score === undefined) continue;
    const entry: [number, ProjectPath] = [score, item];
    if (best.length === LIMIT && order(entry, best[LIMIT - 1]) >= 0) continue;
    let at = best.length;
    while (at > 0 && order(entry, best[at - 1]) < 0) at--;
    best.splice(at, 0, entry);
    if (best.length > LIMIT) best.pop();
  }
  return best.map(([, item]) => item);
}
