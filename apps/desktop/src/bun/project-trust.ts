import { createHash } from "node:crypto";
import type { Dirent } from "node:fs";
import {
  mkdir,
  readdir,
  readFile,
  realpath,
  stat,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import type { UIRequest } from "../shared/extension-ui";
import type { SessionAddress } from "../shared/runtime-contract";
import { desktopConfigDir } from "./desktop-config";
import { agentDir } from "./runtime-profile";
import type { UIRequestBroker } from "./ui-request-broker";

const once = new WeakMap<AbortSignal, Map<string, string>>();

type Resource = Extract<
  UIRequest,
  { kind: "project-trust" }
>["resources"][number];
/** Discovery reads bytes and names only: never imports project code/settings. */
export async function discoverProjectResources(
  cwd: string,
  globalDirs: readonly string[] = [desktopConfigDir, agentDir],
): Promise<Resource[]> {
  const resources: Resource[] = [];
  const seen = new Set<string>();
  const isGlobal = (directory: string) =>
    globalDirs.some(
      (global) =>
        resolve(global).toLowerCase() === resolve(directory).toLowerCase(),
    );
  async function walk(path: string, kind: Resource["kind"], depth = 0) {
    if (depth > 16 || resources.length >= 2000)
      throw new Error("Project resource discovery limit exceeded");
    let canonical: string;
    try {
      canonical = await realpath(path);
    } catch {
      return;
    }
    if (seen.has(canonical)) return;
    seen.add(canonical);
    let entries: Dirent[];
    try {
      entries = await readdir(path, { withFileTypes: true });
    } catch {
      resources.push({ path, kind });
      return;
    }
    for (const entry of entries) {
      if (entry.name === "node_modules" || entry.name === ".git") continue;
      await walk(join(path, entry.name), kind, depth + 1);
    }
  }
  for (const [name, kind] of [
    ["settings.json", "settings"],
    ["extensions", "code"],
    ["skills", "skill"],
    ["prompts", "prompt"],
    ["themes", "settings"],
    ["SYSTEM.md", "instructions"],
    ["APPEND_SYSTEM.md", "instructions"],
  ] as const)
    await walk(join(cwd, ".pi", name), kind);
  let scanAgents = true;
  for (let directory = resolve(cwd); ; ) {
    // SDK also discovers ancestor .agents skills; they cannot bypass Trust.
    // The HOME .agents root is SDK user-scope and is disclosed as a global source.
    if (scanAgents && directory !== resolve(homedir()))
      await walk(join(directory, ".agents", "skills"), "skill");
    if (scanAgents) {
      try {
        await stat(join(directory, ".git"));
        scanAgents = false;
      } catch {
        /* SDK walks to filesystem root without .git. */
      }
    }
    for (const name of [
      "AGENTS.override.md",
      "AGENTS.md",
      "AGENTS.MD",
      "CLAUDE.md",
      "CLAUDE.MD",
    ])
      if (!isGlobal(directory))
        await walk(join(directory, name), "instructions");
    const parent = dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  return resources.sort((a, b) => a.path.localeCompare(b.path));
}
export async function resolveProjectTrust(
  cwd: string,
  address: SessionAddress,
  broker: UIRequestBroker,
  signal: AbortSignal,
  directory = agentDir,
  approvalScope = signal,
) {
  const resources = await discoverProjectResources(cwd);
  signal.throwIfAborted();
  if (!resources.length) return { trusted: true, omitted: [] as Resource[] };
  const canonical = await realpath(cwd);
  if ((await readTrust(directory))[canonical] !== undefined)
    return { trusted: true, omitted: [] as Resource[] };
  const hash = createHash("sha256");
  for (const resource of resources) {
    hash.update(resource.path);
    hash.update(await readFile(resource.path));
  }
  const fingerprint = hash.digest("hex");
  // Session-only trust stays content-bound; persisted trust is folder-scoped.
  if (once.get(approvalScope)?.get(canonical) === fingerprint)
    return { trusted: true, omitted: [] as Resource[] };
  signal.throwIfAborted();
  const reply = await broker.request(
    {
      ...address,
      uiId: crypto.randomUUID(),
      title: "Trust project resources?",
      kind: "project-trust",
      cwd,
      fingerprint,
      resources,
    },
    { signal },
  );
  signal.throwIfAborted();
  if (reply.kind !== "project-trust")
    throw new Error("Project opening cancelled");
  if (reply.value === "persist") await persistProjectTrust(cwd, directory);
  if (reply.value !== "safe") {
    let approved = once.get(approvalScope);
    if (!approved) {
      approved = new Map();
      once.set(approvalScope, approved);
    }
    approved.set(canonical, fingerprint);
  }
  return {
    trusted: reply.value !== "safe",
    omitted: reply.value === "safe" ? resources : [],
  };
}
async function readTrust(directory: string) {
  try {
    const value: unknown = JSON.parse(
      await readFile(join(directory, "desktop-trust.json"), "utf8"),
    );
    if (
      value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      Object.values(value).every((item) => typeof item === "string")
    )
      return value as Record<string, string>;
  } catch {
    /* No implicit trust on corrupt store. */
  }
  return {} as Record<string, string>;
}
/** Folder-scoped like VS Code/Claude Code: editing project files does not revoke trust. */
export async function isProjectTrusted(cwd: string, directory = agentDir) {
  return (await readTrust(directory))[await realpath(cwd)] !== undefined;
}
export async function persistProjectTrust(cwd: string, directory = agentDir) {
  const saved = await readTrust(directory);
  saved[await realpath(cwd)] = "trusted";
  await mkdir(directory, { recursive: true });
  await writeFile(
    join(directory, "desktop-trust.json"),
    JSON.stringify(saved),
    "utf8",
  );
}
