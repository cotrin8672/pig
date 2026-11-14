import { test } from "bun:test";
import { existsSync } from "node:fs";
import {
  fixtureEdge,
  fixtureHelpers,
  fixtureImport,
  runUiFixture,
} from "../../scripts/ui-fixture";

const local = (path: string) => fixtureImport(new URL(path, import.meta.url));

test.skipIf(!existsSync(fixtureEdge) && !process.env.PIG_REQUIRE_UI_TESTS)(
  "context indicator shows percentages instead of a dash before usage is available",
  () =>
    runUiFixture(
      "context-indicator",
      `
      const {createRoot}=await import(${fixtureImport(import.meta.resolve("react-dom/client"))});
      const {flushSync}=await import(${fixtureImport(import.meta.resolve("react-dom"))});
      const {ContextIndicator}=await import(${local("./ContextIndicator.tsx")});
      const {useStore}=await import(${local("./store.ts")});
      await import(${local("./styles.css")});
      ${fixtureHelpers}
      const root=createFixtureRoot(createRoot);
      for(const mode of ['used','remaining']) {
        flushSync(()=>useStore.setState(s=>({settings:{...s.settings,contextDisplay:mode,language:'en'}})));
        for(const usage of [undefined,null,{tokens:null,contextWindow:100000,percent:null},{tokens:0,contextWindow:100000,percent:0},{tokens:25000,contextWindow:100000,percent:25}]) {
          flushSync(()=>root.render(<ContextIndicator usage={usage}/>));
          await wait();
          const indicator=document.querySelector('.context-indicator');
          const expected=usage?.tokens===25000?(mode==='used'?25:75):(mode==='used'?0:100);
          check(indicator.textContent===expected+'%','numeric context in '+mode+' mode: '+indicator.textContent);
          const ring=indicator.querySelectorAll('circle')[1];
          check(ring.getAttribute('stroke-dasharray')===expected+' 100','ring matches the label');
          check(ring.getAttribute('opacity')===(expected?'1':'0'),'empty ring stays empty');
          if(usage?.tokens===null) check(indicator.getAttribute('aria-label').includes('next response'),'pending usage remains explained accessibly');
        }
      }
      `,
    ),
  60_000,
);
