import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import { build } from "vite";
import { fixtureBrowser, removeFixtureDirectory } from "../scripts/ui-browser";

const edge =
  process.env.PIG_UI_BROWSER ??
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
test.skipIf(!existsSync(edge) && !process.env.PIG_REQUIRE_UI_TESTS)(
  "pane previews: dividers, focused splits, equal siblings, native resizing and independent state",
  async () => {
    const dir = await mkdtemp(join(tmpdir(), "pig-panes-ui-"));
    const source = (path: string) =>
      JSON.stringify(
        fileURLToPath(new URL(path, import.meta.url)).replaceAll("\\", "/"),
      );
    let passed = false;
    try {
      await Bun.write(
        join(dir, "index.html"),
        '<!doctype html><meta charset="utf-8"><div id="root"></div><script type="module" src="./entry.js"></script>',
      );
      await Bun.write(
        join(dir, "rpc.js"),
        `export async function openChat(cwd){return window.openPaneSession(cwd)};export function showPendingOpen(){};export function updateAppearance(){};export const rpc={request:{invokeSessionAction:async()=>{}}};`,
      );
      await Bun.write(
        join(dir, "entry.js"),
        `
        import {createElement} from ${JSON.stringify(fileURLToPath(import.meta.resolve("react")))};
        import {createRoot} from ${JSON.stringify(fileURLToPath(import.meta.resolve("react-dom/client")))};
        import {flushSync} from ${JSON.stringify(fileURLToPath(import.meta.resolve("react-dom")))};
        import {PanePreview,paneLayouts} from ${source("../src/stories/panes/PanePreview.tsx")};
        import {PaneWorkspace} from ${source("../src/mainview/PaneWorkspace.tsx")};
        import {useStore} from ${source("../src/mainview/store.ts")};
        import {selectPaneSession} from ${source("../src/mainview/pane-selection.ts")};
        import {initShortcuts} from ${source("../src/mainview/shortcuts.ts")};
        import ${source("../src/mainview/styles.css")};
        import ${source("../src/stories/glass-stage.css")};
        const root=createRoot(document.getElementById('root'));
        let generation=0;
        window.renderPane=(layout,sidebar=true)=>flushSync(()=>root.render(createElement('div',{className:'glass-stage'},
          createElement('div',{className:'glass-wallpaper'}),
          createElement('div',{className:'app-shell glass-shell',style:{'--window-opacity':0.78}},
            createElement(PanePreview,{key:++generation,initialLayout:layout,sidebar})))));
        window.paneLayouts=paneLayouts;
        let session=0;
        window.openPaneSession=cwd=>{const id='pane-session-'+(++session),snapshot={info:{id,cwd,title:id},address:{hostId:'fixture',sessionId:id,epoch:1},transcript:{running:false,records:[]}};
          useStore.setState(s=>({active:id,snapshots:{...s.snapshots,[id]:snapshot},...selectPaneSession(s,id)}));return snapshot};
        const renderChat=snapshot=>createElement('textarea',{key:snapshot.info.id,'data-session':snapshot.info.id,defaultValue:'draft '+snapshot.info.id});
        function Production(){const snapshot=useStore(s=>s.snapshots[s.active]);return createElement(PaneWorkspace,{renderChat},snapshot?renderChat(snapshot):null)}
        window.renderProduction=()=>{useStore.setState(s=>({initialized:true,page:'chat',searchOpen:false,activePane:1,paneTree:{type:'pane',id:1},panes:{1:{}},bootstrap:{...s.bootstrap,generalCwd:'fixture'}}));window.openPaneSession('fixture');flushSync(()=>root.render(createElement('div',{className:'app-shell'},createElement('div',{style:{width:'100%',height:'100%'}},createElement(Production)))));};
        initShortcuts();
        window.renderPane('stacked');
      `,
      );
      await build({
        configFile: false,
        root: dir,
        logLevel: "silent",
        plugins: [tailwindcss()],
        resolve: {
          alias: [{ find: /^\.\/rpc$/, replacement: join(dir, "rpc.js") }],
        },
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
        const browser = await fixtureBrowser(edge, dir, server.url.href);
        try {
          await browser.command("Emulation.setDeviceMetricsOverride", {
            width: 1703,
            height: 1031,
            deviceScaleFactor: 1,
            mobile: false,
          });
          for (let i = 0; i < 200; i++) {
            if (await browser.evaluate("typeof window.renderPane==='function'"))
              break;
            await Bun.sleep(25);
          }
          for (const [width, height, scale] of [
            [1703, 1031, 1],
            [1024, 768, 1.3],
          ]) {
            await browser.command("Emulation.setDeviceMetricsOverride", {
              width,
              height,
              deviceScaleFactor: 1,
              mobile: false,
            });
            const result = await browser.evaluate<string>(`(async()=>{
              const check=(ok,message)=>{if(!ok)throw Error(message)};
              const wait=()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
              document.documentElement.style.setProperty('--font-scale',${scale});
              for(const [layout,definition] of Object.entries(window.paneLayouts)){
                window.renderPane(layout);await wait();
                const panes=[...document.querySelectorAll('.pane-preview-pane')];
                const icons=[...document.querySelectorAll('.sidebar-footer .sidebar-icon')].map(icon=>icon.getBoundingClientRect());
                check(icons.every(icon=>Math.abs(icon.y-icons[0].y)<1&&icon.width===32&&icon.height===32),'aligned sidebar icons');
                check(panes.length===definition.count,layout+': count');
                const dividers=[...document.querySelectorAll('.pane-preview-divider')];
                check(dividers.length===definition.count-1,layout+': divider count');
                for(const divider of dividers){
                  const rows=divider.dataset.axis==='rows',line=getComputedStyle(divider,'::after'),rect=divider.getBoundingClientRect();
                  check(parseFloat(rows?line.height:line.width)===1,'one-pixel divider');
                  check((rows?rect.height:rect.width)>=8,'divider hit target is wider than its line');
                }
                check(document.querySelector('.pane-preview-window').scrollWidth<=innerWidth,layout+': window overflow');
                const surface=document.querySelector('.pane-preview-grid'),canvas=document.createElement('canvas');
                const ctx=canvas.getContext('2d');ctx.fillStyle=getComputedStyle(surface).backgroundColor;ctx.fillRect(0,0,1,1);
                const alpha=ctx.getImageData(0,0,1,1).data[3];
                check(alpha>0&&alpha<255&&getComputedStyle(surface).opacity==='1',layout+': continuous translucent workspace');
                for(const pane of panes){
                  const bounds=pane.getBoundingClientRect();
                  const composer=pane.querySelector('.pane-preview-composer');
                  check(bounds.height>150&&bounds.width>250,layout+': readable pane size');
                  check(bounds.bottom<=innerHeight+1&&bounds.right<=innerWidth+1,layout+': viewport bounds');
                  check(composer.getBoundingClientRect().bottom<=bounds.bottom,layout+': composer clipped');
                  check(pane.scrollWidth<=pane.clientWidth+1,layout+': horizontal overflow');
                  check(composer===pane.lastElementChild,layout+': no messages below composer');
                  const style=getComputedStyle(pane);
                  check(style.borderTopWidth==='0px'&&style.borderRadius==='0px'&&style.boxShadow==='none'&&style.backgroundColor==='rgba(0, 0, 0, 0)',layout+': no per-pane card treatment');
                }
                const [a,b,c]=panes.map(p=>p.getBoundingClientRect());
                if(['stacked','weighted','triple'].includes(layout))check(Math.abs(a.x-b.x)<1&&Math.abs(a.bottom-b.y)<1,layout+': stacked geometry');
                if(layout==='stacked')check(Math.abs(a.height-b.height)<1,'equal heights');
                if(layout==='weighted')check(Math.abs(a.height/b.height-2)<0.02,'weighted heights');
                if(layout==='columns')check(Math.abs(a.right-b.x)<1&&Math.abs(a.y-b.y)<1,'columns geometry');
                if(layout==='bottomSplit')check(Math.abs(a.bottom-b.y)<1&&Math.abs(b.right-c.x)<1&&a.width>b.width,'nested geometry');
                if(layout==='grid')check(Math.abs(a.right-b.x)<1&&Math.abs(a.bottom-c.y)<1,'grid geometry');
              }
              window.renderPane('stacked');await wait();
              const all=()=>[...document.querySelectorAll('.pane-preview-pane')];
              const click=async selector=>{document.querySelector(selector).click();await wait()};
              const first=all()[0],second=all()[1],input=first.querySelector('textarea');input.value='keep this draft';
              second.querySelector('textarea').focus();await wait();
              check(second.dataset.active==='true','focus selects pane');
              await click('[aria-label="pane 2を拡大"]');
              check(all().filter(p=>!p.hidden).length===1,'maximize');
              await click('[aria-label="分割表示に戻す"]');
              check(all().every(p=>!p.hidden)&&input.value==='keep this draft','restore keeps drafts');
              const history=second.querySelector('.pane-preview-history');
              const long=document.createElement('p');long.textContent='long history '.repeat(2000);history.append(long);
              history.scrollTop=history.scrollHeight;
              check(history.scrollTop>0&&first.querySelector('.pane-preview-history').scrollTop===0,'independent history scrolling');
              await click('[aria-label="pane 2を閉じる"]');check(all().length===1,'close pane');
              check(document.querySelector('[aria-label="pane 1を閉じる"]').disabled,'cannot close last pane');
              await click('[aria-label="上下に分割"]');check(all().length===2,'split');
              await click('[aria-label="上下に分割"]');check(all().length===3,'three rows');
              const heights=all().map(p=>p.getBoundingClientRect().height);
              check(Math.max(...heights)-Math.min(...heights)<1,'same-axis splits must create equal thirds');
              await click('[aria-label="上下に分割"]');check(all().length===4,'four sample sessions');
              check(document.querySelector('[aria-label="上下に分割"]').disabled,'sample session limit');
              window.renderPane('single');await wait();
              const original=document.querySelector('textarea');original.value='draft survives focused splits';
              await click('[aria-label="上下に分割"]');
              await click('[aria-label="pane 2を選択: pane機能のレイアウトを検討"]');
              const top=all()[0].getBoundingClientRect();
              await click('[aria-label="左右に分割"]');
              const [a,b,c]=all().map(p=>p.getBoundingClientRect());
              check(a.x===top.x&&a.y===top.y&&a.width===top.width&&a.height===top.height,'opposite split must not rearrange other panes');
              check(Math.abs(b.y-c.y)<1&&Math.abs(b.height-c.height)<1&&Math.abs(b.right-c.x)<1,'focused bottom pane is split left/right');
              check(document.querySelector('textarea')===original&&original.value==='draft survives focused splits','splitting preserves draft DOM');
              await click('[aria-label="左右に分割"]');
              const widths=all().slice(1).map(p=>p.getBoundingClientRect().width);
              check(Math.max(...widths)-Math.min(...widths)<1,'same-axis nested split creates equal thirds');
              check(Math.abs(all()[0].getBoundingClientRect().height-top.height)<1,'nested equalization preserves outer ratio');
              document.querySelector('.pane-preview-layout-menu').open=true;
              await click('.pane-preview-layout-options button:last-child');check(all().length===4,'layout menu');
              document.querySelector('.pane-preview-layout-menu').open=true;
              document.querySelector('.pane-preview-layout-menu').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
              check(!document.querySelector('.pane-preview-layout-menu').open,'Escape closes menu');
              await click('.project-threads button');
              check(document.querySelector('.pane-preview-pane[data-active="true"]').textContent.includes('DualPumpLLE'),'sidebar focuses an open session');
              window.renderPane('single');await wait();
              await click('.project-threads button');
              check(all().length===1&&all()[0].textContent.includes('DualPumpLLE'),'sidebar replaces the selected pane for a different session');
              window.renderPane('stacked',false);await wait();
              check(document.querySelector('.sidebar').getBoundingClientRect().right<=1,'collapsed sidebar');
              return 'pass';
            })()`);
            expect(result).toBe("pass");
          }
          await browser.command("Emulation.setDeviceMetricsOverride", {
            width: 1703,
            height: 1031,
            deviceScaleFactor: 1,
            mobile: false,
          });
          await browser.evaluate(`document.documentElement.style.setProperty('--font-scale','1');window.renderPane('bottomSplit');
            window.paneSizes=()=>[...document.querySelectorAll('.pane-preview-pane')].map(p=>{const r=p.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}});
            window.beforeResize=window.paneSizes();window.originalInput=document.querySelector('textarea');window.originalInput.value='keep while dragging';
            window.dragEvents=[];for(const name of ['pointerdown','pointermove','pointerup','pointercancel','gotpointercapture','lostpointercapture'])document.addEventListener(name,e=>window.dragEvents.push({name,trusted:e.isTrusted,target:e.target.className}),true);`);
          async function dragDivider(axis: "rows" | "columns", delta: number) {
            const point = await browser.evaluate<{ x: number; y: number }>(
              `(()=>{const r=document.querySelector('.pane-preview-divider[data-axis="${axis}"]').getBoundingClientRect();return {x:r.x+r.width*${axis === "rows" ? 0.25 : 0.5},y:r.y+r.height*${axis === "rows" ? 0.5 : 0.4}}})()`,
            );
            await browser.command("Input.dispatchMouseEvent", {
              type: "mouseMoved",
              ...point,
            });
            await browser.command("Input.dispatchMouseEvent", {
              type: "mousePressed",
              ...point,
              button: "left",
              buttons: 1,
              clickCount: 1,
            });
            await browser.command("Input.dispatchMouseEvent", {
              type: "mouseMoved",
              x: point.x + (axis === "columns" ? delta : 0),
              y: point.y + (axis === "rows" ? delta : 0),
              button: "left",
              buttons: 1,
            });
            await browser.command("Input.dispatchMouseEvent", {
              type: "mouseReleased",
              x: point.x + (axis === "columns" ? delta : 0),
              y: point.y + (axis === "rows" ? delta : 0),
              button: "left",
              buttons: 0,
              clickCount: 1,
            });
            await Bun.sleep(80);
          }
          await dragDivider("rows", 80);
          expect(
            await browser.evaluate(
              `(()=>{const before=window.beforeResize,after=window.paneSizes();return Math.abs(after[0].height-before[0].height-80)<2&&Math.abs(after[1].height-before[1].height+80)<2&&Math.abs(after[2].height-before[2].height+80)<2&&window.dragEvents.every(e=>e.trusted)&&window.dragEvents.some(e=>e.name==='gotpointercapture')&&window.dragEvents.some(e=>e.name==='lostpointercapture')&&!document.querySelector('.pane-preview-divider[data-dragging="true"]')})()`,
            ),
          ).toBe(true);
          await browser.evaluate("window.beforeResize=window.paneSizes()");
          await dragDivider("columns", 100);
          expect(
            await browser.evaluate(
              `(()=>{const before=window.beforeResize,after=window.paneSizes();return JSON.stringify(before[0])===JSON.stringify(after[0])&&Math.abs(after[1].width-before[1].width-100)<2&&Math.abs(after[2].width-before[2].width+100)<2&&document.querySelector('textarea')===window.originalInput&&window.originalInput.value==='keep while dragging'})()`,
            ),
          ).toBe(true);
          await browser.evaluate("window.beforeResize=window.paneSizes()");
          await browser.command("Input.dispatchKeyEvent", {
            type: "keyDown",
            key: "ArrowLeft",
            code: "ArrowLeft",
            windowsVirtualKeyCode: 37,
          });
          await browser.command("Input.dispatchKeyEvent", {
            type: "keyUp",
            key: "ArrowLeft",
            code: "ArrowLeft",
            windowsVirtualKeyCode: 37,
          });
          await Bun.sleep(50);
          expect(
            await browser.evaluate(
              "Math.abs(window.paneSizes()[1].width-window.beforeResize[1].width+10)<2",
            ),
          ).toBe(true);
          expect(
            await browser.evaluate(`(async()=>{
            const check=(ok,message)=>{if(!ok)throw Error(message)},wait=()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
            window.renderProduction();await wait();const input=document.querySelector('textarea');input.value='real pane draft';
            const key=key=>window.dispatchEvent(new KeyboardEvent('keydown',{key,ctrlKey:true,altKey:true,bubbles:true}));
            check(!document.querySelector('.pane-header'),'no pane header in a single pane');
            key('h');await wait();
            check(document.querySelectorAll('.pane-view').length===2,'real pane creation');
            check(document.activeElement===document.querySelector('.pane-view[data-active="true"] textarea'),'new pane receives editor focus');
            key('v');await wait();
            const panes=[...document.querySelectorAll('.pane-view')],bounds=panes.map(p=>p.getBoundingClientRect());
            check(panes.length===3&&bounds[0].width>bounds[1].width&&Math.abs(bounds[1].y-bounds[2].y)<1,'real focused nested split');
            check(!document.querySelector('.pane-header'),'no pane headers after splitting');
            check(panes.every(p=>{const pane=p.getBoundingClientRect(),content=p.querySelector('.pane-content').getBoundingClientRect();return Math.abs(pane.y-content.y)<1&&Math.abs(pane.height-content.height)<1}),'pane content uses full height without a reserved header');
            key('ArrowLeft');await wait();check(document.activeElement===panes[1].querySelector('textarea'),'focus shortcut');
            key('w');await wait();
            check(document.querySelectorAll('.pane-view').length===2,'close shortcut');
            check(document.activeElement===input,'closing a pane returns focus to a surviving editor');
            check(input===document.querySelector('textarea')&&input.value==='real pane draft','real draft DOM survives split/focus/close');
            key('h');await wait();const heights=[...document.querySelectorAll('.pane-view')].map(p=>p.getBoundingClientRect().height);
            check(heights.length===3&&Math.max(...heights)-Math.min(...heights)<1,'creation shortcut equalizes siblings');
            return 'pass';
          })()`),
          ).toBe("pass");
          await browser.evaluate("window.renderPane('stacked')");
          await Bun.sleep(100);
          await Bun.write(
            join(tmpdir(), "pig-panes-stacked.png"),
            await browser.screenshot(),
          );
          passed = true;
        } finally {
          await browser.close();
        }
      } finally {
        server.stop(true);
      }
    } finally {
      if (passed) await removeFixtureDirectory(dir);
      else console.error(`Pane fixture retained: ${dir}`);
    }
  },
  60_000,
);
