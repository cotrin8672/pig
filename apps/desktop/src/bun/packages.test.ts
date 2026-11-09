import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { PackageEvent } from "../shared/packages";
import {
  type ConfiguredPackage,
  createPackageService,
  type PackageManagerContext,
  type PackageServiceOptions,
} from "./packages";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});
async function fixture() {
  const root = await mkdtemp(
    join(process.env.PI_SCRATCH_DIR ?? tmpdir(), "marketplace-"),
  );
  roots.push(root);
  const agentDir = join(root, ".config", "pig", "pi-agent");
  await mkdir(agentDir, { recursive: true });
  const entries: ConfiguredPackage[] = [
    { source: "npm:fixture", scope: "user" },
  ];
  const calls: { action: string; source: string; local?: boolean }[] = [];
  let failure: Error | undefined;
  let projects: unknown[] = [];
  let reloadFailure = false;
  let flushed = false;
  const ctx: PackageManagerContext = {
    settings: {
      reload() {
        if (reloadFailure) throw new Error("settings unreadable");
      },
      async flush() {
        flushed = true;
      },
      drainErrors() {
        return [];
      },
      getProjectSettings() {
        return { packages: projects };
      },
    },
    pm: {
      listConfiguredPackages() {
        return entries.map((entry) => ({ ...entry }));
      },
      async installAndPersist(source, options) {
        calls.push({ action: "install", source, ...options });
        if (failure) throw failure;
        entries.push({ source, scope: "user" });
      },
      async removeAndPersist(source, options) {
        calls.push({ action: "uninstall", source, ...options });
        if (failure) throw failure;
        const index = entries.findIndex((entry) => entry.source === source);
        if (index < 0) return false;
        entries.splice(index, 1);
        return true;
      },
      async update(source) {
        calls.push({ action: "update", source });
        if (failure) throw failure;
      },
    },
  };
  const events: PackageEvent[] = [];
  const service = (extra: Partial<PackageServiceOptions> = {}) => {
    const result = createPackageService({
      agentDir,
      createManager(profile) {
        expect(profile).toEqual({
          agentDir: resolve(agentDir),
          cwd: homedir(),
          projectTrusted: false,
        });
        return ctx;
      },
      ...extra,
    });
    result.subscribe((event) => events.push(event));
    return result;
  };
  return {
    root,
    agentDir,
    entries,
    ctx,
    calls,
    events,
    service,
    fail(error?: Error) {
      failure = error;
    },
    project(packages: unknown[]) {
      projects = packages;
    },
    failReload() {
      reloadFailure = true;
    },
    flushed: () => flushed,
  };
}
const fakeFetch = (
  handler: (url: URL, init?: RequestInit) => Promise<Response> | Response,
) =>
  ((url: string | URL | Request, init?: RequestInit) =>
    handler(new URL(String(url)), init)) as typeof fetch;
const deferred = () => {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
};

describe("bounded user-profile Marketplace", () => {
  test("search uses only the fixed npm endpoint, keyword and bounded pagination, without a manager", async () => {
    const f = await fixture();
    const service = f.service({
      createManager() {
        throw new Error("search must not construct manager");
      },
      fetch: fakeFetch((url, init) => {
        expect(url.origin + url.pathname).toBe(
          "https://registry.npmjs.org/-/v1/search",
        );
        expect(url.searchParams.get("text")).toBe(
          "keywords:pi-package https://untrusted.invalid",
        );
        expect(url.searchParams.get("from")).toBe("100");
        expect(init?.credentials).toBe("omit");
        expect(init?.redirect).toBe("error");
        return Response.json({
          total: 1,
          objects: [
            {
              package: {
                name: "fixture",
                version: "1.0.0",
                keywords: ["pi-extension"],
                compatibility: "safe",
              },
            },
          ],
        });
      }),
    });
    const result = await service.search({
      query: " https://untrusted.invalid ",
      page: 2,
    });
    expect(result.items[0].types).toEqual(["extension"]);
    expect(result.items[0].compatibility).toEqual({ status: "unverified" });
    await expect(
      service.search({ query: "x".repeat(201), page: 0 }),
    ).rejects.toThrow("Invalid");
    await expect(service.search({ query: "", page: -1 })).rejects.toThrow(
      "Invalid",
    );
    await expect(service.search({ query: "", page: 200 })).rejects.toThrow(
      "Invalid",
    );
  });
  test("network, malformed JSON and HTTP failures are visible", async () => {
    const f = await fixture();
    for (const fetch of [
      fakeFetch(() => {
        throw new Error("offline");
      }),
      fakeFetch(() => new Response("no", { status: 503 })),
      fakeFetch(() => Response.json({ nope: [] })),
    ]) {
      await expect(
        f.service({ fetch }).search({ query: "", page: 0 }),
      ).rejects.toThrow();
    }
  });
  test("install, selected-source update, remove all use the same explicit user profile", async () => {
    const f = await fixture();
    const service = f.service();
    const install = await service.operate({
      opId: "1",
      action: "install",
      name: "@scope/fixture",
    });
    expect(install.operation.status).toBe("done");
    expect(install.apply.status).toBe("pending");
    expect(f.flushed()).toBe(true);
    expect((await service.listInstalled()).map((pkg) => pkg.source)).toEqual([
      "npm:fixture",
      "npm:@scope/fixture",
    ]);
    await service.operate({
      opId: "2",
      action: "update",
      source: "npm:@scope/fixture",
    });
    await service.operate({
      opId: "3",
      action: "uninstall",
      source: "npm:@scope/fixture",
    });
    expect(f.calls).toEqual([
      { action: "install", source: "npm:@scope/fixture", local: false },
      { action: "update", source: "npm:@scope/fixture" },
      { action: "uninstall", source: "npm:@scope/fixture", local: false },
    ]);
    expect((await service.listInstalled()).map((pkg) => pkg.source)).toEqual([
      "npm:fixture",
    ]);
  });
  test("rejects CLI profile, relative profile, arbitrary install URLs and unconfigured sources", async () => {
    const f = await fixture();
    expect(() => createPackageService({ agentDir: "relative" })).toThrow(
      "absolute",
    );
    expect(() =>
      createPackageService({ agentDir: join(homedir(), ".pi", "agent") }),
    ).toThrow("legacy");
    for (const name of [
      "https://evil.invalid/pkg",
      "pkg; touch x",
      "../local",
      "fixture@latest",
    ]) {
      await expect(
        f.service().operate({ opId: "bad", action: "install", name }),
      ).rejects.toThrow("Invalid npm");
    }
    await expect(
      f.service().operate({
        opId: "bad",
        action: "update",
        source: "npm:project-only",
      }),
    ).rejects.toThrow("not configured");
    expect(f.calls).toEqual([]);
  });
  test("refuses project settings before SDK update scans either scope", async () => {
    const f = await fixture();
    f.project(["npm:fixture"]);
    await expect(
      f.service().operate({
        opId: "scope",
        action: "update",
        source: "npm:fixture",
      }),
    ).rejects.toThrow("user-only");
    expect(f.calls).toEqual([]);
    f.project([]);
    f.entries.push({ source: "npm:project", scope: "project" });
    await expect(f.service().listInstalled()).rejects.toThrow(
      "Unexpected project",
    );
  });
  test("serializes instances of one profile; independent profiles and search are not blocked", async () => {
    const f = await fixture();
    const g = await fixture();
    const entered = deferred();
    const blocked = deferred();
    f.ctx.pm.installAndPersist = async () => {
      f.calls.push({ action: "held", source: "npm:hold" });
      entered.release();
      await blocked.promise;
    };
    const first = f.service().operate({
      opId: "a",
      action: "install",
      name: "hold",
    });
    await entered.promise;
    const second = f.service().operate({
      opId: "b",
      action: "update",
      source: "npm:fixture",
    });
    const other = await g.service().operate({
      opId: "c",
      action: "update",
      source: "npm:fixture",
    });
    expect(other.operation.status).toBe("done");
    const search = await f
      .service({
        fetch: fakeFetch(() => Response.json({ objects: [], total: 0 })),
      })
      .search({ query: "", page: 0 });
    expect(search.total).toBe(0);
    expect(f.calls).toHaveLength(1);
    blocked.release();
    await Promise.all([first, second]);
    expect(f.calls.map((call) => call.action)).toEqual(["held", "update"]);
  });
  test("npm/install/removal failures preserve Installed and do not poison the queue or apply sessions", async () => {
    const f = await fixture();
    let applications = 0;
    const service = f.service({
      onChanged() {
        applications++;
        return undefined;
      },
    });
    const before = await service.listInstalled();
    f.fail(new Error("ENOENT npm"));
    await expect(
      service.operate({ opId: "fail", action: "install", name: "broken" }),
    ).rejects.toThrow("npmCommand");
    await expect(
      service.operate({
        opId: "remove",
        action: "uninstall",
        source: "npm:fixture",
      }),
    ).rejects.toThrow("ENOENT npm");
    expect(await service.listInstalled()).toEqual(before);
    expect(f.events.some((event) => event.type === "installed")).toBe(false);
    expect(applications).toBe(0);
    f.fail();
    await service.operate({
      opId: "retry",
      action: "update",
      source: "npm:fixture",
    });
    expect(applications).toBe(1);
  });
  test("SDK settings errors fail visibly before mutation", async () => {
    const f = await fixture();
    f.ctx.settings.drainErrors = () => [
      { scope: "user", error: new Error("invalid JSON") },
    ];
    await expect(
      f.service().operate({
        opId: "settings",
        action: "update",
        source: "npm:fixture",
      }),
    ).rejects.toThrow("invalid JSON");
    expect(f.calls).toEqual([]);
  });
  test("false removal result is an error, never a success", async () => {
    const f = await fixture();
    f.ctx.pm.removeAndPersist = async () => false;
    await expect(
      f.service().operate({
        opId: "false",
        action: "uninstall",
        source: "npm:fixture",
      }),
    ).rejects.toThrow("not removed");
    expect(f.events.some((event) => event.type === "apply")).toBe(false);
  });
  test("successful package save is distinct from application failure, retaining duplicate SDK warnings", async () => {
    const f = await fixture();
    const warning =
      "Extension bundles a duplicate @earendil-works/pi-tui module";
    const service = f.service({
      onChanged: () => ({
        status: "pending",
        pendingSessionIds: ["running", "input-waiting"],
        diagnostics: [warning],
      }),
    });
    const result = await service.operate({
      opId: "pending",
      action: "update",
      source: "npm:fixture",
    });
    expect(result.operation.status).toBe("done");
    expect(result.apply.pendingSessionIds).toEqual([
      "running",
      "input-waiting",
    ]);
    service.reportApply(result.operation, {
      status: "error",
      message: "Extension load failed",
      diagnostics: [warning],
    });
    expect(f.events.at(-1)).toEqual({
      type: "apply",
      change: result.operation,
      report: {
        status: "error",
        message: "Extension load failed",
        diagnostics: [warning],
      },
    });
    expect(() =>
      service.reportApply(
        { ...result.operation, agentDir: join(f.root, "other") },
        { status: "applied" },
      ),
    ).toThrow("another profile");
    const thrown = await f
      .service({
        onChanged() {
          throw new Error("reload boom");
        },
      })
      .operate({ opId: "reload", action: "update", source: "npm:fixture" });
    expect(thrown.operation.status).toBe("done");
    expect(thrown.apply.status).toBe("error");
  });
  test("application callbacks run outside package lock and Installed refresh failures stay separate", async () => {
    const f = await fixture();
    const service = f.service({
      async onChanged() {
        // Would deadlock if callbacks ran under the profile queue.
        await service.listInstalled();
        return { status: "applied" };
      },
    });
    expect(
      (
        await service.operate({
          opId: "outside",
          action: "update",
          source: "npm:fixture",
        })
      ).apply.status,
    ).toBe("applied");
    f.ctx.pm.update = async () => {
      f.failReload();
    };
    const result = await f.service().operate({
      opId: "refresh",
      action: "update",
      source: "npm:fixture",
    });
    expect(result.operation.status).toBe("done");
    expect(
      f.events.some(
        (event) =>
          event.type === "diagnostic" &&
          event.message.includes("refresh failed"),
      ),
    ).toBe(true);
  });
  test("isolated manifest reads keep missing packages visible and never change project sentinel", async () => {
    const f = await fixture();
    const manifestDir = join(f.agentDir, "fixture");
    await mkdir(manifestDir);
    await writeFile(
      join(manifestDir, "package.json"),
      JSON.stringify({
        name: "fixture",
        version: "1.2.3",
        keywords: ["theme"],
      }),
    );
    const sentinel = join(f.root, "project-settings.json");
    await writeFile(sentinel, '{"packages":["npm:do-not-touch"]}');
    f.entries[0].installedPath = manifestDir;
    f.entries.push({
      source: "npm:missing",
      scope: "user",
      installedPath: join(f.agentDir, "missing"),
    });
    const installed = await f.service().listInstalled();
    expect(installed[0]).toMatchObject({
      version: "1.2.3",
      types: ["theme"],
      scope: "user",
    });
    expect(installed[1].name).toBe("missing");
    await f.service().operate({
      opId: "isolated",
      action: "update",
      source: "npm:fixture",
    });
    expect(await readFile(sentinel, "utf8")).toBe(
      '{"packages":["npm:do-not-touch"]}',
    );
  });
});

test("search cancels an oversized streaming response before parsing it", async () => {
  const f = await fixture();
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      controller.enqueue(new Uint8Array(1024 * 1024));
    },
    cancel() {
      cancelled = true;
    },
  });
  const service = f.service({ fetch: fakeFetch(() => new Response(stream)) });
  await expect(service.search({ query: "", page: 0 })).rejects.toThrow(
    "exceeds 5 MB",
  );
  expect(cancelled).toBe(true);
});
