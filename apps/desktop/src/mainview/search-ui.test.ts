import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import { build } from "vite";
import { renderWorkerFixturePlugin } from "../../scripts/render-worker-fixture";
import { fixtureBrowser } from "../../scripts/ui-browser";

const edge =
  process.env.PIG_UI_BROWSER ??
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";

test.skipIf(!existsSync(edge) && !process.env.PIG_REQUIRE_UI_TESTS)(
  "search palette in Edge: fixed list, keyboard, content hits, settings and message jumps",
  async () => {
    if (!existsSync(edge)) throw new Error("Required UI browser is missing");
    const dir = await mkdtemp(join(tmpdir(), "pig-search-ui-"));
    let passed = false;
    const source = (path: string) =>
      JSON.stringify(fileURLToPath(new URL(path, import.meta.url)));
    try {
      const entry = join(dir, "fixture.tsx");
      await Bun.write(
        entry,
        `
      import {createRoot} from ${JSON.stringify(fileURLToPath(import.meta.resolve("react-dom/client")))};
      import {flushSync} from ${JSON.stringify(fileURLToPath(import.meta.resolve("react-dom")))};
      import {SearchPalette} from ${source("./SearchPalette.tsx")};
      import {Settings} from ${source("./Settings.tsx")};
      import {Chat} from ${source("./App.tsx")};
      import {useStore} from ${source("./store.ts")};
      import {settingTargets,settingsCategories} from ${source("./settings-search.ts")};
      import {en,ja} from ${source("../shared/i18n.ts")};
      import ${source("./styles.css")};
      (async () => { try {
        const check=(ok,message)=>{if(!ok)throw Error(message)};
        const wait=()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
        const until=async(predicate,message)=>{const end=performance.now()+4000;while(!predicate()){check(performance.now()<end,message);await wait();}};
        const root=createRoot(document.getElementById('root'),{onUncaughtError:error=>{document.body.dataset.searchRenderError=String(error?.stack??error);}});
        const general='C:/work/general';
        const calls=[];
        window.__requests={
          searchConversations:async p=>{calls.push(p);return {indexing:calls.length<3,hits:p.query.includes('scroll')?[{sessionId:'chat-3',cwd:general,entryId:'e1',role:'assistant',timestamp:5,snippet:'…fixed the Scrollbar inset in tool output…'}]:[]};},
          listFontFamilies:async()=>[],
          listSlashCommands:async()=>[],
          getPiData:async()=>({agentDir:'C:/agent',sessionDir:'C:/agent/sessions',modelsFile:'C:/agent/models.json',authState:'ok'}),
        };
        const sessions={[general]:Array.from({length:60},(_,i)=>({id:'chat-'+i,cwd:general,title:'Chat number '+i,modified:1000-i}))};
        useStore.setState(s=>({initialized:true,sessions,bootstrap:{...s.bootstrap,generalCwd:general,projects:['C:/work/pig']},settings:{...s.settings,language:'en'},appUpdate:{version:'0.6.0',method:'disabled',status:'idle'}}));
        flushSync(()=>root.render(<><Settings/><SearchPalette/></>));
        for(const category of settingsCategories){
          flushSync(()=>useStore.setState({settingsCategory:category.id}));
          await until(()=>settingTargets.filter(t=>t.category===category.id).every(t=>document.querySelector('[data-setting="'+t.id+'"]')),'every '+category.id+' search target must be rendered');
        }

        flushSync(()=>useStore.setState({searchOpen:true}));await wait();
        const dialog=document.querySelector('.search-palette');
        check(dialog?.open&&dialog.matches(':modal'),'palette opens as a modal dialog');
        const input=dialog.querySelector('input');
        check(document.activeElement===input,'input is focused');
        const list=dialog.querySelector('.search-results');
        const options=()=>[...list.querySelectorAll('[role=option]')];
        const titles=()=>options().map(o=>o.querySelector('.search-title').textContent);
        check(options().length===20&&titles()[0]==='Chat number 0','empty query lists recent chats, newest first');
        const canvas=document.createElement('canvas');canvas.width=canvas.height=1;
        const ctx=canvas.getContext('2d');ctx.fillStyle=getComputedStyle(dialog).backgroundColor;ctx.fillRect(0,0,1,1);
        const alpha=ctx.getImageData(0,0,1,1).data[3];
        check(alpha>0&&alpha<255&&getComputedStyle(dialog).opacity==='1','translucent palette, opaque content');
        const listHeight=list.getBoundingClientRect().height;
        const dialogRect=dialog.getBoundingClientRect();
        const same=()=>{const r=dialog.getBoundingClientRect();return Math.abs(list.getBoundingClientRect().height-listHeight)<0.5&&Math.abs(r.height-dialogRect.height)<0.5&&Math.abs(r.top-dialogRect.top)<0.5;};
        check(list.scrollHeight>list.clientHeight,'long result lists scroll inside the palette');
        list.scrollTop=list.scrollHeight;await wait();
        check(options().at(-1).getBoundingClientRect().bottom<=list.getBoundingClientRect().bottom+1,'last result reachable');
        list.scrollTop=0;
        await until(()=>calls.length>0,'content search requested');
        check(calls[0].refresh===true&&calls[0].query==='','opening rescans chats once');
        await until(()=>dialog.textContent.includes(en.searchIndexing),'indexing status shown');
        check(same(),'indexing status does not move the palette');
        await until(()=>!dialog.textContent.includes(en.searchIndexing),'indexing status clears after polling');
        check(calls.slice(1).every(c=>!c.refresh),'only the first request rescans');

        const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;
        const type=async value=>{setter.call(input,value);input.dispatchEvent(new Event('input',{bubbles:true}));await wait();};
        const key=async k=>{input.dispatchEvent(new KeyboardEvent('keydown',{key:k,bubbles:true,cancelable:true}));await wait();};
        const selected=()=>list.querySelector('[aria-selected=true] .search-title')?.textContent;
        await type('zzzzqqq');
        check(options().length===0,'unexpected results: '+titles().join('|'));
        await until(()=>list.querySelector('.search-empty'),'no results message');
        check(same(),'empty results keep the palette size');
        await type('win op');
        check(titles()[0]==='Window opacity'&&list.querySelectorAll('.search-match').length>0,'fuzzy words match and highlight a setting');
        check(same(),'filtered results keep the palette size');
        await type('chat number 1');
        check(selected()==='Chat number 1','first result is selected');
        await key('ArrowUp');
        check(selected()===titles().at(-1),'ArrowUp wraps to the last result');
        await key('ArrowDown');
        check(selected()==='Chat number 1','ArrowDown wraps to the first result');
        check(input.getAttribute('aria-activedescendant')===list.querySelector('[aria-selected=true]').id,'active option is announced');
        await type('scroll');
        await until(()=>list.querySelector('[data-kind=message]'),'message hits are listed');
        const hit=list.querySelector('[data-kind=message]');
        check(hit.querySelector('.search-match').textContent==='Scroll'&&hit.querySelector('.search-detail').textContent==='Chat number 3','message hit shows matched text and its chat');
        flushSync(()=>useStore.setState(s=>({settings:{...s.settings,language:'ja'}})));
        await type('opacity');
        check(titles()[0]===ja['Window opacity'],'English terms find settings in the Japanese UI');
        flushSync(()=>useStore.setState(s=>({settings:{...s.settings,language:'en'}})));

        await type('window opacity');
        await key('Enter');
        check(!document.querySelector('.search-palette'),'choosing a result closes the palette');
        check(useStore.getState().settingsCategory==='appearance','setting result opens its category');
        await until(()=>document.querySelector('[data-setting="window-opacity"]')?.classList.contains('search-target'),'setting row is marked');
        check(document.activeElement?.id==='window-opacity'&&useStore.getState().settingsFocus===undefined,'setting control is focused');

        flushSync(()=>useStore.setState({searchOpen:true}));await wait();
        document.querySelector('.search-palette').dispatchEvent(new Event('cancel',{cancelable:true}));await wait();
        check(!document.querySelector('.search-palette'),'Escape closes the palette');

        const record=(id,order)=>({id,entryId:id,parentId:null,branchId:'b',order,kind:'message',message:{role:'user',content:'Question '+order+' '+'words '.repeat(30),timestamp:order}});
        const page=(from,to,before)=>({records:Array.from({length:to-from},(_,i)=>record('r'+(from+i),from+i)),tools:{},history:{revision:'b',...(before?{before}:{})},current:null,running:false,liveToEntry:{}});
        const history=[];
        window.__requests.getSessionHistory=async p=>{history.push(p.before);return p.before==='r100'?page(50,100,'r50'):page(0,50);};
        const snapshot={address:{hostId:'ui',sessionId:'chat',epoch:1},snapshotSeq:1,info:{id:'chat',cwd:general,title:'Fixture',modified:1},effort:'off',effortLevels:[],ready:true,transcript:page(100,150,'r100')};
        function StoredChat(){const value=useStore(s=>s.snapshots.chat);return <Chat snapshot={value}/>;}
        flushSync(()=>useStore.setState({snapshots:{chat:snapshot},jump:{sessionId:'chat',entryId:'r5',nonce:1}}));
        flushSync(()=>root.render(<div style={{height:'600px',display:'flex'}}><StoredChat/></div>));
        await until(()=>document.querySelector('[data-record-id="r5"]')?.classList.contains('search-target'),'message jump loads earlier history and marks the message');
        check(history.join(',')==='r100,r50','history pages are fetched until the message is found');
        const thread=document.querySelector('.thread-scroll').getBoundingClientRect();
        const target=document.querySelector('[data-record-id="r5"]').getBoundingClientRect();
        check(target.top>=thread.top-1&&target.top<thread.bottom,'message is scrolled into view');
        check(useStore.getState().jump===undefined,'jump request is consumed');
        flushSync(()=>useStore.setState({jump:{sessionId:'chat',entryId:'missing',nonce:2}}));
        await until(()=>useStore.getState().notices.some(n=>n.message===en.searchMessageMissing),'missing message is reported through notifications');
        check(useStore.getState().jump===undefined&&history.length===2,'missing message stops without more history requests');

        flushSync(()=>root.render(<SearchPalette/>));
        flushSync(()=>useStore.setState({searchOpen:true}));await wait();
        const last=document.querySelector('.search-palette input');
        setter.call(last,'scroll');last.dispatchEvent(new Event('input',{bubbles:true}));
        await until(()=>document.querySelector('.search-palette [data-kind=message]'),'final screenshot shows a content hit');
        document.body.dataset.searchResult='pass';
      } catch(error) {document.body.dataset.searchResult='fail';document.body.dataset.searchError=String(error?.stack??error)+(document.body.dataset.searchRenderError?'\\nRender error: '+document.body.dataset.searchRenderError:'');} })();
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
            name: "isolated-host",
            setup(b) {
              b.onResolve({ filter: /^react\/jsx-runtime$/ }, () => ({
                path: fileURLToPath(import.meta.resolve("react/jsx-runtime")),
              }));
              b.onLoad({ filter: /\.css$/ }, ({ path }) => {
                cssFiles.add(path);
                return { loader: "js", contents: "" };
              });
              b.onLoad({ filter: /[\\/]rpc\.ts$/ }, () => ({
                loader: "ts",
                contents: `
          const noop=()=>{};export const rpc={request:new Proxy({},{get:(_,method)=>async params=>window.__requests?.[method]?window.__requests[method](params):{}}),send:new Proxy({},{get:()=>noop})};
          export const sends={subscribe:()=>noop,getTick:()=>0,read:()=>undefined,optimistic:()=>[],queued:()=>[],retained:()=>[],send:async()=>{}};
          export const updateAppearance=noop,updateSettings=noop,updateUiPreferences=noop,refreshSessions=noop,refresh=()=>Promise.resolve(),requestSelection=(_address,request)=>request(),connectRuntime=noop,initRuntimeConnection=noop,cancelOpening=noop,openChat=noop,showPendingOpen=noop,openChatLink=noop,forkChat=noop,regenerate=noop,initSessionLinks=noop,initSessionReadTracking=noop,reconnectRuntime=noop;
        `,
              }));
            },
          },
        ],
      });
      expect(compiled.success, compiled.logs.map(String).join("\n")).toBe(true);
      await Bun.write(
        join(dir, "fixture.js"),
        await compiled.outputs[0].text(),
      );
      const css = join(dir, "source.css");
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
      const browser = await fixtureBrowser(edge, dir, pathToFileURL(html).href);
      try {
        let result: { result?: string; error?: string } = {};
        for (let i = 0; i < 1200; i++) {
          result = await browser.evaluate(
            "({result:document.body?.dataset.searchResult,error:document.body?.dataset.searchError})",
          );
          if (result.result) break;
          await Bun.sleep(25);
        }
        await Bun.write(join(dir, "search.png"), await browser.screenshot());
        expect(result.result, result.error ?? "fixture did not finish").toBe(
          "pass",
        );
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
      else console.error(`Search rendering fixture retained: ${dir}`);
    }
  },
  90_000,
);
