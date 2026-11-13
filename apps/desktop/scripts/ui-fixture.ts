import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import { build } from "vite";
import { renderWorkerFixturePlugin } from "./render-worker-fixture";
import { fixtureBrowser } from "./ui-browser";

export const fixtureEdge =
  process.env.PIG_UI_BROWSER ??
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";

/** Absolute import specifier for a module, for generated fixture sources. */
export const fixtureImport = (url: URL | string) =>
  JSON.stringify(fileURLToPath(url));

/**
 * `./rpc` replacement: requests are answered by `window.__requests[method]`
 * (default `{}`), messages are dropped, and app-level helpers are no-ops.
 */
const rpcStub = `
const noop=()=>{};export const rpc={request:new Proxy({},{get:(_,method)=>async params=>window.__requests?.[method]?window.__requests[method](params):{}}),send:new Proxy({},{get:()=>noop})};
export const sends={subscribe:()=>noop,getTick:()=>0,read:()=>undefined,optimistic:()=>[],queued:()=>[],retained:()=>[],send:async()=>{}};
export const updateAppearance=noop,updateSettings=noop,updateUiPreferences=noop,refreshSessions=noop,refresh=()=>Promise.resolve(),requestSelection=(_address,request)=>request(),connectRuntime=noop,initRuntimeConnection=noop,cancelOpening=noop,openChat=noop,showPendingOpen=noop,openChatLink=noop,forkChat=noop,regenerate=noop,initSessionLinks=noop,initSessionReadTracking=noop,reconnectRuntime=noop;
`;

/**
 * Builds `source` (TSX run in the page) with the app's CSS, opens it in
 * headless Edge and waits for `window.__fixture` to become "pass" or an error.
 *
 * Pixel checks: the page sets `window.__capture = true`; the runner replaces it
 * with a PNG data URL of the viewport, which the page can draw into a canvas.
 */
export async function runUiFixture(name: string, source: string) {
  const dir = await mkdtemp(join(tmpdir(), `pig-${name}-ui-`));
  let passed = false;
  try {
    const entry = join(dir, "fixture.tsx");
    await Bun.write(
      entry,
      `(async()=>{try{${source}
        window.__fixture='pass';}catch(error){window.__fixture=String(error?.stack??error)+(window.__renderError?'\\nRender error: '+window.__renderError:'');}})();`,
    );
    const cssFiles = new Set<string>();
    const compiled = await Bun.build({
      entrypoints: [entry],
      target: "browser",
      minify: true,
      define: { "process.env.NODE_ENV": '"production"' },
      plugins: [
        await renderWorkerFixturePlugin(),
        {
          name: "isolated-host",
          setup(b) {
            b.onResolve({ filter: /^react\/jsx-runtime$/ }, () => ({
              path: fileURLToPath(import.meta.resolve("react/jsx-runtime")),
            }));
            b.onLoad({ filter: /\.css$/ }, ({ path }) => {
              cssFiles.add(path);
              return { loader: "js", contents: "" };
            });
            b.onLoad({ filter: /[\\/]mainview[\\/]rpc\.ts$/ }, () => ({
              loader: "ts",
              contents: rpcStub,
            }));
          },
        },
      ],
    });
    if (!compiled.success)
      throw new Error(compiled.logs.map(String).join("\n"));
    await Bun.write(join(dir, "fixture.js"), await compiled.outputs[0].text());
    const css = join(dir, "source.css");
    await Bun.write(
      css,
      [...cssFiles]
        .map((path) => `@import ${JSON.stringify(path.replaceAll("\\", "/"))};`)
        .join("\n"),
    );
    const styles = await build({
      configFile: false,
      root: dir,
      logLevel: "silent",
      plugins: [tailwindcss()],
      build: {
        write: false,
        assetsInlineLimit: Infinity,
        rollupOptions: { input: css },
      },
    });
    if (Array.isArray(styles) || !("output" in styles))
      throw new Error("Invalid stylesheet build");
    const asset = styles.output.find(
      (a) => a.type === "asset" && a.fileName.endsWith(".css"),
    );
    if (asset?.type !== "asset") throw new Error("Missing stylesheet");
    await Bun.write(join(dir, "fixture.css"), asset.source);
    const html = join(dir, "index.html");
    await Bun.write(
      html,
      '<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="fixture.css"><div id="root"></div><script src="fixture.js"></script>',
    );
    const browser = await fixtureBrowser(
      fixtureEdge,
      dir,
      pathToFileURL(html).href,
    );
    try {
      let result: string | undefined;
      for (let i = 0; i < 1600 && !result; i++) {
        const state = await browser.evaluate<{
          result?: string;
          capture: boolean;
        }>("({result:window.__fixture,capture:window.__capture===true})");
        result = state.result;
        if (state.capture) {
          const png = (await browser.screenshot()).toString("base64");
          await browser.evaluate(
            `window.__capture=${JSON.stringify(`data:image/png;base64,${png}`)}`,
          );
        } else if (!result) await Bun.sleep(25);
      }
      await Bun.write(join(dir, "fixture.png"), await browser.screenshot());
      if (result !== "pass")
        throw new Error(result ?? "fixture did not finish");
      passed = true;
    } finally {
      await browser.close();
    }
  } finally {
    if (passed && !process.env.PIG_KEEP_UI_FIXTURE)
      await rm(dir, {
        recursive: true,
        force: true,
        maxRetries: 10,
        retryDelay: 200,
      }).catch(() => {});
    else console.error(`${name} rendering fixture retained: ${dir}`);
  }
}

/** Page-side helpers shared by fixtures (inlined into the fixture source). */
export const fixtureHelpers = `
const check=(ok,message)=>{if(!ok)throw Error(message)};
const wait=()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
const until=async(predicate,message)=>{const end=performance.now()+4000;while(!predicate()){check(performance.now()<end,message);await wait();}};
const createFixtureRoot=createRoot=>createRoot(document.getElementById('root'),{onUncaughtError:error=>{window.__renderError=String(error?.stack??error);}});
/** Viewport pixels via the runner's screenshot; returns (x,y)=>[r,g,b,a]. */
const capturePixels=async()=>{window.__capture=true;await until(()=>typeof window.__capture==='string','screenshot capture');
  const image=new Image();image.src=window.__capture;delete window.__capture;await image.decode();
  const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;
  const ctx=canvas.getContext('2d');ctx.drawImage(image,0,0);const data=ctx.getImageData(0,0,image.width,image.height).data;
  return (x,y)=>{const i=(Math.round(y)*image.width+Math.round(x))*4;return [data[i],data[i+1],data[i+2],data[i+3]];};};
/** Standard deviation of luminance along a horizontal line. */
const lineDeviation=(pixel,x,y,width)=>{const values=[];for(let i=0;i<width;i++){const [r,g,b]=pixel(x+i,y);values.push(0.2126*r+0.7152*g+0.0722*b);}
  const mean=values.reduce((a,b)=>a+b,0)/values.length;return Math.sqrt(values.reduce((a,v)=>a+(v-mean)**2,0)/values.length);};
`;
