import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import { build } from "vite";
import { fixtureBrowser } from "../../scripts/ui-browser";
import { codexUsage } from "../bun/usage/adapters/subscriptions";
import { usageFromHeaders } from "../bun/usage/observation";

const edge =
  process.env.PIG_UI_BROWSER ??
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
test.skipIf(!existsSync(edge) && !process.env.PIG_REQUIRE_UI_TESTS)(
  "provider usage in Edge: framed bars, sidebar widths, preference, alpha and scroll",
  async () => {
    if (!existsSync(edge)) throw new Error("Required UI browser is missing");
    // Vite's root must be the long path: CI's tmpdir() is an 8.3 short name.
    const dir = await realpath(await mkdtemp(join(tmpdir(), "pig-usage-ui-")));
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
          check(getComputedStyle(viewport).overflowX==='hidden','usage list never shows a horizontal scrollbar');
          const firstName=card.querySelector('.provider-usage-name').getBoundingClientRect();
          const firstIcon=card.querySelector('.provider-usage-row svg').getBoundingClientRect();
          check(firstName.width>35,'account identity must retain readable space');
          check(firstName.left-firstIcon.right>=4,'icon and account name keep a gap');
          const rows=[...card.querySelectorAll('.provider-usage-row')];
          check(rows.every(r=>r.getBoundingClientRect().height>=22),'row height');
          const bars=[...card.querySelectorAll('.provider-usage-bar')];
          check(bars.every(b=>b.getBoundingClientRect().height===8),'8px bars');
          check(bars.every(b=>b.getBoundingClientRect().width>20),'bars keep a readable width in every dock width');
          const percents=[...card.querySelectorAll('.provider-usage-percent')];
          const percentText=p=>p.textContent;
          check(percents.length===bars.length&&percents.every(p=>percentText(p).endsWith('%')&&Number.isFinite(parseFloat(percentText(p)))),'every bar carries its own percentage');
          check(percents.every(p=>p.scrollWidth<=p.clientWidth+1),'percentages are never clipped');
          check(!card.querySelector('.provider-usage-reset'),'reset time is drawn by the frame, not written in the row');
          check([...card.querySelectorAll('.provider-usage-window')].every(w=>w.textContent.trim()===w.querySelector('.provider-usage-percent').textContent.trim()),'a line holds only its bar and percentage');
          const labels=()=>[...document.querySelectorAll('.provider-usage-row')].map(r=>r.getAttribute('aria-label')).join('|');
          check(labels().includes('12%'),'remaining is default');
          check(labels().includes('1h 12m'),'reset countdown stays available to assistive tech');
          const codex=[...card.querySelectorAll('.provider-usage-row')].find(r=>r.querySelector('.provider-usage-name').textContent==='Work');
          check(codex.querySelectorAll('.provider-usage-window').length===2,'two limits take two lines');
          check(codex.getBoundingClientRect().height>rows.find(r=>r.querySelectorAll('.provider-usage-window').length===1).getBoundingClientRect().height,'two-limit rows grow by exactly one line');
          const codexQuota=[...codex.querySelectorAll('.provider-usage-window')].map(w=>w.style.getPropertyValue('--usage-quota'));
          check(codexQuota.join('|')==='12%|64%','shortest window first, quota follows the display preference');
          check(card.querySelector('.provider-usage-toggle').textContent===(language==='en'?'Usage':'使用量'),'heading must not show display mode or summary');
          check(!card.querySelector('.provider-usage-heading small'),'heading must not show an age timer');
          const names=[...card.querySelectorAll('.provider-usage-name')].map(n=>n.textContent);
          check(names.join('|')==='Anthropic|DeepSeek|Mistral Vibe|Personal|Work|OpenRouter|Qwen CLI|Vercel','stable alphabetical account order, shared provider prefix dropped');
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
        const mistral=usageFixtures.find(e=>e.provider==='mistral');
        const monthly=mistral.data.windows[0];
        const mistralTime=parseFloat(mistralRow.querySelector('.provider-usage-window').style.getPropertyValue('--usage-time'));
        check(Math.abs(mistralTime-(monthly.resetsAt-usageFixtureTime)/monthly.durationMs*100)<0.001,'Mistral frame shows remaining monthly time');
        render(usageFixtures,'used',240);
        const usedRow=[...document.querySelectorAll('.provider-usage-row')].find(r=>r.querySelector('.provider-usage-name').textContent==='Mistral Vibe');
        check(parseFloat(usedRow.querySelector('.provider-usage-window').style.getPropertyValue('--usage-time'))===mistralTime,'quota preference must not reverse time');
        check(usedRow.querySelector('.provider-usage-percent').textContent==='52%','used preference flips the percentage in the row');
        // A reset further away than the window is long clamps instead of overflowing the frame.
        const work=usageFixtures.find(e=>e.label==='OpenAI Work');
        const longReset={...work,data:{...work.data,windows:work.data.windows.map(w=>({...w,resetsAt:usageFixtureTime+(18*60+44)*60000}))}};
        for(const width of [156,210,240,320]){
          render([longReset,...usageFixtures.filter(e=>e!==work)],'remaining',width);
          const list=document.querySelector('.provider-usage-list');
          check(list.scrollWidth<=list.clientWidth+1,'long resets must fit without horizontal scrolling');
          const times=[...list.querySelectorAll('.provider-usage-window')].map(w=>parseFloat(w.style.getPropertyValue('--usage-time')));
          check(times.every(t=>t>=0&&t<=100),'frame time is clamped to the bar');
          check([...list.querySelectorAll('.provider-usage-percent')].every(p=>p.scrollWidth<=p.clientWidth+1),'percentages are not clipped');
        }
        // Both API snapshots and live response headers omit non-existent Codex limits.
        const codexSources=${JSON.stringify([
          codexUsage({
            rate_limit: {
              primary_window: {
                used_percent: 79,
                limit_window_seconds: 604800,
              },
              secondary_window: {
                used_percent: 0,
                limit_window_seconds: 0,
              },
            },
          }),
          usageFromHeaders(
            "openai-codex",
            {
              "x-codex-primary-used-percent": "79",
              "x-codex-primary-window-minutes": "10080",
              "x-codex-secondary-used-percent": "0",
              "x-codex-secondary-window-minutes": "0",
              "x-codex-secondary-reset-after-seconds": "0",
            },
            0,
          ),
        ])};
        for(const data of codexSources){
          render([{...work,data}],'remaining',240);
          const row=document.querySelector('.provider-usage-row');
          check(row.querySelectorAll('.provider-usage-window').length===1,'absent Codex window must not create a second bar');
          check(row.querySelector('.provider-usage-percent').textContent==='21%','valid weekly quota stays visible');
          check(!row.getAttribute('aria-label').includes('secondary'),'absent slot must not leak into the tooltip label');
          await new Promise(resolve=>setTimeout(resolve,30));
          flushSync(()=>row.dispatchEvent(new PointerEvent('pointerover',{bubbles:true})));
          await new Promise(resolve=>setTimeout(resolve,30));
          const popup=document.querySelector('.usage-popover');
          check(popup?.querySelectorAll('.usage-popover-window').length===1 && !popup.textContent.includes('secondary'),'popover must also omit the placeholder: '+(popup?.textContent??'not open'));
          document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'}));
          await new Promise(resolve=>setTimeout(resolve,30));
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
