import { test } from "bun:test";
import { existsSync } from "node:fs";
import {
  fixtureEdge,
  fixtureHelpers,
  fixtureImport,
  runUiFixture,
} from "../../scripts/ui-fixture";

test.skipIf(!existsSync(fixtureEdge) && !process.env.PIG_REQUIRE_UI_TESTS)(
  "chat and project status dots keep their soft glow in every state",
  () =>
    runUiFixture(
      "session-status-glow",
      `
      const {createRoot}=await import(${fixtureImport(import.meta.resolve("react-dom/client"))});
      const {flushSync}=await import(${fixtureImport(import.meta.resolve("react-dom"))});
      await import(${fixtureImport(new URL("./styles.css", import.meta.url))});
      ${fixtureHelpers}
      const states=['running','completed','waiting','failed'];
      const root=createFixtureRoot(createRoot);
      flushSync(()=>root.render(<aside className="sidebar" style={{width:260,padding:32,gap:24}}>{['session-status-slot','project-activity'].flatMap(slot=>states.map(state=><div key={slot+state} style={{display:'flex',alignItems:'center',gap:16,height:32}}><span className={slot}><span className={'session-dot '+state}/></span><span>{slot}: {state}</span></div>))}</aside>));
      await wait();
      const dots=[...document.querySelectorAll('.session-dot')];
      for(const dot of dots){
        const style=getComputedStyle(dot);
        check(style.width==='6px'&&style.height==='6px','status must retain its dimensions');
        check(style.boxShadow!=='none','every status must keep a soft glow');
        if(dot.classList.contains('running')){
          check(style.animationName==='session-dot-breathe','only running status should breathe');
          const animation=dot.getAnimations()[0];
          animation.pause();animation.currentTime=0;
        }else{
          check(style.animationName==='none','non-running status must not pulse');
          check(style.backgroundColor===style.color,'glow and core must use the status color');
        }
      }
      await wait();
      const pixel=await capturePixels();
      for(const dot of dots){
        const bounds=dot.getBoundingClientRect();
        const y=bounds.top+bounds.height/2;
        const halo=pixel(bounds.right+2,y),background=pixel(bounds.right+9,y);
        check(halo.slice(0,3).some((value,index)=>Math.abs(value-background[index])>=2),'soft glow must be visible outside the dot: '+dot.className);
      }
      `,
    ),
  60_000,
);
