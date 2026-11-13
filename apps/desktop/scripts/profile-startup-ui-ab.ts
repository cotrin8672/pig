// Experimental A/B builds only: source transforms happen in Vite's in-memory
// graph. Production sources, dist, the running app and its profile stay intact.
import { existsSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { cpus, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { build, type Plugin } from "vite";
import { defaultAppearance } from "../src/shared/appearance";
import { defaultSettings } from "../src/shared/settings";
import { fixtureBrowser, removeFixtureDirectory } from "./ui-browser";

const root = resolve(import.meta.dir, "../src/mainview");
const source = (name: string) =>
  JSON.stringify(`${root}/${name}`.replaceAll("\\", "/"));
const browserBinary =
  process.env.PIG_UI_BROWSER ??
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const samples = Number(
  process.argv.find((v) => v.startsWith("--samples="))?.slice(10) ?? 7,
);
const only = process.argv
  .find((v) => v.startsWith("--only="))
  ?.slice(7)
  .split(",");
const reportFile = process.argv
  .find((v) => v.startsWith("--report="))
  ?.slice(9);
const cpuRate = Number(
  process.argv.find((v) => v.startsWith("--cpu-rate="))?.slice(11) ?? 1,
);
if (!Number.isFinite(cpuRate) || cpuRate < 1 || cpuRate > 8)
  throw Error("Invalid CPU rate");
const names = [
  "baseline",
  "pages",
  "terminal",
  "markdown",
  "all",
  "pages-managed",
  "terminal-managed",
  "all-managed",
] as const;
type Variant = (typeof names)[number];
if (!Number.isInteger(samples) || samples < 1 || samples > 30)
  throw Error("Invalid --samples");
if (!existsSync(browserBinary))
  throw Error("A real Edge/Chromium browser is required");
const variants = names.filter((name) => !only || only.includes(name));
if (!variants.length) throw Error("No profiling variants selected");
const cpuProfilePrefix = process.argv
  .find((v) => v.startsWith("--cpu-profile-prefix="))
  ?.slice(21);
const round = (n: number) => Math.round(n * 10) / 10;

function once(code: string, old: string, replacement: string) {
  if (code.split(old).length !== 2)
    throw Error(`Profile transform no longer matches: ${old.slice(0, 100)}`);
  return code.replace(old, replacement);
}

const models = Array.from({ length: 40 }, (_, i) => ({
  provider: "openai-codex",
  id: `fixture-${i}`,
  name: `Fixture model ${i}`,
  contextWindow: 128000,
  maxTokens: 8192,
  reasoning: true,
  vision: true,
  effortLevels: ["low", "high"],
  thinkingLevels: ["low", "high"],
  effectiveDefaultEffort: "low",
}));
const provider = {
  id: "openai-codex",
  name: "OpenAI Codex",
  configured: true,
  stored: true,
  source: "OAuth",
  apiKey: false,
  extension: false,
  oauth: { subscription: true },
  accounts: ["work", "personal"].map((id) => ({
    id,
    provider: "openai-codex",
    label: id,
    configured: true,
  })),
};
const payload = {
  settings: { ...defaultSettings, language: "en" },
  appearance: defaultAppearance,
  bootstrap: {
    generalCwd: "profile-general",
    projects: [],
    providers: [provider],
    models,
    accountCatalogs: {} as Record<string, typeof models>,
    imageModels: [],
    classificationModels: [],
    classificationProviders: [],
    defaultModel: null,
    disabledModels: [],
    modelOverrides: {},
    desktop: { sessions: {} },
  },
};
// Match the application's account key contract rather than inventing aliases.
const { accountSourceKey } = await import("../src/shared/account-models");
payload.bootstrap.accountCatalogs = Object.fromEntries([
  [accountSourceKey(provider.id), models],
  ...provider.accounts.map((account) => [
    accountSourceKey(provider.id, account.id),
    models,
  ]),
]);

const electroview = `
const clone=value=>JSON.parse(JSON.stringify(value));
export class Electroview {
  constructor(){}
  static defineRPC(config){
    const handlers=config.handlers;
    return {send:new Proxy({}, {get:()=>()=>{}}),request:new Proxy({}, {get:(_target,key)=>async(params)=>{
      const p=globalThis.__profilePayload;
      if(key==='bootstrap'||key==='settings'||key==='appearance')return clone(p[key]);
      if(key==='runtimeState')return {hostId:'profile-host',sessions:[],pendingUI:[],drafts:[],statuses:[],retainedDrafts:[],sendIntents:[]};
      if(key==='heartbeatUI')return {connected:true};
      if(key==='getChatRendererBundle')return {file:'fixture',source:null};
      if(['listSessions','providerUsage','listInstalled','listFontFamilies'].includes(key))return [];
      if(key==='getAppUpdate')return {version:'fixture',method:'disabled',status:'idle',reason:'development'};
      if(key==='getPiData')return {current:{},legacy:{},auth:[],sessions:[]};
      if(key==='setUiPreferences')return;
      if(key==='terminalCommand'){if(params.type==='ready')globalThis.__profileTerminalReady=true;return;}
      if(key==='flushDrafts')return handlers.requests.flushDrafts();
      throw Error('Unexpected profiling RPC: '+String(key));
    }})};
  }
}
`;

const controls = `
import {createRoot} from 'react-dom/client';
import {createElement} from 'react';
import {useStore} from ${source("store.ts")};
import {navigate} from ${source("navigation.ts")};
const frame=()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
const until=async(fn)=>{const end=performance.now()+10000;while(!fn()){if(performance.now()>end)throw Error('Profile action timed out');await new Promise(r=>setTimeout(r,5));}};
const results=globalThis.__profileResults={themeMs:[],errors:[]};
useStore.subscribe((state,old)=>{if(state.initialized&&!old.initialized)frame().then(()=>{results.readyFrameMs=performance.now();});});
const observer=new MutationObserver(()=>{if(document.querySelector('.app-shell')){observer.disconnect();frame().then(()=>{results.shellFrameMs=performance.now();});}});
observer.observe(document,{childList:true,subtree:true});
let probe;
function probeRoot(){probe?.unmount();const element=document.createElement('div');element.className='profile-probe';document.body.append(element);probe=createRoot(element);return probe;}
globalThis.__profileActions={
  async page(name){const start=performance.now();navigate(name);await until(()=>document.querySelector('.'+name+'-page'));await frame();const first=performance.now()-start;navigate('chat');await frame();return first;},
  async terminal(){const start=performance.now();globalThis.__profileTerminalReady=false;const address={hostId:'profile-host',sessionId:'fixture-terminal',epoch:1,uiId:'terminal'};const request={...address,kind:'terminal',title:'Profile'};const key=JSON.stringify([address.hostId,address.sessionId,address.epoch,address.uiId]);useStore.setState(s=>({active:address.sessionId,page:'chat',addresses:{...s.addresses,[address.sessionId]:address},pendingUI:[request],terminals:{[key]:{...address,type:'open',title:'Profile'}}}));await until(()=>globalThis.__profileTerminalReady);await frame();const elapsed=performance.now()-start;useStore.setState({active:undefined,pendingUI:[],terminals:{}});await frame();return elapsed;},
  async math(fallback=false){const start=performance.now();const Worker=window.Worker;if(fallback)window.Worker=undefined;try{const {BuiltinMarkdown}=await import(${source("MessageContent.tsx")});const root=probeRoot();root.render(createElement(BuiltinMarkdown,{data:{text:(fallback?'$$ x^3 + y^3 = z^3 $$\\n\\n':'$$ x^2 + y^2 = z^2 $$\\n\\n').repeat(10)}}));await until(()=>document.querySelectorAll('.profile-probe .katex').length>=10);await frame();const elapsed=performance.now()-start;root.unmount();probe=undefined;document.querySelectorAll('.profile-probe').forEach(n=>n.remove());return elapsed;}finally{window.Worker=Worker;}}
};
`;

function profilePlugin(variant: Variant): Plugin {
  const managed = variant.endsWith("-managed");
  const base = variant.replace("-managed", "");
  const pages = base === "pages" || base === "all";
  const terminal = base === "terminal" || base === "all";
  const markdown = base === "markdown" || base === "all";
  return {
    name: "startup-ab-experiment",
    enforce: "pre",
    resolveId(id) {
      if (id.startsWith("virtual:startup-profile-")) return `\0${id}`;
      if (id === "electrobun/view")
        return "\0virtual:startup-profile-electroview";
    },
    load(id) {
      if (
        id === "\0virtual:startup-profile-electroview" ||
        id.replaceAll("\\", "/").endsWith("/.hutch/devkit/api/browser/index.ts")
      )
        return electroview;
      if (id === "\0virtual:startup-profile-controls") return controls;
      if (id === "\0virtual:startup-profile-managed")
        return `
import {createElement,useEffect,useState} from 'react';
export function deferred(load,fallback=()=>null){let cached,pending;return function Deferred(props){const [Component,setComponent]=useState(()=>cached);const [error,setError]=useState();useEffect(()=>{let live=true;if(cached){setComponent(()=>cached);}else{pending??=load().then(value=>(cached=value));pending.then(value=>{if(live)setComponent(()=>value)},error=>{if(live)setError(error)});}return()=>{live=false}},[]);if(error)throw error;return Component?createElement(Component,props):fallback(props);};}`;
      if (id === "\0virtual:startup-profile-fallback")
        return `
globalThis.__profileFallbackLoaded=true;
import ReactMarkdown,{defaultUrlTransform} from 'react-markdown';
import rehypeKatex from 'rehype-katex';import remarkGfm from 'remark-gfm';import remarkMath from 'remark-math';
import {sessionIdFromLink} from ${source("../shared/session-links.ts")};
import {createElement} from 'react';
export default function Source({source,components}){return createElement(ReactMarkdown,{remarkPlugins:[remarkGfm,remarkMath],rehypePlugins:[[rehypeKatex,{throwOnError:false}]],urlTransform:url=>sessionIdFromLink(url)?url:defaultUrlTransform(url),components},source);}`;
    },
    transform(code, id) {
      const path = id.replaceAll("\\", "/").split("?")[0];
      if (path.endsWith("/mainview/main.tsx"))
        return `import 'virtual:startup-profile-controls';\n${code}`;
      if (path.endsWith("/mainview/dynamic-theme.ts"))
        return once(
          code,
          "  const tokens = createThemeTokens(seed);",
          "  const start = performance.now();\n  const tokens = createThemeTokens(seed);\n  globalThis.__profileResults?.themeMs.push(performance.now()-start);",
        );
      if (pages && path.endsWith("/mainview/App.tsx")) {
        code = `${managed ? "import {deferred} from 'virtual:startup-profile-managed';" : "import {lazy,Suspense} from 'react';"}\n${code}`;
        for (const name of ["Settings", "Providers", "Extensions"]) {
          code = once(
            code,
            `import { ${name} } from "./${name}";`,
            managed
              ? `const ${name} = deferred(()=>import('./${name}').then(module=>module.${name}));`
              : `const ${name} = lazy(()=>import('./${name}').then(module=>({default:module.${name}})));`,
          );
          if (!managed)
            code = once(
              code,
              `<${name} />`,
              `<Suspense fallback={null}><${name} /></Suspense>`,
            );
        }
        return code;
      }
      if (terminal && path.endsWith("/mainview/UIRequestBroker.tsx"))
        return once(
          code,
          'import { TerminalDialog } from "./TerminalDialog";',
          managed
            ? `import {deferred} from 'virtual:startup-profile-managed';\nconst TerminalDialog=deferred(()=>import('./TerminalDialog').then(module=>module.TerminalDialog));`
            : `import {lazy,Suspense,createElement} from 'react';\nconst LazyTerminal = lazy(()=>import('./TerminalDialog').then(module=>({default:module.TerminalDialog})));\nfunction TerminalDialog(props){return createElement(Suspense,{fallback:null},createElement(LazyTerminal,props));}`,
        );
      if (markdown && path.endsWith("/mainview/MessageContent.tsx")) {
        for (const line of [
          'import rehypeKatex from "rehype-katex";\n',
          'import remarkGfm from "remark-gfm";\n',
          'import remarkMath from "remark-math";\n',
        ])
          code = once(code, line, "");
        const start = code.indexOf(
          "  return (\n    <ReactMarkdown\n      remarkPlugins=",
        );
        const end = code.indexOf("\ntype Content =", start);
        if (start < 0 || end < 0)
          throw Error("Markdown fallback boundary changed");
        code =
          code.slice(0, start) +
          (managed
            ? `  return <SourceFallback source={source} components={markdownComponents}/>;\n}\n`
            : `  return <Suspense fallback={<span className="markdown-pending-source">{source}</span>}><SourceFallback source={source} components={markdownComponents}/></Suspense>;\n}\n`) +
          code.slice(end);
        return managed
          ? `import {createElement} from 'react';\nimport {deferred} from 'virtual:startup-profile-managed';\nconst SourceFallback=deferred(()=>import('virtual:startup-profile-fallback').then(module=>module.default),props=>createElement('span',{className:'markdown-pending-source'},props.source));\n${code}`
          : `import {lazy,Suspense} from 'react';\nconst SourceFallback=lazy(()=>import('virtual:startup-profile-fallback'));\n${code}`;
      }
    },
    transformIndexHtml: {
      order: "pre",
      handler(html) {
        return html.replace(
          "<head>",
          `<head><script>globalThis.__profilePayload=${JSON.stringify(payload)};globalThis.__profilePageErrors=[];addEventListener('error',e=>__profilePageErrors.push(e.message));addEventListener('unhandledrejection',e=>__profilePageErrors.push(String(e.reason)));</script>`,
        );
      },
    },
  };
}

type Built = {
  files: Map<string, { body: string | Uint8Array; type: string }>;
  bytes: number;
  modules: number;
  initialFeatures: string[];
  workerChunk: string;
  engineChunk: string;
};
async function compile(variant: Variant): Promise<Built> {
  const result = await build({
    configFile: resolve(import.meta.dir, "../vite.config.ts"),
    root,
    logLevel: "silent",
    plugins: [profilePlugin(variant)],
    build: { write: false, emptyOutDir: false, reportCompressedSize: false },
  });
  if ("on" in result) throw Error("Unexpected watch output");
  const output = (Array.isArray(result) ? result : [result]).flatMap(
    (r) => r.output,
  );
  const files: Built["files"] = new Map();
  for (const file of output) {
    const type = file.fileName.endsWith(".js")
      ? "text/javascript"
      : file.fileName.endsWith(".css")
        ? "text/css"
        : file.fileName.endsWith(".html")
          ? "text/html"
          : "application/octet-stream";
    files.set(`/${file.fileName}`, {
      body: file.type === "chunk" ? file.code : file.source,
      type,
    });
  }
  const chunks = output.filter((o) => o.type === "chunk");
  const byName = new Map(chunks.map((c) => [c.fileName, c]));
  const chunkFor = (name: string) => {
    const chunk = chunks.find((c) =>
      Object.keys(c.modules).some((id) =>
        id.replaceAll("\\", "/").endsWith(`/${name}`),
      ),
    );
    if (!chunk) throw Error(`Missing chunk for ${name}`);
    return `/${chunk.fileName}`;
  };
  const initial = new Set<string>();
  function visit(name: string) {
    if (initial.has(name)) return;
    const chunk = byName.get(name);
    if (!chunk) return;
    initial.add(name);
    chunk.imports.forEach(visit);
  }
  chunks
    .filter((c) => c.isEntry)
    .forEach((c) => {
      visit(c.fileName);
    });
  const modules = chunks
    .filter((c) => initial.has(c.fileName))
    .flatMap((c) => Object.keys(c.modules));
  return {
    files,
    workerChunk: chunkFor("markdown-worker-client.ts"),
    engineChunk: chunkFor("markdown-engine.ts"),
    bytes: chunks
      .filter((c) => initial.has(c.fileName))
      .reduce((n, c) => n + Buffer.byteLength(c.code), 0),
    modules: modules.length,
    initialFeatures: modules
      .filter((id) =>
        /katex\/dist\/katex|@xterm.*\/lib\/xterm|mainview\/(Settings|Providers|Extensions)\.tsx/.test(
          id,
        ),
      )
      .map(
        (id) => id.replaceAll("\\", "/").split("/node_modules/").at(-1) ?? id,
      ),
  };
}

const builds = new Map<Variant, Built>();
for (const name of variants) {
  console.error(`Building UI variant: ${name}`);
  builds.set(name, await compile(name));
}
let current = variants[0];
const transfers: { path: string; bytes: number }[] = [];
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch(request) {
    const path = new URL(request.url).pathname;
    const file = builds
      .get(current)
      ?.files.get(path === "/" ? "/index.html" : path);
    if (!file) return new Response("Not found", { status: 404 });
    transfers.push({
      path,
      bytes:
        typeof file.body === "string"
          ? Buffer.byteLength(file.body)
          : file.body.byteLength,
    });
    return new Response(
      typeof file.body === "string" ? file.body : new Uint8Array(file.body),
      {
        headers: { "content-type": file.type, "cache-control": "no-store" },
      },
    );
  },
});
Bun.gc(true);
const raw: Record<string, unknown>[] = [];
let browserVersion = "";
try {
  for (let sample = 0; sample < samples; sample++) {
    // Rotate the order instead of giving the baseline all the cold file-cache runs.
    const order = variants.map(
      (_, i) => variants[(i + sample) % variants.length],
    );
    for (const name of order) {
      current = name;
      Bun.gc(true);
      const directory = await mkdtemp(join(tmpdir(), "pig-startup-ui-ab-"));
      const browser = await fixtureBrowser(
        browserBinary,
        directory,
        "about:blank",
      );
      try {
        const version = await browser.command<{
          product: string;
          jsVersion: string;
        }>("Browser.getVersion");
        browserVersion = `${version.product}; V8 ${version.jsVersion}`;
        await browser.command("Emulation.setDeviceMetricsOverride", {
          width: 1280,
          height: 840,
          deviceScaleFactor: 1,
          mobile: false,
        });
        await browser.command("Network.enable");
        await browser.command("Network.setCacheDisabled", {
          cacheDisabled: true,
        });
        await browser.command("Performance.enable");
        await browser.command("Emulation.setCPUThrottlingRate", {
          rate: cpuRate,
        });
        transfers.length = 0;
        if (cpuProfilePrefix) {
          await browser.command("Profiler.enable");
          await browser.command("Profiler.setSamplingInterval", {
            interval: 1000,
          });
          await browser.command("Profiler.start");
        }
        await browser.command("Page.navigate", { url: server.url.href });
        let state: Record<string, unknown> = {};
        for (let i = 0; i < 500; i++) {
          state = await browser.evaluate(
            `({ready:globalThis.__profileResults?.readyFrameMs,fcp:performance.getEntriesByName('first-contentful-paint')[0]?.startTime,errors:globalThis.__profilePageErrors??[]})`,
          );
          if (state.ready && state.fcp) break;
          await Bun.sleep(20);
        }
        if (!state.ready || !state.fcp)
          throw Error(`UI did not initialize: ${JSON.stringify(state)}`);
        const startup = await browser.evaluate<Record<string, unknown>>(
          `({...__profileResults,themeCostMs:__profileResults.themeMs.reduce((a,b)=>a+b,0),fcpMs:performance.getEntriesByName('first-contentful-paint')[0]?.startTime,heapUsed:performance.memory?.usedJSHeapSize,htmlResponseEndMs:performance.getEntriesByType('navigation')[0]?.responseEnd,mainScriptResponseEndMs:performance.getEntriesByType('resource').find(r=>r.name.includes('/assets/index-')&&r.name.endsWith('.js'))?.responseEnd})`,
        );
        const performanceMetrics = await browser.command<{
          metrics: { name: string; value: number }[];
        }>("Performance.getMetrics");
        const metric = Object.fromEntries(
          performanceMetrics.metrics.map((m) => [m.name, m.value]),
        );
        Object.assign(startup, {
          scriptDurationMs: metric.ScriptDuration * 1000,
          taskDurationMs: metric.TaskDuration * 1000,
          layoutDurationMs: metric.LayoutDuration * 1000,
          cdpHeapUsed: metric.JSHeapUsedSize,
        });
        startup.readyAfterHtmlMs =
          Number(startup.readyFrameMs) - Number(startup.htmlResponseEndMs);
        startup.fcpAfterHtmlMs =
          Number(startup.fcpMs) - Number(startup.htmlResponseEndMs);
        const startupTransfers = [...transfers];
        if (cpuProfilePrefix) {
          const { profile } = await browser.command<{ profile: unknown }>(
            "Profiler.stop",
          );
          await Bun.write(
            `${cpuProfilePrefix}-${name}-${sample + 1}.cpuprofile`,
            JSON.stringify(profile),
          );
        }
        const actions: Record<string, number> = {};
        for (const page of ["settings", "providers", "extensions"]) {
          actions[`${page}FirstMs`] = await browser.evaluate(
            `__profileActions.page(${JSON.stringify(page)})`,
          );
          actions[`${page}WarmMs`] = await browser.evaluate(
            `__profileActions.page(${JSON.stringify(page)})`,
          );
        }
        actions.terminalFirstMs = await browser.evaluate(
          "__profileActions.terminal()",
        );
        actions.mathWorkerFirstMs = await browser.evaluate(
          "__profileActions.math(false)",
        );
        const build = builds.get(name);
        if (!build) throw Error("Missing built variant");
        const markdownWorkerStats = await browser.evaluate<{
          completed: number;
          failed: boolean;
        }>(
          `import(${JSON.stringify(build.workerChunk)}).then(module=>Object.values(module).find(value=>typeof value?.stats==='function')?.stats())`,
        );
        if (
          !markdownWorkerStats?.completed ||
          markdownWorkerStats.failed ||
          transfers.some((t) => t.path === build.engineChunk)
        )
          throw Error("Worker probe silently used a main-thread fallback");
        actions.mathFallbackFirstMs = await browser.evaluate(
          "__profileActions.math(true)",
        );
        const fallbackLoaded = await browser.evaluate<boolean>(
          "!!globalThis.__profileFallbackLoaded",
        );
        if (
          (name === "markdown" || name === "all" || name === "all-managed") &&
          !fallbackLoaded
        )
          throw Error("Fallback probe did not load the separated engine");
        const errors = await browser.evaluate<string[]>(
          "[...__profilePageErrors,...__profileResults.errors]",
        );
        if (errors.length) throw Error(JSON.stringify(errors));
        const row = {
          variant: name,
          sample: sample + 1,
          ...startup,
          ...actions,
          markdownWorkerStats,
          initialJsBytes: builds.get(name)?.bytes,
          initialModuleCount: builds.get(name)?.modules,
          startupTransferBytes: startupTransfers.reduce(
            (n, f) => n + f.bytes,
            0,
          ),
          startupFiles: startupTransfers.map((f) => f.path),
        };
        raw.push(row);
        console.error(JSON.stringify(row));
      } finally {
        await browser.close();
        await removeFixtureDirectory(directory);
      }
    }
  }
} finally {
  server.stop(true);
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
const metrics = [
  "fcpMs",
  "shellFrameMs",
  "readyFrameMs",
  "settingsFirstMs",
  "settingsWarmMs",
  "providersFirstMs",
  "extensionsFirstMs",
  "terminalFirstMs",
  "mathWorkerFirstMs",
  "mathFallbackFirstMs",
  "heapUsed",
  "scriptDurationMs",
  "taskDurationMs",
  "layoutDurationMs",
  "themeCostMs",
  "htmlResponseEndMs",
  "mainScriptResponseEndMs",
  "readyAfterHtmlMs",
  "fcpAfterHtmlMs",
];
const summary = Object.fromEntries(
  variants.map((name) => {
    const rows = raw.filter((r) => r.variant === name);
    return [
      name,
      {
        initialJsBytes: builds.get(name)?.bytes,
        initialModuleCount: builds.get(name)?.modules,
        initialFeatures: builds.get(name)?.initialFeatures,
        ...Object.fromEntries(
          metrics.map((key) => [key, stats(rows.map((r) => Number(r[key])))]),
        ),
      },
    ];
  }),
);
const report = {
  scope:
    "Real App and RPC controller in headless Edge over HTTP; synthetic 40-model/2-account payload, no Electrobun native startup or real network/credentials. Source changes are experimental build transforms, not production-ready implementations.",
  samples,
  environment: {
    bun: Bun.version,
    cpuRate,
    cpuProfileCaptured: !!cpuProfilePrefix,
    sourceRevision: Bun.spawnSync(["git", "rev-parse", "HEAD"], { cwd: root })
      .stdout.toString()
      .trim(),
    browserVersion,
    cpu: cpus()[0]?.model,
    logicalCpus: cpus().length,
  },
  summary,
  raw,
};
if (reportFile)
  await Bun.write(reportFile, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
