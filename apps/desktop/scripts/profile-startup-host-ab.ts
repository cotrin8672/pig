// Measures real host initialization/RPC handlers with a native-window proxy.
// This deliberately does NOT measure launcher, WebView2 creation or native paint.
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { cpus, homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { BunPlugin } from "bun";
import type { Appearance, Bootstrap } from "../src/shared/rpc-schema";
import type { Settings } from "../src/shared/settings";

const option = (name: string) =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const childMode = option("child");
const round = (n: number) => Math.round(n * 10) / 10;
const desktop = resolve(import.meta.dir, "..");
const modes = [
  "current-bundle",
  "naive-local-import",
  "deferred-artifact",
] as const;
type Mode = (typeof modes)[number];
type HostProfile = {
  start: number;
  phases: Record<string, number>;
  windowCalls: number;
  accountMode: string;
  windowCallMs?: number;
};
type BootstrapRead = {
  pass: number;
  accountMode: string;
  handlerMs: number;
  stringifyMs: number;
  bytes: number;
  providers: number;
  models: number;
  catalogScopes: number;
};
type HostRow = {
  sample: number;
  processWallMs: number;
  mode: Mode;
  accounts: number;
  bun: string;
  windowCallMs: number;
  hostReadyMs: number;
  windowCalls: number;
  phases: Record<string, number>;
  shellReadMs: number;
  shellBytes: number;
  bootstrap: BootstrapRead[];
  heapUsed: number;
  rss: number;
  networkAttempts: number;
};
type ProfileGlobal = typeof globalThis & {
  __hostProfile: HostProfile;
  __hostMeasure: <T>(name: string, fn: () => Promise<T>) => Promise<T>;
  __hostRpc: {
    handlers: {
      requests: {
        bootstrap: () => Promise<Bootstrap>;
        settings: () => Promise<Settings>;
        appearance: () => Promise<Appearance>;
      };
    };
  };
  __hostDispose: () => Promise<void>;
};

async function child(mode: string) {
  const home = process.env.PIG_HOST_PROFILE_HOME;
  if (
    !home ||
    resolve(homedir()) !== resolve(home) ||
    process.env.PI_CODING_AGENT_DIR !== join(home, "agent") ||
    process.env.PI_OFFLINE !== "1"
  )
    throw Error("Refusing non-isolated host profile");
  let networkAttempts = 0;
  const deny = () => {
    networkAttempts++;
    throw Error("Network disabled in host profile");
  };
  globalThis.fetch = Object.assign(deny, { preconnect: deny });
  const count = Number(option("accounts") ?? 0);
  await mkdir(join(home, "agent"), { recursive: true });
  await mkdir(join(home, ".config/pig"), { recursive: true });
  const credential = {
    type: "oauth",
    refresh: "synthetic-not-a-token",
    access: "synthetic-not-a-token",
    expires: Date.now() + 86400000,
  };
  if (count) {
    await writeFile(
      join(home, "agent/auth.json"),
      JSON.stringify({ "openai-codex": credential }),
    );
    await writeFile(
      join(home, ".config/pig/provider-accounts.json"),
      JSON.stringify(
        Object.fromEntries(
          Array.from({ length: count }, (_, i) => [
            `fixture-${i}`,
            { provider: "openai-codex", label: `Fixture ${i}`, credential },
          ]),
        ),
      ),
    );
  }
  const state: HostProfile = {
    start: performance.now(),
    phases: {},
    windowCalls: 0,
    accountMode: "all",
  };
  const g = globalThis as ProfileGlobal;
  g.__hostProfile = state;
  g.__hostMeasure = async <T>(name: string, fn: () => Promise<T>) => {
    const before = performance.now();
    const value = await fn();
    state.phases[name] = performance.now() - before;
    return value;
  };
  await import(pathToFileURL(resolve(option("artifact") ?? "")).href);
  const hostReadyMs = performance.now() - state.start;
  const rpc = g.__hostRpc.handlers.requests;
  const bootstrap: BootstrapRead[] = [];
  for (let pass = 0; pass < 4; pass++) {
    const order = ["all", "none", "first"].map(
      (_, i) => ["all", "none", "first"][(i + pass) % 3],
    );
    for (const accountMode of order) {
      state.accountMode = accountMode;
      const before = performance.now();
      const value = await rpc.bootstrap();
      const handlerMs = performance.now() - before;
      const stringifyStart = performance.now();
      const json = JSON.stringify(value);
      const stringifyMs = performance.now() - stringifyStart;
      bootstrap.push({
        pass,
        accountMode,
        handlerMs: round(handlerMs),
        stringifyMs: round(stringifyMs),
        bytes: Buffer.byteLength(json),
        providers: value.providers.length,
        models: value.models.length,
        catalogScopes: Object.keys(value.accountCatalogs ?? {}).length,
      });
    }
  }
  const shellStart = performance.now();
  const settings = await rpc.settings();
  const appearance = await rpc.appearance();
  const shell = {
    settings,
    appearance,
    projects: [],
    generalCwd: join(home, ".config/pig/general"),
    desktop: JSON.parse(
      await readFile(join(home, ".config/pig/desktop.json"), "utf8").catch(
        () => '{"sessions":{}}',
      ),
    ),
  };
  const shellReadMs = performance.now() - shellStart;
  const shellBytes = Buffer.byteLength(JSON.stringify(shell));
  const memory = process.memoryUsage();
  await g.__hostDispose();
  if (state.windowCallMs === undefined || state.windowCalls !== 1)
    throw Error("Expected exactly one window proxy constructor call");
  if (networkAttempts)
    throw Error(`Unexpected network attempts: ${networkAttempts}`);
  console.info(
    "PROFILE_RESULT " +
      JSON.stringify({
        mode,
        accounts: count,
        bun: Bun.version,
        windowCallMs: round(state.windowCallMs),
        hostReadyMs: round(hostReadyMs),
        windowCalls: state.windowCalls,
        phases: state.phases,
        shellReadMs: round(shellReadMs),
        shellBytes,
        bootstrap,
        heapUsed: memory.heapUsed,
        rss: memory.rss,
        networkAttempts,
      }),
  );
  process.exit(0);
}

const nativeSource = `
const g=globalThis;
export class BrowserView{static defineRPC(config){g.__hostRpc=config;return {send:new Proxy({},{get:()=>()=>Promise.resolve()}),request:new Proxy({},{get:()=>async()=>{}})};}}
export class BrowserWindow{constructor(options){this.id=1;this.ptr=null;this.webview={on(){}};g.__hostProfile.windowCalls++;g.__hostProfile.windowCallMs??=performance.now()-g.__hostProfile.start;g.__hostWindow=this;}on(){}isMinimized(){return false;}isMaximized(){return false;}static getById(){return g.__hostWindow;}}
export const Updater={localInfo:{channel:async()=> 'stable'}};
export const Utils={paths:{userData:process.env.HOME+'/legacy',downloads:process.env.HOME+'/downloads'},quit(){},showNotification(){},openExternal(){return true;}};
export const ContextMenu={on(){},showContextMenu(){}};
export default {events:{on(){}}};
`;
function once(code: string, old: string, next: string) {
  if (code.split(old).length !== 2)
    throw Error(`Host transform changed: ${old}`);
  return code.replace(old, next);
}
async function compile(directory: string) {
  const artifacts: Record<
    string,
    { bytes: number; staticSdkImports: string[] }
  > = {};
  const mockPlugin: BunPlugin = {
    name: "host-profile-native-proxy",
    setup(builder) {
      builder.onResolve({ filter: /^electrobun\/bun$/ }, () => ({
        path: "native",
        namespace: "profile",
      }));
      builder.onLoad({ filter: /.*/, namespace: "profile" }, () => ({
        contents: nativeSource,
        loader: "js",
      }));
      builder.onLoad(
        { filter: /[\\/]src[\\/]bun[\\/]index\.ts$/ },
        async ({ path }: { path: string }) => {
          let code = await readFile(path, "utf8");
          code = once(
            code,
            "const window: BrowserWindow = new BrowserWindow({",
            "const window: BrowserWindow = globalThis.__hostWindow ?? new BrowserWindow({",
          );
          code = once(
            code,
            "(provider.accounts ?? []).map(",
            '(provider.accounts ?? []).filter((_,index)=>globalThis.__hostProfile.accountMode==="all"||(globalThis.__hostProfile.accountMode==="first"&&index===0)).map(',
          );
          return {
            contents:
              code +
              "\nglobalThis.__hostDispose=async()=>{dispose();await disposeSessions();};",
            loader: "ts",
          };
        },
      );
      builder.onLoad(
        { filter: /[\\/]src[\\/]bun[\\/]pi-service\.ts$/ },
        async ({ path }: { path: string }) => {
          let code = await readFile(path, "utf8");
          code = once(
            code,
            "export const runtime = await createModelRuntime();",
            'export const runtime = await globalThis.__hostMeasure("createModelRuntime",()=>createModelRuntime());',
          );
          code = once(
            code,
            "await refreshUserCatalog()",
            'await globalThis.__hostMeasure("userCatalog",()=>refreshUserCatalog())',
          );
          return { contents: code, loader: "ts" };
        },
      );
    },
  };
  const wrapper = (deferred: boolean) => `
import {BrowserWindow,Utils} from 'electrobun/bun';
import {prepareDesktopConfig,desktopConfigDir} from ${JSON.stringify(join(desktop, "src/bun/desktop-config.ts"))};
import {loadSettings} from ${JSON.stringify(join(desktop, "src/bun/settings.ts"))};
import {loadAppearance} from ${JSON.stringify(join(desktop, "src/bun/appearance.ts"))};
import {DesktopStateStore} from ${JSON.stringify(join(desktop, "src/bun/desktop-state.ts"))};
import {ModelPreferences} from ${JSON.stringify(join(desktop, "src/bun/model-preferences.ts"))};
import {readFile} from 'node:fs/promises';import {join} from 'node:path';
await prepareDesktopConfig(Utils.paths.userData);
const metaStart=performance.now();
const desktopState=new DesktopStateStore(join(desktopConfigDir,'desktop.json'),()=>{});
const prefs=new ModelPreferences(join(desktopConfigDir,'disabled-models.json'));
await Promise.all([desktopState.load(),prefs.load(),loadSettings(join(desktopConfigDir,'settings.json')),loadAppearance(join(desktopConfigDir,'appearance.json')),readFile(join(desktopConfigDir,'projects.json'),'utf8').catch(()=> '[]')]);
globalThis.__hostProfile.phases.shellMetadata=performance.now()-metaStart;
new BrowserWindow({});
${deferred ? 'await import(new URL("./current-bundle.js",import.meta.url).href);' : `await import(${JSON.stringify(join(desktop, "src/bun/index.ts"))});`}
`;
  for (const mode of modes) {
    const entry =
      mode === "current-bundle"
        ? join(desktop, "src/bun/index.ts")
        : "profile-entry";
    const result = await Bun.build({
      entrypoints: [entry],
      target: "bun",
      format: "esm",
      splitting: false,
      external: [
        "@earendil-works/pi-ai",
        "@earendil-works/pi-ai/*",
        "@earendil-works/pi-coding-agent",
        "@earendil-works/pi-coding-agent/*",
        "@earendil-works/pi-tui",
        "@earendil-works/pi-tui/*",
      ],
      plugins: [
        mockPlugin,
        {
          name: "profile-wrapper",
          setup(b) {
            b.onResolve({ filter: /^profile-entry$/ }, () => ({
              path: "entry",
              namespace: "wrapper",
            }));
            b.onLoad({ filter: /.*/, namespace: "wrapper" }, () => ({
              contents: wrapper(mode === "deferred-artifact"),
              loader: "ts",
              resolveDir: desktop,
            }));
          },
        },
      ],
    });
    if (!result.success) throw Error(result.logs.map(String).join("\n"));
    if (result.outputs.length !== 1)
      throw Error("Expected a single host artifact");
    const code = await result.outputs[0].text();
    artifacts[mode] = {
      bytes: Buffer.byteLength(code),
      staticSdkImports: new Bun.Transpiler({ loader: "js" })
        .scan(code)
        .imports.filter(
          (item) =>
            item.kind !== "dynamic-import" &&
            item.path.startsWith("@earendil-works/pi-"),
        )
        .map((item) => item.path),
    };
    await Bun.write(join(directory, `${mode}.js`), code);
  }
  return artifacts;
}

if (childMode) {
  await child(childMode);
} else {
  const samples = Number(option("samples") ?? 5);
  if (!Number.isInteger(samples) || samples < 1 || samples > 20)
    throw Error("Invalid samples");
  const accounts = (option("accounts") ?? "0,2,10").split(",").map(Number);
  if (accounts.some((n) => !Number.isInteger(n) || n < 0 || n > 50))
    throw Error("Invalid account counts");
  const selectedBun = option("bun");
  const binary = selectedBun ? resolve(selectedBun) : process.execPath;
  const only = option("only")?.split(",");
  const variants = modes.filter((m) => !only || only.includes(m));
  if (!variants.length) throw Error("No profiling variants selected");
  const directory = await mkdtemp(join(tmpdir(), "pig-host-ab-artifacts-"));
  const rows: HostRow[] = [];
  let artifacts: Awaited<ReturnType<typeof compile>> = {};
  try {
    // Explicitly share the workspace's dependency layout, not user configuration.
    // This is not the relocated-package release validation suite.
    await symlink(
      join(desktop, "node_modules"),
      join(directory, "node_modules"),
      process.platform === "win32" ? "junction" : "dir",
    );
    artifacts = await compile(directory);
    for (let sample = 0; sample < samples; sample++)
      for (const count of accounts) {
        const order = variants.map(
          (_, i) => variants[(i + sample) % variants.length],
        );
        for (const mode of order) {
          const home = await mkdtemp(join(tmpdir(), "pig-host-ab-home-"));
          try {
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
              PIG_HOST_PROFILE_HOME: home,
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
            const processStart = performance.now();
            const proc = Bun.spawn(
              [
                binary,
                "--no-install",
                import.meta.path,
                `--child=${mode}`,
                `--artifact=${join(directory, `${mode}.js`)}`,
                `--accounts=${count}`,
              ],
              { cwd: directory, env, stdout: "pipe", stderr: "pipe" },
            );
            const timeout = setTimeout(() => proc.kill(), 30000);
            const [code, out, error] = await Promise.all([
              proc.exited,
              new Response(proc.stdout).text(),
              new Response(proc.stderr).text(),
            ]);
            clearTimeout(timeout);
            if (code !== 0) throw Error(out + error);
            const line = out
              .split(/\r?\n/)
              .find((line) => line.startsWith("PROFILE_RESULT "));
            if (!line) throw Error(`Missing host result: ${out}${error}`);
            const row: HostRow = {
              sample: sample + 1,
              processWallMs: round(performance.now() - processStart),
              ...JSON.parse(line.slice(15)),
            };
            rows.push(row);
            console.error(JSON.stringify(row));
          } finally {
            await rm(home, { recursive: true, force: true });
          }
        }
      }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
  function stats(values: number[]) {
    if (!values.length || values.some((value) => !Number.isFinite(value)))
      throw Error("Missing or non-finite profile metric");
    const sorted = [...values].sort((a, b) => a - b);
    return {
      median: round(sorted[Math.floor(sorted.length / 2)]),
      min: round(sorted[0]),
      max: round(sorted.at(-1) ?? 0),
    };
  }
  const summary = Object.fromEntries(
    accounts.map((count) => [
      count,
      Object.fromEntries(
        variants.map((mode) => {
          const data = rows.filter(
            (r) => r.accounts === count && r.mode === mode,
          );
          return [
            mode,
            {
              windowCallMs: stats(data.map((r) => r.windowCallMs)),
              hostReadyMs: stats(data.map((r) => r.hostReadyMs)),
              shellReadMs: stats(data.map((r) => r.shellReadMs)),
              shellBytes: data[0]?.shellBytes,
              heapUsed: stats(data.map((r) => r.heapUsed)),
              bootstrap: Object.fromEntries(
                ["all", "none", "first"].map((scope) => {
                  const reads = data
                    .flatMap((r) => r.bootstrap)
                    .filter((r) => r.accountMode === scope);
                  return [
                    scope,
                    {
                      handlerMs: stats(reads.map((r) => r.handlerMs)),
                      stringifyMs: stats(reads.map((r) => r.stringifyMs)),
                      bytes: stats(reads.map((r) => r.bytes)),
                      models: reads[0]?.models,
                      catalogScopes: reads[0]?.catalogScopes,
                    },
                  ];
                }),
              ),
            },
          ];
        }),
      ),
    ]),
  );
  const report = {
    scope:
      "Actual index.ts and bootstrap handlers, native Electrobun calls replaced with a proxy. Offline fresh subprocesses and synthetic credentials. Deferred wrapper is a scheduling prototype, NOT a production service-lifecycle implementation. Workspace dependency layout; no launcher/WebView2/paint timing.",
    samples,
    environment: {
      builderBun: Bun.version,
      childBinary: binary.split(/[\\/]/).at(-1),
      cpu: cpus()[0]?.model,
      logicalCpus: cpus().length,
    },
    artifacts,
    summary,
    raw: rows,
  };
  const reportFile = option("report");
  if (reportFile)
    await Bun.write(reportFile, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
}
