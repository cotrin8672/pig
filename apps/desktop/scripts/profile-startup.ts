// Offline startup components, in fresh processes with disposable empty profiles.
// Does not start/restart pig, load user extensions/credentials, or measure native
// launcher/WebView startup. --bundle analyzes the current production UI in memory.
import { mkdtemp, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";

const childMode = process.argv
  .find((arg) => arg.startsWith("--child="))
  ?.slice(8);
const round = (value: number) => Math.round(value * 10) / 10;

async function profileChild(mode: string) {
  const home = process.env.PIG_STARTUP_PROFILE_HOME;
  if (
    !home ||
    resolve(homedir()) !== resolve(home) ||
    process.env.PI_CODING_AGENT_DIR !== join(home, "agent") ||
    process.env.PI_OFFLINE !== "1"
  )
    throw new Error("Refusing to profile without an isolated offline HOME");
  // Also reject accidental fetch calls by library initialization.
  const denyNetwork = () => {
    throw new Error("Network disabled in startup profile");
  };
  globalThis.fetch = Object.assign(denyNetwork, { preconnect: denyNetwork });
  const start = performance.now();
  const phases: { phase: string; ms: number }[] = [];
  async function measure<T>(phase: string, run: () => Promise<T>) {
    const before = performance.now();
    const value = await run();
    phases.push({ phase, ms: round(performance.now() - before) });
    return value;
  }
  let counts: Record<string, number> = {};
  if (mode === "staged") {
    await measure("sdk-wrapper-import", () => import("../src/bun/sdk"));
    const models = await measure(
      "model-module-import-after-sdk",
      () => import("../src/bun/model-runtime"),
    );
    const runtime = await measure("create-model-runtime", () =>
      models.createModelRuntime(),
    );
    const catalog = await measure(
      "user-catalog-module-import",
      () => import("../src/bun/user-catalog"),
    );
    const services = await measure("reload-empty-user-catalog", () =>
      catalog.reloadUserCatalog(runtime),
    );
    counts = {
      providers: runtime.getProviders().length,
      extensionErrors: services.resourceLoader.getExtensions().errors.length,
    };
    models.releaseModelRuntime(runtime);
  } else if (mode === "service") {
    const service = await measure(
      "pi-service-import-and-top-level-init",
      () => import("../src/bun/pi-service"),
    );
    const [providers, models, utilities] = await measure(
      "bootstrap-provider-model-utility-reads",
      () =>
        Promise.all([
          service.listProviders(),
          service.availableModels(),
          service.utilityModels(),
        ]),
    );
    const accountCatalogs = await measure("bootstrap-account-catalogs", () =>
      Promise.all(
        providers.flatMap((provider) =>
          (provider.accounts ?? []).map((account) =>
            account.configured
              ? service.accountModels(provider.id, account.id)
              : Promise.resolve([]),
          ),
        ),
      ),
    );
    counts = {
      providers: providers.length,
      availableModels: models.length,
      accounts: accountCatalogs.length,
      utilityModels:
        utilities.imageModels.length + utilities.classificationModels.length,
    };
    await service.disposeSessions();
  } else throw new Error("Unknown child mode");
  console.info(
    JSON.stringify({
      mode,
      bun: Bun.version,
      phases,
      totalMs: round(performance.now() - start),
      counts,
      scope: "fresh process, empty temporary profile, offline, no WebView",
    }),
  );
}

async function analyzeBundle() {
  const { build } = await import("vite");
  const result = await build({
    configFile: resolve(import.meta.dir, "../vite.config.ts"),
    root: resolve(import.meta.dir, "../src/mainview"),
    logLevel: "silent",
    build: { write: false, emptyOutDir: false, reportCompressedSize: false },
  });
  if ("on" in result) throw new Error("Unexpected Vite watch build");
  const outputs = (Array.isArray(result) ? result : [result]).flatMap(
    (entry) => entry.output,
  );
  const chunks = outputs.filter((entry) => entry.type === "chunk");
  const byName = new Map(chunks.map((chunk) => [chunk.fileName, chunk]));
  const initial = new Set<string>();
  const visit = (name: string) => {
    if (initial.has(name)) return;
    const chunk = byName.get(name);
    if (!chunk) return;
    initial.add(name);
    for (const dependency of chunk.imports) visit(dependency);
  };
  for (const chunk of chunks) if (chunk.isEntry) visit(chunk.fileName);
  const contributors = chunks
    .filter((chunk) => initial.has(chunk.fileName))
    .flatMap((chunk) =>
      Object.entries(chunk.modules).map(([id, module]) => ({
        id: id.replaceAll("\\", "/"),
        renderedBytes: module.renderedLength,
      })),
    )
    .sort((a, b) => b.renderedBytes - a.renderedBytes);
  console.info(
    JSON.stringify({
      scope: "current production build, in memory; sizes are not parse timings",
      chunks: chunks.map((chunk) => ({
        name: chunk.fileName,
        initial: initial.has(chunk.fileName),
        bytes: Buffer.byteLength(chunk.code),
        imports: chunk.imports,
        dynamicImports: chunk.dynamicImports,
      })),
      initialModuleCount: contributors.length,
      // Rollup renderedLength is before final chunk minification; not additive
      // with the minified byte size reported above.
      largestInitialModulesBeforeChunkMinification: contributors.slice(0, 20),
      initialFeatureModules: contributors
        .filter((module) =>
          /(?:mainview\/(?:Settings|Extensions|Providers|TerminalDialog|UIRequestBroker|ProviderIcon|PiLensRenderer)|@xterm\/|@babel\/parser|katex\/)/.test(
            module.id,
          ),
        )
        .map(({ id, renderedBytes }) => ({ id, renderedBytes })),
    }),
  );
}

if (childMode) {
  await profileChild(childMode);
  // Profiling owns this disposable process, not the running application.
  process.exit(0);
} else if (process.argv.includes("--bundle")) {
  await analyzeBundle();
} else {
  const repeats = Number(
    process.argv.find((arg) => arg.startsWith("--repeat="))?.slice(9) ?? 3,
  );
  if (!Number.isInteger(repeats) || repeats < 1 || repeats > 10)
    throw new Error("--repeat must be between 1 and 10");
  for (const mode of ["staged", "service"]) {
    for (let sample = 1; sample <= repeats; sample++) {
      const home = await mkdtemp(join(tmpdir(), "pig-startup-profile-"));
      try {
        // Deliberately do not inherit provider keys, SDK settings, or extension
        // environment. Windows/Bun need only these OS variables for this probe.
        const env: Record<string, string> = {
          HOME: home,
          USERPROFILE: home,
          APPDATA: join(home, "AppData/Roaming"),
          LOCALAPPDATA: join(home, "AppData/Local"),
          XDG_CONFIG_HOME: join(home, ".config"),
          XDG_CACHE_HOME: join(home, ".cache"),
          PI_CODING_AGENT_DIR: join(home, "agent"),
          PI_CODING_AGENT_SESSION_DIR: join(home, "sessions"),
          PI_OFFLINE: "1",
          PIG_STARTUP_PROFILE_HOME: home,
        };
        for (const key of [
          "PATH",
          "SystemRoot",
          "WINDIR",
          "ComSpec",
          "TEMP",
          "TMP",
        ])
          if (process.env[key]) env[key] = process.env[key];
        const start = performance.now();
        const child = Bun.spawn(
          [process.execPath, import.meta.path, `--child=${mode}`],
          {
            cwd: resolve(import.meta.dir, ".."),
            env,
            stdout: "pipe",
            stderr: "pipe",
          },
        );
        const [code, stdout, stderr] = await Promise.all([
          child.exited,
          new Response(child.stdout).text(),
          new Response(child.stderr).text(),
        ]);
        if (code !== 0) throw new Error(stdout + stderr);
        console.info(
          JSON.stringify({
            sample,
            processWallMs: round(performance.now() - start),
            result: JSON.parse(stdout.trim()),
          }),
        );
      } finally {
        await rm(home, { recursive: true, force: true });
      }
    }
  }
}
