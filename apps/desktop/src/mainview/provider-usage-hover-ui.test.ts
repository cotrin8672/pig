import { expect, test } from "bun:test";
import { mkdtemp, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import { build } from "vite";
import {
  fixtureBrowser,
  removeFixtureDirectory,
} from "../../scripts/ui-browser";
import {
  fixtureHelpers,
  fixtureImport,
  runUiFixture,
} from "../../scripts/ui-fixture";

test(
  "usage popover glass matches the model picker in rendered pixels",
  () =>
    runUiFixture(
      "usage-glass",
      `
    const {createRoot}=await import(${fixtureImport(import.meta.resolve("react-dom/client"))});
    const {flushSync}=await import(${fixtureImport(import.meta.resolve("react-dom"))});
    const {ProviderUsageView}=await import(${fixtureImport(new URL("./ProviderUsageView.tsx", import.meta.url))});
    const {applyThemeTokens}=await import(${fixtureImport(new URL("./dynamic-theme.ts", import.meta.url))});
    const {usageFixtures,usageFixtureTime}=await import(${fixtureImport(new URL("../stories/providers/usage-fixtures.ts", import.meta.url))});
    await import(${fixtureImport(new URL("./styles.css", import.meta.url))});
    ${fixtureHelpers}
    const root=createFixtureRoot(createRoot);
    flushSync(()=>root.render(<>
      <div id="wallpaper" style={{position:'fixed',inset:0,background:'#102060'}}/>
      <div className="app-shell" style={{height:'100vh','--window-opacity':0.78}}>
        <div id="pattern" style={{position:'absolute',inset:0,background:'repeating-linear-gradient(90deg,#000 0 2px,#fff 2px 4px)'}}/>
        <aside className="sidebar" style={{width:260,justifyContent:'center'}}><ProviderUsageView entries={usageFixtures} now={usageFixtureTime}/></aside>
      </div>
    </>));
    await wait();
    document.querySelector('.provider-usage-row').dispatchEvent(new PointerEvent('pointerover',{bubbles:true}));
    await until(()=>document.querySelector('.usage-popover')?.matches(':popover-open'),'usage popover opens');
    const panel=document.querySelector('.usage-popover');
    const rect=panel.getBoundingClientRect();
    const x=Math.round(rect.left+rect.width/2),y=Math.round(rect.top+3);
    for(const seed of ['#809cce','#dc91b6','#a8a8a8']){
      applyThemeTokens(document.documentElement.style,seed);
      await wait();
      const pixels=await capturePixels();
      const deviation=lineDeviation(pixels,x-24,y,48);
      check(deviation<8,'usage must blur the underlying stripes: '+deviation);
      // The existing model-panel is the reference surface at the same position.
      const reference=document.createElement('div');reference.className='model-panel';
      reference.style.cssText='position:fixed;left:'+rect.left+'px;top:'+rect.top+'px;width:'+rect.width+'px;height:'+rect.height+'px;border:1px solid var(--ds-border-strong);border-radius:var(--radius-md)';
      panel.hidePopover();document.body.append(reference);await wait();
      const modelPixels=await capturePixels();
      check(pixels(x,y).slice(0,3).every((v,i)=>Math.abs(v-modelPixels(x,y)[i])<3),'usage colour must match model picker: '+pixels(x,y)+' vs '+modelPixels(x,y));
      reference.remove();panel.showPopover();
      const pattern=document.getElementById('pattern');
      pattern.style.background='transparent';
      const colours=[];
      for(const background of ['#102060','#80d0b0']){
        document.getElementById('wallpaper').style.background=background;await wait();
        colours.push((await capturePixels())(x,y));
      }
      check(colours[0].slice(0,3).some((v,i)=>Math.abs(v-colours[1][i])>12),'wallpaper must remain visible through shell + popover: '+JSON.stringify(colours));
      pattern.style.background='repeating-linear-gradient(90deg,#000 0 2px,#fff 2px 4px)';
    }
    applyThemeTokens(document.documentElement.style,'#809cce');
    document.getElementById('pattern').style.background='transparent';
    document.getElementById('wallpaper').style.background='linear-gradient(135deg,#102060,#80d0b0)';
    await wait();
  `,
    ),
  60_000,
);

/**
 * Real pointer and keyboard input against the shipped dock: one popover at a
 * time, no ghost after leaving, no pinning by click, pointer bridge, Escape,
 * list scroll closes, glass surface and no layout shift.
 */
test("usage details popover in Edge: single, bridged, unpinned, keyboard", async () => {
  // Vite resolves the entry through the real path; a Windows 8.3 TEMP
  // directory (RUNNER~1) would otherwise emit an `..`-relative asset name.
  const dir = await realpath(await mkdtemp(join(tmpdir(), "pig-usage-hover-")));
  const source = (path: string) =>
    JSON.stringify(fileURLToPath(new URL(path, import.meta.url)));
  try {
    await Bun.write(
      join(dir, "index.html"),
      '<!doctype html><meta charset="utf-8"><div id="root"></div><script type="module" src="./entry.js"></script>',
    );
    await Bun.write(
      join(dir, "entry.js"),
      `import {createElement as h} from ${JSON.stringify(fileURLToPath(import.meta.resolve("react")))};
      import {createRoot} from ${JSON.stringify(fileURLToPath(import.meta.resolve("react-dom/client")))};
      import {ProviderUsageView} from ${source("./ProviderUsageView.tsx")};
      import {usageFixtures,usageFixtureTime} from ${source("../stories/providers/usage-fixtures.ts")};
      import ${source("./styles.css")};
      import ${source("../stories/glass-stage.css")};
      createRoot(document.getElementById('root')).render(h('div',{className:'glass-stage'},
        h('div',{className:'glass-wallpaper'}),
        h('div',{className:'app-shell glass-shell',style:{'--window-opacity':0.78}},
          h('aside',{className:'sidebar',style:{width:260,height:420,justifyContent:'flex-end'}},
            h(ProviderUsageView,{entries:usageFixtures,now:usageFixtureTime,onRefresh(){}})))));`,
    );
    await build({
      configFile: false,
      root: dir,
      logLevel: "silent",
      plugins: [tailwindcss()],
      build: { outDir: join(dir, "dist"), assetsInlineLimit: Infinity },
    });
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      async fetch(request) {
        const pathname = new URL(request.url).pathname;
        const file = Bun.file(
          join(dir, "dist", pathname === "/" ? "index.html" : pathname),
        );
        return (await file.exists())
          ? new Response(file)
          : new Response(null, { status: 404 });
      },
    });
    try {
      const browser = await fixtureBrowser(
        process.env.PIG_UI_BROWSER ??
          "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
        dir,
        server.url.href,
      );
      try {
        await browser.command("Emulation.setDeviceMetricsOverride", {
          width: 720,
          height: 480,
          deviceScaleFactor: 1,
          mobile: false,
        });
        for (let i = 0; i < 200; i++) {
          if (
            await browser.evaluate(
              "!!document.querySelector('.provider-usage-row')",
            )
          )
            break;
          await Bun.sleep(25);
        }
        const js = <T>(body: string) =>
          browser.evaluate<T>(`(()=>{${body}})()`);
        const rowPoint = (name: string, dx = 4) =>
          js<{ x: number; y: number }>(
            `const r=[...document.querySelectorAll('.provider-usage-row')].find(r=>r.getAttribute('aria-label').split('\\n')[0]===${JSON.stringify(name)}).getBoundingClientRect();return {x:r.x+${dx},y:r.y+r.height/2}`,
          );
        const move = async (point: { x: number; y: number }, wait = 60) => {
          await browser.command("Input.dispatchMouseEvent", {
            type: "mouseMoved",
            ...point,
          });
          await Bun.sleep(wait);
        };
        const state = () =>
          js<{ count: number; open: boolean; name: string; top: number }>(
            `const p=[...document.querySelectorAll('.usage-popover')];const a=p[0];return {count:p.length,open:!!a?.matches(':popover-open'),name:a?.querySelector('strong')?.textContent??'',top:a?Math.round(a.getBoundingClientRect().top):-1,bottom:a?Math.round(a.getBoundingClientRect().bottom):-1}`,
          );
        const rowTop = (name: string) =>
          js<number>(
            `return Math.round([...document.querySelectorAll('.provider-usage-row')].find(r=>r.getAttribute('aria-label').split('\\n')[0]===${JSON.stringify(name)}).getBoundingClientRect().top)`,
          );

        const before = await rowTop("OpenAI Personal");
        await move(await rowPoint("OpenAI Personal", 2));
        let s = await state();
        expect(s).toMatchObject({
          count: 1,
          open: true,
          name: "OpenAI Personal",
        });
        expect(
          await js<boolean>(`
            const p=document.querySelector('.usage-popover'),style=getComputedStyle(p);
            const c=document.createElement('canvas').getContext('2d');c.fillStyle=style.backgroundColor;c.fillRect(0,0,1,1);
            const alpha=c.getImageData(0,0,1,1).data[3];
            return alpha>0&&alpha<255&&style.opacity==='1'&&style.backdropFilter.includes('blur')
              &&![...document.querySelectorAll('.provider-usage-row')].some(r=>r.hasAttribute('title'))`),
        ).toBe(true);
        expect(await rowTop("OpenAI Personal")).toBe(before);

        // Moving to the next row swaps content: never two popovers at once.
        await move(await rowPoint("OpenAI Work"), 0);
        s = await state();
        expect(s.count).toBe(1);
        expect(s.name).toBe("OpenAI Work");
        // Anchored to the new row (clamped to the viewport when tall).
        expect(s.top).toBeLessThanOrEqual(await rowTop("OpenAI Work"));

        // Pointer bridge into the popover keeps it open.
        const inside = await js<{ x: number; y: number }>(
          "const r=document.querySelector('.usage-popover').getBoundingClientRect();return {x:r.x+20,y:r.y+20}",
        );
        await move(inside, 300);
        expect((await state()).open).toBe(true);

        // Leaving everything closes it: no ghost.
        await move({ x: 700, y: 20 }, 300);
        expect((await state()).count).toBe(0);

        // A click must not pin it open.
        const work = await rowPoint("OpenAI Work");
        await move(work);
        for (const type of ["mousePressed", "mouseReleased"])
          await browser.command("Input.dispatchMouseEvent", {
            type,
            ...work,
            button: "left",
            clickCount: 1,
          });
        await move({ x: 700, y: 20 }, 300);
        expect((await state()).count).toBe(0);

        // Scrolling the list closes it, like ActionsMenu.
        await move(await rowPoint("Anthropic"));
        expect((await state()).count).toBe(1);
        await js("document.querySelector('.provider-usage-list').scrollTop=40");
        await Bun.sleep(60);
        expect((await state()).count).toBe(0);
        await move({ x: 700, y: 20 }, 300);

        // Keyboard focus opens it; Escape closes.
        await js("document.querySelector('.provider-usage-refresh').focus()");
        await browser.command("Input.dispatchKeyEvent", {
          type: "keyDown",
          key: "Tab",
          code: "Tab",
          windowsVirtualKeyCode: 9,
        });
        await browser.command("Input.dispatchKeyEvent", {
          type: "keyUp",
          key: "Tab",
          code: "Tab",
          windowsVirtualKeyCode: 9,
        });
        await Bun.sleep(60);
        s = await state();
        expect(s.count).toBe(1);
        expect(s.name).toBe(
          await js<string>(
            "return document.activeElement.getAttribute('aria-label')?.split('\\n')[0]??''",
          ),
        );
        await browser.command("Input.dispatchKeyEvent", {
          type: "keyDown",
          key: "Escape",
          code: "Escape",
          windowsVirtualKeyCode: 27,
        });
        await Bun.sleep(60);
        expect((await state()).count).toBe(0);
      } finally {
        await browser.close();
      }
    } finally {
      server.stop(true);
    }
  } finally {
    await removeFixtureDirectory(dir);
  }
}, 60_000);
