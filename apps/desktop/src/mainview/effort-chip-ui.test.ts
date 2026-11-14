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
  "effort chips keep full labels, descenders and fixed widths inside picker triggers",
  () =>
    runUiFixture(
      "effort-chip",
      `
      const {createRoot}=await import(${fixtureImport(import.meta.resolve("react-dom/client"))});
      const {flushSync}=await import(${fixtureImport(import.meta.resolve("react-dom"))});
      const {EffortChip}=await import(${local("./EffortChip.tsx")});
      const {effortLabels}=await import(${local("../shared/effort.ts")});
      await import(${local("./styles.css")});
      ${fixtureHelpers}
      const root=createFixtureRoot(createRoot);
      const levels=['off','minimal','low','medium','high','xhigh','max'];
      const metrics=[];
      for(const scale of [1,1.25,1.5]) {
        document.documentElement.style.setProperty('--font-scale',String(scale));
        flushSync(()=>root.render(<div style={{padding:20}}>
          {levels.map(effort=><div key={effort} data-effort={effort} style={{display:'flex',gap:20,marginBottom:8}}>
            <details className="picker"><summary className="picker-trigger"><EffortChip levels={levels} effort={effort}/></summary></details>
            <button type="button" className="picker-trigger"><EffortChip levels={levels} effort={effort}/></button>
            <EffortChip levels={levels} effort={effort}/>
          </div>)}
        </div>));
        await document.fonts.ready;await wait();
        const chips=[...document.querySelectorAll('.picker-effort-label')];
        const widths=chips.map(chip=>chip.getBoundingClientRect().width);
        check(widths.every(w=>w===widths[0]),'all labels must reserve the same width at '+scale);
        for(const chip of chips) {
          const active=chip.querySelector('[data-active]');
          check(active.textContent===effortLabels[chip.closest('[data-effort]').dataset.effort],'chip must display the full effort name');
          check([...chip.children].filter(c=>getComputedStyle(c).visibility==='visible').length===1,'only the active effort label should be visible');
          check(getComputedStyle(chip).overflow==='visible','effort chips must not inherit text ellipsis');
        }
        const before=await capturePixels();
        // Compare against an unclipped copy at exactly the same pixel coordinates.
        for(const chip of chips) chip.style.overflow='visible';
        await wait();
        const reference=await capturePixels();
        for(const chip of chips) {
          const label=chip.querySelector('[data-active]').getBoundingClientRect();
          for(let y=Math.floor(label.top)-2;y<Math.ceil(label.bottom)+4;y++)
            for(let x=Math.floor(label.left)-2;x<Math.ceil(label.right)+2;x++)
              check(before(x,y).join()===reference(x,y).join(),'clipped effort label '+chip.querySelector('[data-active]').textContent+' at scale '+scale+' pixel '+x+','+y);
        }
        metrics.push({scale,width:widths[0],labels:chips.length});
      }
      for(const levels of [[],['high']]) {
        flushSync(()=>root.render(<EffortChip levels={levels} effort="high"/>));
        check(!document.querySelector('.picker-effort-label'),'models without an effort choice must not show a chip');
      }
      window.__fixtureMetrics=metrics;
      `,
      { viewport: { width: 640, height: 480 } },
    ),
  60_000,
);
