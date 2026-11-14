import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  DefaultPackageManager,
  getAgentDir,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { classify, npmName } from "../shared/packages";
import type {
  InstalledPackage,
  MarketPackage,
  PackageOpStatus,
} from "../shared/rpc-schema";
import { withPackageLock } from "./package-queue";

type ObjectValue = Record<string, unknown>;
const object = (value: unknown): ObjectValue =>
  value !== null && typeof value === "object" ? (value as ObjectValue) : {};
const text = (value: unknown) => (typeof value === "string" ? value : "");
const keywords = (value: unknown) =>
  Array.isArray(value)
    ? value.filter((v): v is string => typeof v === "string")
    : [];
export function repoUrl(
  repository: unknown,
  homepage?: unknown,
): string | undefined {
  const candidate = text(repository)
    .replace(/^git\+/, "")
    .replace(/^git:\/\//, "https://")
    .replace(/\.git$/, "");
  try {
    const url = new URL(candidate);
    if (url.protocol === "https:" || url.protocol === "http:") return url.href;
  } catch {
    /* Fall back to the project's GitHub homepage. */
  }
  try {
    const url = new URL(text(homepage));
    if (url.protocol === "https:" && url.hostname === "github.com")
      return url.href;
  } catch {
    /* A repository link is optional. */
  }
  return undefined;
}
export function mapSearchItem(value: unknown): MarketPackage {
  const item = object(value);
  const pkg = object(item.package);
  const links = object(pkg.links);
  const downloads = object(item.downloads).monthly;
  return {
    name: text(pkg.name),
    version: text(pkg.version),
    description: text(pkg.description),
    publisher: text(object(pkg.publisher).username) || undefined,
    date: text(pkg.date),
    monthlyDownloads:
      typeof downloads === "number" && Number.isFinite(downloads)
        ? downloads
        : 0,
    types: classify(keywords(pkg.keywords)),
    npmUrl: text(links.npm) || undefined,
    repoUrl: repoUrl(links.repository, links.homepage),
  };
}
export function parsePreviews(
  value: unknown,
  names: string[],
): Record<string, string | null> {
  const result: Record<string, string | null> = Object.fromEntries(
    names.map((name) => [name, null]),
  );
  const previews = object(value).previews;
  if (!Array.isArray(previews)) return result;
  for (const entry of previews) {
    const preview = object(entry);
    const name = text(preview.name);
    const media = object(preview.media);
    if (!Object.hasOwn(result, name) || media.type !== "image") continue;
    try {
      const url = new URL(text(media.url));
      if (url.protocol === "https:") result[name] = url.href;
    } catch {
      /* Malformed media is equivalent to no preview. */
    }
  }
  return result;
}
async function getJson(url: URL): Promise<unknown> {
  const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!response.ok)
    throw new Error(`Package service returned HTTP ${response.status}`);
  const body = await response.text();
  if (new TextEncoder().encode(body).byteLength > 5 * 1024 * 1024)
    throw new Error("Package service response exceeds 5 MB");
  try {
    return JSON.parse(body) as unknown;
  } catch (error) {
    throw new Error("Invalid package service JSON response", { cause: error });
  }
}
async function search(query: string, size: number, from: number) {
  try {
    const url = new URL("https://registry.npmjs.org/-/v1/search");
    url.search = new URLSearchParams({
      text: `keywords:pi-package${query ? ` ${query}` : ""}`,
      size: String(size),
      from: String(from),
    }).toString();
    const data = object(await getJson(url));
    if (!Array.isArray(data.objects))
      throw new Error("Invalid npm search response");
    return {
      items: data.objects.map(mapSearchItem),
      total: typeof data.total === "number" ? data.total : 0,
    };
  } catch (error) {
    throw new Error(`Package search failed: ${String(error)}`, {
      cause: error,
    });
  }
}
let catalog: { expires: number; items: MarketPackage[] } | undefined;
let catalogPending: Promise<MarketPackage[]> | undefined;
export async function searchPackages(input: unknown) {
  const { query, page } = object(input);
  if (
    typeof query !== "string" ||
    query.length > 200 ||
    typeof page !== "number" ||
    !Number.isInteger(page) ||
    page < 0 ||
    page > 199
  )
    throw new Error(
      "Invalid package search: query must be at most 200 characters and page an integer from 0 to 199",
    );
  if (query.trim())
    return { ...(await search(query.trim(), 50, page * 50)), pageSize: 50 };
  if (!catalog || catalog.expires <= Date.now()) {
    // shortcut: top 1000 by npm relevance, re-sorted; upgrade when npm offers download-ranked pagination.
    catalogPending ??= Promise.all(
      [0, 250, 500, 750].map((from) => search("", 250, from)),
    )
      .then((pages) => {
        const items = [
          ...new Map(
            pages.flatMap((p) => p.items).map((p) => [p.name, p]),
          ).values(),
        ].sort((a, b) => b.monthlyDownloads - a.monthlyDownloads);
        catalog = { expires: Date.now() + 600_000, items };
        return items;
      })
      .finally(() => {
        catalogPending = undefined;
      });
    await catalogPending;
  }
  const items = catalog?.items ?? [];
  return {
    items: items.slice(page * 50, (page + 1) * 50),
    total: items.length,
    pageSize: 50,
  };
}
const previews = new Map<string, { expires: number; url: string | null }>();
const previewPending = new Map<string, Promise<void>>();
export async function packagePreviews(input: unknown) {
  const { names } = object(input);
  if (
    !Array.isArray(names) ||
    names.length > 64 ||
    !names.every(
      (name) =>
        typeof name === "string" && name.length > 0 && name.length <= 214,
    )
  )
    throw new Error("Invalid preview names (maximum 64)");
  const unique = [...new Set<string>(names)];
  const missing = unique.filter(
    (name) =>
      (previews.get(name)?.expires ?? 0) <= Date.now() &&
      !previewPending.has(name),
  );
  for (let i = 0; i < missing.length; i += 16) {
    const batch = missing.slice(i, i + 16);
    const pending = (async () => {
      try {
        const url = new URL("https://pi.dev/api/packages/preview-media");
        for (const name of batch) url.searchParams.append("name", name);
        const parsed = parsePreviews(await getJson(url), batch);
        for (const name of batch)
          previews.set(name, {
            expires: Date.now() + 300_000,
            url: parsed[name] ?? null,
          });
      } catch {
        // Network failures are retryable, not negative cache entries.
      } finally {
        for (const name of batch) previewPending.delete(name);
      }
    })();
    for (const name of batch) previewPending.set(name, pending);
  }
  await Promise.all(unique.map((name) => previewPending.get(name)));
  return Object.fromEntries(
    unique.map((name) => [name, previews.get(name)?.url ?? null]),
  );
}
let manager:
  | { settings: SettingsManager; pm: DefaultPackageManager }
  | undefined;
function packageManager() {
  if (!manager) {
    const cwd = homedir();
    const agentDir = getAgentDir();
    const settings = SettingsManager.create(cwd, agentDir, {
      projectTrusted: false,
    });
    manager = {
      settings,
      pm: new DefaultPackageManager({
        cwd,
        agentDir,
        settingsManager: settings,
      }),
    };
  }
  return manager;
}
function checkErrors(settings: SettingsManager) {
  const errors = settings.drainErrors();
  if (errors.length)
    throw new Error(
      errors.map((e) => `${e.path ?? e.scope}: ${e.error.message}`).join("; "),
    );
}
async function configured() {
  const { settings, pm } = packageManager();
  await settings.reload();
  checkErrors(settings);
  return pm.listConfiguredPackages().filter((p) => p.scope === "user");
}
type Configured = Awaited<ReturnType<typeof configured>>;
let updateCache: { expires: number; sources: Set<string> } | undefined;
let updatePending: Promise<Set<string>> | undefined;
let updateGeneration = 0;
let publishedGeneration = -1;
function invalidateUpdates() {
  updateGeneration++;
  updateCache = undefined;
}
async function availableUpdates() {
  if (updateCache && updateCache.expires > Date.now())
    return updateCache.sources;
  if (!updatePending) {
    const generation = updateGeneration;
    updatePending = packageManager()
      .pm.checkForAvailableUpdates()
      .then((found) => {
        const sources = new Set(found.map((p) => p.source));
        if (generation === updateGeneration)
          updateCache = { expires: Date.now() + 60_000, sources };
        return sources;
      })
      .catch(() => new Set<string>())
      .finally(() => {
        updatePending = undefined;
      });
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    updatePending,
    new Promise<Set<string>>((resolve) => {
      timer = setTimeout(() => resolve(new Set()), 8000);
    }),
  ]).finally(() => clearTimeout(timer));
}
async function installed(entries: Configured): Promise<InstalledPackage[]> {
  const updates = updateCache?.sources ?? new Set<string>();
  return Promise.all(
    entries.map(async (entry) => {
      let pkg: ObjectValue = {};
      if (npmName(entry.source) && entry.installedPath) {
        try {
          pkg = object(
            JSON.parse(
              await readFile(join(entry.installedPath, "package.json"), "utf8"),
            ),
          );
        } catch {
          /* Missing or malformed manifests must not hide configured sources. */
        }
      }
      return {
        source: entry.source,
        scope: entry.scope,
        name: text(pkg.name) || npmName(entry.source) || entry.source,
        version: text(pkg.version) || undefined,
        description: text(pkg.description) || undefined,
        types: classify(keywords(pkg.keywords)),
        updateAvailable: updates.has(entry.source),
      };
    }),
  );
}
export async function listInstalled(
  pushUpdates?: (packages: InstalledPackage[]) => void,
) {
  const entries = await withPackageLock(configured);
  const generation = updateGeneration;
  const items = await installed(entries);
  // Registry checks enrich the list later; offline npm must not hide installed packages.
  if (pushUpdates && entries.length)
    void availableUpdates()
      .then(async () => {
        const enriched = await installed(entries);
        if (generation === updateGeneration) pushUpdates(enriched);
      })
      .catch(console.warn);
  return items;
}

// Small dependency seam: tests never need a real agent directory or npm process.
type OperationDependencies = {
  configured: () => Promise<Configured>;
  mutate: (action: PackageOpStatus["action"], source: string) => Promise<void>;
  installed: (entries: Configured) => Promise<InstalledPackage[]>;
};
const operationDependencies: OperationDependencies = {
  configured,
  installed,
  async mutate(action, source) {
    const { settings, pm } = packageManager();
    if (action === "install") await pm.installAndPersist(source);
    else if (action === "uninstall") await pm.removeAndPersist(source);
    else await pm.update(source);
    await settings.flush();
    checkErrors(settings);
  },
};
export async function packageOperation(
  action: PackageOpStatus["action"],
  input: unknown,
  emit: (event: PackageOpStatus) => void,
  pushInstalled: (packages: InstalledPackage[]) => void,
  reload: () => Promise<void> | Promise<string[]>,
  warn: (message: string) => void = console.warn,
  deps: OperationDependencies = operationDependencies,
) {
  const value = object(input);
  if (typeof value.opId !== "string" || !value.opId || value.opId.length > 200)
    throw new Error("Invalid package operation ID");
  const opId = value.opId;
  const source =
    action === "install" ? `npm:${text(value.name)}` : text(value.source);
  const frame = { opId, source, action };
  const refreshWarning = (error: unknown) =>
    warn(
      `Package ${action} succeeded for ${source}, but refreshing the installed list failed: ${String(error)}`,
    );
  const result = await withPackageLock(async () => {
    try {
      if (
        action === "install" &&
        (typeof value.name !== "string" ||
          value.name.length > 214 ||
          !/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/.test(
            value.name,
          ))
      )
        throw new Error("Invalid npm package name");
      const entries = await deps.configured();
      if (action !== "install" && !entries.some((p) => p.source === source))
        throw new Error("Package source is not configured");
      emit({ ...frame, status: "running" });
      try {
        await deps.mutate(action, source);
      } finally {
        invalidateUpdates();
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      const info = error as NodeJS.ErrnoException;
      const npmMissing =
        info?.code === "ENOENT" &&
        /\bnpm(?:\.cmd|\.exe)?\b/i.test(
          `${info.path ?? ""} ${info.syscall ?? ""} ${detail}`,
        );
      const message = npmMissing
        ? "npm was not found. Install Node.js (npm) or set npmCommand in ~/.pi/agent/settings.json"
        : `Package ${action} failed for ${source}: ${detail}`;
      emit({ ...frame, status: "error", message });
      throw new Error(message);
    }
    let entries: Configured | undefined;
    try {
      entries = await deps.configured();
    } catch (error) {
      refreshWarning(error);
    }
    return { entries, generation: updateGeneration };
  });
  // Persistence is the success boundary. Discovery failures must not leave a
  // successful install spinning forever or prevent the next queued mutation.
  try {
    if (result.entries) {
      const items = await deps.installed(result.entries);
      if (result.generation >= publishedGeneration) {
        pushInstalled(items);
        publishedGeneration = result.generation;
      }
    }
  } catch (error) {
    refreshWarning(error);
  }
  emit({ ...frame, status: "done" });
  let failures: string[];
  try {
    failures = (await reload()) ?? [];
  } catch (error) {
    failures = [String(error)];
  }
  if (failures.length) {
    const verb =
      action === "install"
        ? "Installed"
        : action === "uninstall"
          ? "Uninstalled"
          : "Updated";
    warn(
      `${verb} ${source}, but reloading ${failures.length} open chat(s) failed: ${failures.join("; ")}`,
    );
  }
}
