import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import { build } from "vite";
import { fixtureBrowser } from "../../scripts/ui-browser";

const edge =
  process.env.PIG_UI_BROWSER ??
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
test.skipIf(!existsSync(edge) && !process.env.PIG_REQUIRE_UI_TESTS)(
  "provider usage in Edge: real 18px rings, sidebar widths, preference, alpha and scroll",
  async () => {
    if (!existsSync(edge)) throw new Error("Required UI browser is missing");
    const dir = await mkdtemp(join(tmpdir(), "pig-usage-ui-"));
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
      import {ProviderUsageView} from ${source("./ProviderUsageView.tsx")};
      import {useStore} from ${source("./store.ts")};
      import {usageFixtures,usageFixtureTime} from ${source("../stories/providers/usage-fixtures.ts")};
      import ${source("./styles.css")};
      (async () => { try {
        const check=(ok,message)=>{if(!ok)throw Error(message)};
        const root=createRoot(document.getElementById('root'));
        const render=(entries,display,width,refreshing=false,onRefresh=undefined)=>flushSync(()=>root.render(<div style={{width}}><ProviderUsageView entries={entries} display={display} now={usageFixtureTime} refreshing={refreshing} onRefresh={onRefresh}/></div>));
        for(const language of ['en','ja'])for(const width of [156,240,210,320]){
          useStore.setState(s=>({settings:{...s.settings,language}}));
          render(usageFixtures,'remaining',width);
          const card=document.querySelector('.provider-usage-card');
          check(card.getBoundingClientRect().width===width,'dock must follow sidebar width');
          const viewport=card.querySelector('.provider-usage-list');
          check(viewport.scrollWidth<=viewport.clientWidth+1,'narrow dock must not require horizontal scrolling');
          check(card.querySelector('.provider-usage-name').getBoundingClientRect().width>35,'account identity must retain readable space');
          check([...card.querySelectorAll('.provider-usage-row')].every(r=>r.getBoundingClientRect().height===22),'row height');
          check([...card.querySelectorAll('.provider-usage-ring')].every(r=>r.getBoundingClientRect().width===18&&r.getBoundingClientRect().height===18),'18px rings');
          check(card.textContent.includes('1h 12m'),'compact reset independent of language');
          const labels=()=>[...document.querySelectorAll('.provider-usage-row')].map(r=>r.getAttribute('aria-label')).join('|');
          check(labels().includes('12%'),'remaining is default');
          check(!/d%/.test(card.textContent),'percent lives in the tooltip, not the row');
          const codex=[...card.querySelectorAll('.provider-usage-row')].find(r=>r.querySelector('.provider-usage-name').textContent==='OpenAI Work');
          if(width>180)check([...codex.querySelectorAll('.provider-usage-reset')].map(r=>r.textContent).join('|')==='1h 12m|11/17','shortest window first, each ring with its own reset');
          check(card.querySelector('.provider-usage-toggle').textContent===(language==='en'?'Usage':'使用量'),'heading must not show display mode or summary');
          check(!card.querySelector('.provider-usage-heading small'),'heading must not show an age timer');
          const names=[...card.querySelectorAll('.provider-usage-name')].map(n=>n.textContent);
          check(names.join('|')==='Anthropic|DeepSeek|Mistral Vibe|OpenAI Personal|OpenAI Work|OpenRouter|Qwen CLI|Vercel','stable alphabetical account order');
          check(!card.textContent.includes('Claude CLI'),'Anthropic is not duplicated as Claude CLI');
          const canvas=document.createElement('canvas');canvas.width=canvas.height=1;
          const ctx=canvas.getContext('2d');ctx.fillStyle=getComputedStyle(card).backgroundColor;ctx.fillRect(0,0,1,1);
          const alpha=ctx.getImageData(0,0,1,1).data[3];
          check(alpha>0&&alpha<255&&getComputedStyle(card).opacity==='1','translucent card, opaque content');
          render(usageFixtures,'used',width);
          check(labels().includes('88%'),'used preference');
          const stale=usageFixtures.map(e=>({...e,status:'error',problem:'network'}));
          render(stale,'used',width);
          check(labels().includes('88%'),'failed refresh retains last value');
          render(Array.from({length:40},(_,i)=>({...usageFixtures[0],key:'account-'+i})),'remaining',width);
          const list=document.querySelector('.provider-usage-list');
          check(list.scrollHeight>list.clientHeight,'accounts must scroll in dock');
          list.scrollTop=list.scrollHeight;
          check(list.lastElementChild.getBoundingClientRect().bottom<=list.getBoundingClientRect().bottom+1,'last account reachable');
        }
        render(usageFixtures,'remaining',240);
        const mistralRow=[...document.querySelectorAll('.provider-usage-row')].find(r=>r.querySelector('.provider-usage-name').textContent==='Mistral Vibe');
        const timeRing=mistralRow.querySelector('.usage-ring-time');
        const mistral=usageFixtures.find(e=>e.provider==='mistral');
        const monthly=mistral.data.windows[0];
        check(timeRing&&Math.abs(parseFloat(timeRing.getAttribute('stroke-dasharray'))-(monthly.resetsAt-usageFixtureTime)/monthly.durationMs*100)<0.001,'Mistral outer ring shows remaining monthly time');
        const timeDash=timeRing.getAttribute('stroke-dasharray');
        for(const ring of document.querySelectorAll('.usage-ring-time,.usage-ring-quota')){
          const matrix=ring.transform.baseVal.consolidate().matrix;
          const start=ring.getPointAtLength(0).matrixTransform(matrix);
          const quarter=ring.getPointAtLength(ring.getTotalLength()/4).matrixTransform(matrix);
          check(Math.abs(start.x-9)<0.05&&start.y<9,'rings start at twelve oclock');
          check(quarter.x<9&&Math.abs(quarter.y-9)<0.05,'both rings run counterclockwise');
        }
        render(usageFixtures,'used',240);
        check([...document.querySelectorAll('.provider-usage-row')].find(r=>r.querySelector('.provider-usage-name').textContent==='Mistral Vibe').querySelector('.usage-ring-time').getAttribute('stroke-dasharray')===timeDash,'quota preference must not reverse time');
        const dates=[new Date(2027,0,9).getTime(),new Date(2026,10,18).getTime(),new Date(2026,11,1).getTime()];
        const dateEntries=dates.map((resetsAt,i)=>({...mistral,key:'date-'+i,label:'Date '+i,data:{windows:[{...monthly,resetsAt}],balances:[]}}));
        for(const width of [156,210,240,320]){
          render(dateEntries,'remaining',width);
          const resets=[...document.querySelectorAll('.provider-usage-reset')];
          if(width<=180){
            check(resets.every(r=>getComputedStyle(r).display==='none'),'date grid stays hidden in narrow dock');
            continue;
          }
          check(resets.map(r=>r.textContent).join('|')==='1/9|11/18|12/1','date format remains unpadded');
          const slashes=resets.map(r=>r.children[1].getBoundingClientRect().x);
          check(Math.max(...slashes)-Math.min(...slashes)<0.1,'date slash columns align for one and two digit months and days');
        }
        let refreshes=0;
        const refresh=()=>{refreshes++};
        render(usageFixtures,'remaining',240,false,refresh);
        const button=document.querySelector('.provider-usage-refresh');
        const before=button.getBoundingClientRect();
        check(!button.disabled,'refresh initially available');
        flushSync(()=>button.click());
        check(refreshes===1&&button.disabled,'refresh click enters cooldown');
        button.click();
        check(refreshes===1,'cooldown blocks repeated refresh');
        render(usageFixtures,'remaining',240,true,refresh);
        check(button.disabled&&button.querySelector('.spinner'),'refresh spins only while fetching');
        render(usageFixtures,'remaining',240,false,refresh);
        check(button.disabled&&!button.querySelector('.spinner'),'cooldown disables without spinning');
        await new Promise(resolve=>setTimeout(resolve,10100));
        check(!button.disabled,'refresh re-enabled after cooldown');
        const after=button.getBoundingClientRect();
        check(before.x===after.x&&before.y===after.y&&before.width===after.width,'refresh state must not move layout');
        flushSync(()=>document.querySelector('.provider-usage-toggle').click());
        check(!document.querySelector('.provider-usage-list'),'collapse hides list');
        check(document.querySelector('.provider-usage-toggle').textContent==='使用量','collapsed heading has no summary');
        flushSync(()=>document.querySelector('.provider-usage-toggle').click());
        document.body.dataset.usageResult='pass';
      } catch(error) {document.body.dataset.usageResult='fail';document.body.dataset.usageError=String(error);} })();
    `,
      );
      const cssFiles = new Set<string>();
      const compiled = await Bun.build({
        entrypoints: [entry],
        target: "browser",
        minify: true,
        define: { "process.env.NODE_ENV": '"production"' },
        plugins: [
          {
            name: "styles",
            setup(b) {
              b.onResolve({ filter: /^react\/jsx-runtime$/ }, () => ({
                path: fileURLToPath(import.meta.resolve("react/jsx-runtime")),
              }));
              b.onLoad({ filter: /\.css$/ }, ({ path }) => {
                cssFiles.add(path);
                return { loader: "js", contents: "" };
              });
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
        for (let i = 0; i < 1000; i++) {
          result = await browser.evaluate(
            "({result:document.body?.dataset.usageResult,error:document.body?.dataset.usageError})",
          );
          if (result.result) break;
          await Bun.sleep(25);
        }
        await Bun.write(join(dir, "usage.png"), await browser.screenshot());
        expect(result.result, result.error ?? "fixture did not finish").toBe(
          "pass",
        );
        expect((await readFile(join(dir, "usage.png"))).length).toBeGreaterThan(
          1000,
        );
        passed = true;
      } finally {
        await browser.close();
      }
    } finally {
      if (passed) {
        await rm(dir, {
          recursive: true,
          force: true,
          maxRetries: 10,
          retryDelay: 200,
        }).catch(() => {});
      } else console.error(`Usage rendering fixture retained: ${dir}`);
    }
  },
  60_000,
);
