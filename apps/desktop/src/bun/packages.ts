import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import {
  classify,
  type InstalledPackage,
  type MarketPackage,
  npmName,
  type PackageApplyReport,
  type PackageChange,
  type PackageEvent,
  type PackageOperation,
  type PackageOperationResult,
  type PackageSearch,
  type PackageService,
  packageCompatibility,
  validNpmName,
} from "../shared/packages";
import { packageProfileKey, withPackageLock } from "./package-queue";

const object = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
const text = (value: unknown) => (typeof value === "string" ? value : "");
const keywords = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((v): v is string => typeof v === "string")
    : [];
const detail = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

async function searchJson(response: Response): Promise<unknown> {
  const limit = 5 * 1024 * 1024;
  if (Number(response.headers.get("content-length")) > limit) {
    await response.body?.cancel();
    throw new Error("Package search response exceeds 5 MB");
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Empty npm search response");
  const decoder = new TextDecoder();
  let bytes = 0;
  let body = "";
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > limit) {
        await reader.cancel();
        throw new Error("Package search response exceeds 5 MB");
      }
      body += decoder.decode(part.value, { stream: true });
    }
    return JSON.parse(body + decoder.decode()) as unknown;
  } finally {
    reader.releaseLock();
  }
}

export function mapSearchItem(value: unknown): MarketPackage | undefined {
  const item = object(value);
  const pkg = object(item.package);
  if (!validNpmName(pkg.name)) return undefined;
  const version = text(pkg.version);
  const count = object(item.downloads).monthly;
  return {
    name: pkg.name,
    version,
    description: text(pkg.description),
    types: classify(keywords(pkg.keywords)),
    monthlyDownloads:
      typeof count === "number" && Number.isFinite(count)
        ? Math.max(0, count)
        : 0,
    compatibility: packageCompatibility(pkg.name, version),
  };
}

export type ConfiguredPackage = {
  source: string;
  scope: "user" | "project";
  installedPath?: string;
};
/** Structural SDK seam: fake managers never need npm, credentials, or a real HOME. */
export type PackageManagerContext = {
  settings: {
    reload(): void | Promise<void>;
    flush(): Promise<void>;
    drainErrors(): { path?: string; scope: string; error: Error }[];
    getProjectSettings(): { packages?: unknown[] };
  };
  pm: {
    listConfiguredPackages(): ConfiguredPackage[];
    installAndPersist(source: string, options: { local: false }): Promise<void>;
    removeAndPersist(
      source: string,
      options: { local: false },
    ): Promise<boolean>;
    update(source: string): Promise<void>;
  };
};
export type PackageProfile = {
  agentDir: string;
  cwd: string;
  projectTrusted: false;
};
export type PackageServiceOptions = {
  /** Required absolute path. Bootstrap fixes PI_CODING_AGENT_DIR before SDK import. */
  agentDir: string;
  createManager?: (
    profile: PackageProfile,
  ) => Promise<PackageManagerContext> | PackageManagerContext;
  fetch?: typeof globalThis.fetch;
  /** Schedule/defer application here. Never wait for an active session to become idle. */
  onChanged?: (
    change: PackageChange,
  ) => Promise<PackageApplyReport | undefined> | PackageApplyReport | undefined;
  warn?: (message: string) => void;
};
export interface PackageController extends PackageService {
  /** Runtime publishes later deferred completion/errors, retaining loader diagnostics. */
  reportApply(change: PackageChange, report: PackageApplyReport): void;
}

export async function createSdkPackageManager(
  profile: PackageProfile,
): Promise<PackageManagerContext> {
  const { DefaultPackageManager, SettingsManager, getAgentDir } = await import(
    "@earendil-works/pi-coding-agent"
  );
  if (
    packageProfileKey(getAgentDir()) !== packageProfileKey(profile.agentDir)
  ) {
    throw new Error(
      "SDK profile mismatch: fix PI_CODING_AGENT_DIR at process bootstrap before importing the SDK",
    );
  }
  const settings = SettingsManager.create(profile.cwd, profile.agentDir, {
    projectTrusted: false,
  });
  return {
    settings,
    pm: new DefaultPackageManager({
      cwd: profile.cwd,
      agentDir: profile.agentDir,
      settingsManager: settings,
    }),
  };
}

/** No implicit CLI profile or selected workspace; all SDK operations are user-only. */
export function createPackageService(
  options: PackageServiceOptions,
): PackageController {
  if (!isAbsolute(options.agentDir))
    throw new Error("An absolute SDK agentDir is required");
  const agentDir = resolve(options.agentDir);
  if (
    packageProfileKey(agentDir) ===
    packageProfileKey(join(homedir(), ".pi", "agent"))
  ) {
    throw new Error(
      "Marketplace cannot modify the legacy CLI profile ~/.pi/agent",
    );
  }
  // cwd is deliberately not a chat/project directory. Untrusted project settings stay empty.
  const profile: PackageProfile = {
    agentDir,
    cwd: homedir(),
    projectTrusted: false,
  };
  const listeners = new Set<(event: PackageEvent) => void>();
  const warn = options.warn ?? console.warn;
  function emit(event: PackageEvent) {
    for (const listener of listeners) {
      try {
        listener(event);
      } catch (error) {
        warn(`Package event listener failed: ${detail(error)}`);
      }
    }
  }
  const diagnostic = (message: string) =>
    emit({ type: "diagnostic", agentDir, message });
  let manager: Promise<PackageManagerContext> | undefined;
  function getManager() {
    manager ??= Promise.resolve()
      .then(() => (options.createManager ?? createSdkPackageManager)(profile))
      .catch((error) => {
        manager = undefined;
        throw error;
      });
    return manager;
  }
  function checkErrors(ctx: PackageManagerContext) {
    const errors = ctx.settings.drainErrors();
    if (errors.length)
      throw new Error(
        errors
          .map((e) => `${e.path ?? e.scope}: ${e.error.message}`)
          .join("; "),
      );
  }
  async function configured(ctx: PackageManagerContext) {
    await ctx.settings.reload();
    checkErrors(ctx);
    // SDK update() scans BOTH scopes. Fail closed even if a future adapter breaks trust isolation.
    if (ctx.settings.getProjectSettings().packages?.length) {
      throw new Error(
        "Marketplace requires user-only settings (projectTrusted: false)",
      );
    }
    const entries = ctx.pm.listConfiguredPackages();
    if (entries.some((entry) => entry.scope !== "user")) {
      throw new Error(
        "Unexpected project package in user-only Marketplace context",
      );
    }
    return entries;
  }
  async function installed(
    entries: ConfiguredPackage[],
  ): Promise<InstalledPackage[]> {
    return Promise.all(
      entries.map(async (entry) => {
        let pkg: Record<string, unknown> = {};
        if (npmName(entry.source) && entry.installedPath) {
          try {
            pkg = object(
              JSON.parse(
                await readFile(
                  join(entry.installedPath, "package.json"),
                  "utf8",
                ),
              ),
            );
          } catch {
            // Keep configured packages visible even if a failed install left no manifest.
          }
        }
        const name = text(pkg.name) || npmName(entry.source) || entry.source;
        const version = text(pkg.version) || undefined;
        return {
          source: entry.source,
          scope: "user",
          name,
          version,
          description: text(pkg.description) || undefined,
          types: classify(keywords(pkg.keywords)),
          compatibility: packageCompatibility(name, version),
        };
      }),
    );
  }
  function reportApply(change: PackageChange, report: PackageApplyReport) {
    if (packageProfileKey(change.agentDir) !== packageProfileKey(agentDir)) {
      throw new Error("Cannot report package application for another profile");
    }
    emit({ type: "apply", change, report });
  }
  return {
    agentDir,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    reportApply,
    async search(input: PackageSearch) {
      if (
        typeof input?.query !== "string" ||
        input.query.length > 200 ||
        !Number.isInteger(input.page) ||
        input.page < 0 ||
        input.page > 199
      ) {
        throw new Error(
          "Invalid package search (query <= 200 characters, page 0–199)",
        );
      }
      // No lock or manager creation: network search cannot block chat/resource discovery.
      const url = new URL("https://registry.npmjs.org/-/v1/search");
      url.search = new URLSearchParams({
        text: `keywords:pi-package ${input.query.trim()}`.trim(),
        size: "50",
        from: String(input.page * 50),
      }).toString();
      const response = await (options.fetch ?? globalThis.fetch)(url, {
        signal: AbortSignal.timeout(15_000),
        redirect: "error",
        credentials: "omit",
      });
      if (!response.ok)
        throw new Error(`Package search returned HTTP ${response.status}`);
      const data = object(await searchJson(response));
      if (!Array.isArray(data.objects))
        throw new Error("Invalid npm search response");
      return {
        items: data.objects
          .map(mapSearchItem)
          .filter((item): item is MarketPackage => !!item),
        total:
          typeof data.total === "number" && Number.isFinite(data.total)
            ? Math.max(0, data.total)
            : 0,
        pageSize: 50,
      };
    },
    listInstalled() {
      return withPackageLock(agentDir, async () =>
        installed(await configured(await getManager())),
      );
    },
    async operate(input: PackageOperation): Promise<PackageOperationResult> {
      if (
        !input ||
        typeof input.opId !== "string" ||
        !input.opId ||
        input.opId.length > 200 ||
        !["install", "update", "uninstall"].includes(input.action)
      )
        throw new Error("Invalid package operation");
      const source =
        input.action === "install" ? `npm:${input.name}` : input.source;
      const change: PackageChange = {
        agentDir,
        opId: input.opId,
        source,
        action: input.action,
      };
      emit({ type: "operation", operation: { ...change, status: "queued" } });
      await withPackageLock(agentDir, async () => {
        try {
          if (input.action === "install" && !validNpmName(input.name))
            throw new Error("Invalid npm package name");
          if (typeof source !== "string" || !source || source.length > 4096)
            throw new Error("Invalid package source");
          const ctx = await getManager();
          const entries = await configured(ctx);
          if (
            input.action !== "install" &&
            !entries.some((entry) => entry.source === source)
          )
            throw new Error(
              "Package source is not configured in this user profile",
            );
          emit({
            type: "operation",
            operation: { ...change, status: "running" },
          });
          if (input.action === "install")
            await ctx.pm.installAndPersist(source, { local: false });
          else if (input.action === "uninstall") {
            if (!(await ctx.pm.removeAndPersist(source, { local: false })))
              throw new Error("Package was not removed from user settings");
          } else await ctx.pm.update(source);
          await ctx.settings.flush();
          checkErrors(ctx);
          // Refresh failure is NOT an installation failure. Keep prior UI state and expose it.
          try {
            emit({
              type: "installed",
              agentDir,
              packages: await installed(await configured(ctx)),
            });
          } catch (error) {
            diagnostic(
              `Package changed, but Installed refresh failed: ${detail(error)}`,
            );
          }
        } catch (error) {
          const message = `Package ${input.action} failed for ${source}: ${detail(error)}. Profile: ${agentDir}. If npm is missing, install Node.js/npm or configure npmCommand in this profile's settings.json. State may be partially changed; refresh before retrying.`;
          emit({
            type: "operation",
            operation: { ...change, status: "error", message },
          });
          throw new Error(message);
        }
      });
      const operation = { ...change, status: "done" as const };
      emit({ type: "operation", operation });
      let apply: PackageApplyReport = {
        status: "pending",
        message: "Package saved. Session application is pending.",
      };
      reportApply(change, apply);
      // Never reload inside the package queue; the SessionHost owns safe deferral/epochs.
      if (options.onChanged) {
        try {
          apply = (await options.onChanged(change)) ?? apply;
        } catch (error) {
          apply = {
            status: "error",
            message: `Package saved, but session application failed: ${detail(error)}`,
          };
        }
        reportApply(change, apply);
      }
      return { operation, apply };
    },
  };
}
