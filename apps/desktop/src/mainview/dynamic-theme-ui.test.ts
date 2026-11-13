import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import { build } from "vite";
import { renderWorkerFixturePlugin } from "../../scripts/render-worker-fixture";
import {
  fixtureBrowser,
  removeFixtureDirectory,
} from "../../scripts/ui-browser";

const edge =
  process.env.PIG_UI_BROWSER ??
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
test.skipIf(!existsSync(edge) && !process.env.PIG_REQUIRE_UI_TESTS)(
  "dynamic theme in Edge: settings, glass picker, live palette, input, focus, retained syntax and unchanged ANSI",
  async () => {
    if (!existsSync(edge)) throw new Error("Required UI browser is missing");
    const directory = await mkdtemp(join(tmpdir(), "pig-theme-ui-"));
    let passed = false;
    const source = (path: string) =>
      JSON.stringify(fileURLToPath(new URL(path, import.meta.url)));
    try {
      const entry = join(directory, "fixture.tsx");
      await Bun.write(
        entry,
        `
        import {createRoot} from ${JSON.stringify(fileURLToPath(import.meta.resolve("react-dom/client")))};
        import {flushSync} from ${JSON.stringify(fileURLToPath(import.meta.resolve("react-dom")))};
        import {AppearanceSettings} from ${source("./Settings.tsx")};
        import {DynamicTheme} from ${source("./DynamicTheme.tsx")};
        import {CodeText,TerminalOutput} from ${source("./HighlightedCode.tsx")};
        import {cachedHighlight} from ${source("./syntax-highlighting.ts")};
        import {useStore} from ${source("./store.ts")};
        import {defaultThemeColor} from ${source("../shared/theme-color.ts")};
        import ${source("./styles.css")};
        const text='const greeting: string = "Hello"; // theme-aware code';
        useStore.setState(s=>({settings:{...s.settings,language:'en'}}));
        const root=createRoot(document.getElementById('root'));
        flushSync(()=>root.render(<><DynamicTheme/><div className="app-shell"><main className="content-page"><div className="content-page-shell"><h1>Appearance</h1><AppearanceSettings/><pre id="syntax"><CodeText text={text} language="ts"/></pre><pre id="ansi"><TerminalOutput text={'\\u001b[38;2;12;34;56mExplicit ANSI color\\u001b[0m'}/></pre><button id="outside" type="button">Outside</button></div></main></div></>));
        window.fixture={store:useStore,defaultThemeColor,seed:color=>flushSync(()=>useStore.setState(s=>({appearance:{...s.appearance,themeColor:color}}))),cached:()=>cachedHighlight(text,'ts'),unmount:()=>flushSync(()=>root.unmount())};
        window.__ready=true;
      `,
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
            name: "isolated-theme-settings",
            setup(builder) {
              builder.onResolve({ filter: /^react\/jsx-runtime$/ }, () => ({
                path: fileURLToPath(import.meta.resolve("react/jsx-runtime")),
              }));
              builder.onLoad({ filter: /\.css$/ }, ({ path }) => {
                cssFiles.add(path);
                return { loader: "js", contents: "" };
              });
              builder.onLoad({ filter: /[\\/]rpc\.ts$/ }, () => ({
                loader: "ts",
                contents: `
              import {useStore} from ${source("./store.ts")};
              const noop=()=>{};
              export const rpc={request:new Proxy({},{get:()=>async()=>[]}),send:new Proxy({},{get:()=>noop})};
              export function updateAppearance(change){useStore.setState(s=>({appearance:change(s.appearance)}));window.__appearanceWrites=(window.__appearanceWrites??0)+1;}
              export const updateSettings=noop,updateUiPreferences=noop,refreshSessions=noop,refresh=noop,requestSelection=noop,connectRuntime=noop,cancelOpening=noop,openChat=noop,showPendingOpen=noop;
            `,
              }));
            },
          },
        ],
      });
      expect(compiled.success, compiled.logs.map(String).join("\n")).toBe(true);
      await Bun.write(
        join(directory, "fixture.js"),
        await compiled.outputs[0].text(),
      );
      const css = join(directory, "source.css");
      await Bun.write(
        css,
        [...cssFiles]
          .map(
            (path) => `@import ${JSON.stringify(path.replaceAll("\\", "/"))};`,
          )
          .join("\n"),
      );
      const styles = await build({
        configFile: false,
        root: directory,
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
      await Bun.write(join(directory, "fixture.css"), asset.source);
      const html = join(directory, "index.html");
      await Bun.write(
        html,
        '<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="fixture.css"><div id="root"></div><script src="fixture.js"></script>',
      );
      const browser = await fixtureBrowser(
        edge,
        directory,
        pathToFileURL(html).href,
      );
      const evaluate = (script: string) =>
        browser.evaluate(
          `(async()=>{const check=(ok,message)=>{if(!ok)throw Error(message)};const wait=()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));${script}})()`,
        );
      const key = async (key: string, code: number) => {
        await browser.command("Input.dispatchKeyEvent", {
          type: "keyDown",
          key,
          windowsVirtualKeyCode: code,
        });
        await browser.command("Input.dispatchKeyEvent", {
          type: "keyUp",
          key,
          windowsVirtualKeyCode: code,
        });
      };
      try {
        for (let i = 0; i < 400; i++) {
          if (
            await browser.evaluate(
              "!!window.__ready && !!document.querySelector('#syntax .syntax-token') && !!document.querySelector('#ansi .syntax-token')",
            )
          )
            break;
          await Bun.sleep(25);
        }
        await evaluate(`
          check(window.__ready,'fixture initialized');
          check(document.querySelector('.color-picker-trigger').textContent.includes('#8FAEE8'),'saved theme appears in settings');
          check(!document.querySelector('.color-picker-plane'),'closed picker is not rendered');
          window.oldCode=document.querySelector('#syntax .syntax-token');window.oldCache=fixture.cached();window.oldSyntax=getComputedStyle(oldCode).color;
          window.oldAnsi=getComputedStyle(document.querySelector('#ansi .syntax-token')).color;
          window.oldRows=[...document.querySelectorAll('.settings-row')].map(e=>e.getBoundingClientRect().toJSON());
          document.querySelector('.color-picker-trigger').click();await wait();
          check(document.querySelector('.color-picker-panel').matches(':popover-open'),'native top-layer popover opens');
          document.querySelector('.color-picker-trigger').click();await wait();
          check(!document.querySelector('.color-picker-panel').matches(':popover-open'),'trigger also closes the picker');
          document.querySelector('.color-picker-trigger').click();await wait();
          const style=getComputedStyle(document.querySelector('.color-picker-panel'));
          check(style.backdropFilter.includes('blur'),'glass picker backdrop');
          check(style.opacity==='1'&&style.backgroundColor.startsWith('rgba('),'translucent paint, opaque contents');
          const pink=document.querySelector('[aria-label="#DC91B6"]');pink.click();await wait();
          check(fixture.store.getState().appearance.themeColor==='#dc91b6','preset changes persisted appearance seed');
          check(document.querySelector('#syntax .syntax-token')===oldCode&&fixture.cached()===oldCache,'theme must retain code DOM and token cache');
          check(getComputedStyle(oldCode).color!==oldSyntax,'existing syntax recolours via variables');
          check(getComputedStyle(document.querySelector('#ansi .syntax-token')).color===oldAnsi,'explicit ANSI RGB stays unchanged');
          check(JSON.stringify(oldRows)===JSON.stringify([...document.querySelectorAll('.settings-row')].map(e=>e.getBoundingClientRect().toJSON())),'picker/preview must not move settings');
          window.oldBackground=getComputedStyle(document.querySelector('.app-shell')).backgroundImage;
        `);
        // Real native keyboard events (not synthetic onChange) edit each range.
        await browser.evaluate(
          "document.querySelector('[aria-label=Hue]').focus()",
        );
        await key("ArrowRight", 39);
        await evaluate(
          `await wait();check(fixture.store.getState().appearance.themeColor!=='#dc91b6','hue keyboard input previews');`,
        );
        await browser.evaluate(
          "document.querySelector('[aria-label=Saturation]').focus()",
        );
        await key("ArrowRight", 39);
        await browser.evaluate(
          "document.querySelector('[aria-label=Brightness]').focus()",
        );
        await key("ArrowLeft", 37);
        await evaluate(
          `await wait();check(getComputedStyle(document.querySelector('.color-picker-plane')).outlineStyle!=='none','keyboard focus is visible for the plane');`,
        );
        const point = await browser.evaluate<{ x: number; y: number }>(
          "(()=>{const r=document.querySelector('.color-picker-plane').getBoundingClientRect();return {x:r.left+r.width*.8,y:r.top+r.height*.25}})()",
        );
        await browser.command("Input.dispatchMouseEvent", {
          type: "mousePressed",
          ...point,
          button: "left",
          buttons: 1,
          clickCount: 1,
        });
        await browser.command("Input.dispatchMouseEvent", {
          type: "mouseMoved",
          x: point.x + 12,
          y: point.y + 8,
          button: "left",
          buttons: 1,
        });
        await browser.command("Input.dispatchMouseEvent", {
          type: "mouseReleased",
          x: point.x + 12,
          y: point.y + 8,
          button: "left",
          buttons: 0,
          clickCount: 1,
        });
        await evaluate(
          `await wait();const p=document.querySelector('[aria-label=Saturation]');check(Number(p.value)>80,'pointer drag edits colour plane');check(getComputedStyle(document.querySelector('.app-shell')).backgroundImage!==oldBackground,'shell follows seed');`,
        );
        await browser.evaluate(
          "(()=>{const input=document.querySelector('[aria-label=\"Hex color\"]');input.focus();input.select()})()",
        );
        await browser.command("Input.insertText", { text: "#abc" });
        await key("Enter", 13);
        await evaluate(
          `await wait();check(fixture.store.getState().appearance.themeColor==='#aabbcc','short HEX expands on commit');`,
        );
        await browser.evaluate(
          "(()=>{const input=document.querySelector('[aria-label=\"Hex color\"]');input.focus();input.select()})()",
        );
        await browser.command("Input.insertText", { text: "#zzzzzz" });
        await key("Enter", 13);
        await evaluate(
          `await wait();check(fixture.store.getState().appearance.themeColor==='#aabbcc','invalid HEX never reaches theme');check(document.querySelector('[aria-label="Hex color"]').value==='#aabbcc','invalid input restores valid colour');`,
        );
        await key("Escape", 27);
        await evaluate(
          `await wait();check(!document.querySelector('.color-picker-panel').matches(':popover-open'),'Escape dismisses');check(document.activeElement===document.querySelector('.color-picker-trigger'),'Escape restores trigger focus');check(!document.querySelector('.color-picker-plane'),'dismissed controls unmount');`,
        );
        // Extreme seeds and backdrop/opacity modes keep normal Cards translucent.
        await evaluate(`
          for(const seed of ['#000000','#ffffff','#ff0000','#00ff00','#0000ff'])for(const backdrop of ['none','acrylic','mica'])for(const opacity of [0,.4,1]){
            fixture.seed(seed);fixture.store.setState(s=>({appearance:{...s.appearance,backdrop,opacity:{...s.appearance.opacity,[backdrop]:opacity}}}));await wait();
            const card=document.querySelector('.settings-card'),style=getComputedStyle(card);
            const canvas=document.createElement('canvas');canvas.width=canvas.height=1;const ctx=canvas.getContext('2d');ctx.fillStyle=style.backgroundColor;ctx.fillRect(0,0,1,1);const alpha=ctx.getImageData(0,0,1,1).data[3];
            check(alpha>0&&alpha<255&&style.opacity==='1','all seeds/modes preserve translucent Cards');
          }
          fixture.seed('#7dbfbd');document.querySelector('.color-picker-trigger').click();await wait();
        `);
        await Bun.write(
          join(directory, "theme.png"),
          await browser.screenshot(),
        );
        await browser.command("Emulation.setDeviceMetricsOverride", {
          width: 360,
          height: 420,
          deviceScaleFactor: 1,
          mobile: false,
        });
        await evaluate(
          `await wait();const r=document.querySelector('.color-picker-panel').getBoundingClientRect();check(r.left>=11&&r.right<=innerWidth-11&&r.top>=11&&r.bottom<=innerHeight-11,'popover fits narrow viewport');check(getComputedStyle(document.querySelector('.color-picker-panel')).opacity==='1','no faded content');document.querySelector('.color-picker-reset').click();await wait();check(fixture.store.getState().appearance.themeColor===fixture.defaultThemeColor,'reset returns default seed');`,
        );
        await browser.command("Emulation.setDeviceMetricsOverride", {
          width: 600,
          height: 600,
          deviceScaleFactor: 1,
          mobile: false,
        });
        await evaluate(
          `await wait();window.outsidePoint=(()=>{const r=document.querySelector('#outside').getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2}})();`,
        );
        const outside = await browser.evaluate<{ x: number; y: number }>(
          "window.outsidePoint",
        );
        await browser.command("Input.dispatchMouseEvent", {
          type: "mousePressed",
          ...outside,
          button: "left",
          buttons: 1,
          clickCount: 1,
        });
        await browser.command("Input.dispatchMouseEvent", {
          type: "mouseReleased",
          ...outside,
          button: "left",
          buttons: 0,
          clickCount: 1,
        });
        await evaluate(
          `await wait();check(!document.querySelector('.color-picker-panel').matches(':popover-open'),'outside click light-dismisses');check(document.activeElement.id==='outside','light-dismiss does not steal outside focus');fixture.unmount();check(!document.documentElement.style.getPropertyValue('--ds-accent'),'theme lifecycle removes generated properties');`,
        );
        passed = true;
      } finally {
        await browser.close();
      }
    } finally {
      if (passed && !process.env.PIG_KEEP_UI_FIXTURE)
        await removeFixtureDirectory(directory);
      else console.error(`Theme rendering fixture retained: ${directory}`);
    }
  },
  90_000,
);
