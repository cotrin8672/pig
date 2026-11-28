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
  "chat and project status dots keep their soft glow in every state",
  () =>
    runUiFixture(
      "session-status-glow",
      `
      const {createRoot}=await import(${fixtureImport(import.meta.resolve("react-dom/client"))});
      const {flushSync}=await import(${fixtureImport(import.meta.resolve("react-dom"))});
      await import(${local("./styles.css")});
      const {IndicatorDot}=await import(${local("./IndicatorDot.tsx")});
      ${fixtureHelpers}
      const states=['running','completed','waiting','failed'];
      const root=createFixtureRoot(createRoot);
      flushSync(()=>root.render(<aside className="sidebar" style={{width:260,padding:32,gap:24}}>{['session-status-slot','project-activity'].flatMap(slot=>states.map(state=><div key={slot+state} style={{display:'flex',alignItems:'center',gap:16,height:32}}><span className={slot}><IndicatorDot state={state}/></span><span>{slot}: {state}</span></div>))}</aside>));
      await wait();
      const dots=[...document.querySelectorAll('.session-dot')];
      for(const dot of dots){
        const style=getComputedStyle(dot);
        check(style.width==='6px'&&style.height==='6px','status must retain its dimensions');
        check(style.boxShadow!=='none','every status must keep a soft glow');
        if(dot.classList.contains('running')){
          check(style.animationName==='session-dot-breathe','only running status should breathe');
          const animation=dot.getAnimations()[0];
          // Compositor-only: box-shadow keyframes restyle the page every frame while a chat runs.
          const animated=new Set(animation.effect.getKeyframes().flatMap(frame=>Object.keys(frame).filter(key=>!['offset','computedOffset','easing','composite'].includes(key))));
          check([...animated].every(key=>key==='opacity'||key==='transform'),'running dot must animate only compositor properties: '+[...animated]);
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

test.skipIf(!existsSync(fixtureEdge) && !process.env.PIG_REQUIRE_UI_TESTS)(
  "composer counters keep one aligned top-layer panel per group and close when dismissed",
  () =>
    runUiFixture(
      "composer-counter-popovers",
      `
      const {createRoot}=await import(${fixtureImport(import.meta.resolve("react-dom/client"))});
      const {flushSync}=await import(${fixtureImport(import.meta.resolve("react-dom"))});
      const {SessionIndicators}=await import(${local("./SessionIndicators.tsx")});
      const {SessionPanel}=await import(${local("./SessionPanel.tsx")});
      const {addressKey}=await import(${local("./chat-snapshot.ts")});
      const {useStore}=await import(${local("./store.ts")});
      await import(${local("./styles.css")});
      ${fixtureHelpers}
      const root=createFixtureRoot(createRoot);
      const address={hostId:'fixture',sessionId:'counters',epoch:1},key=addressKey(address);
      const statuses=[{key:'lint',text:'Lint warning'}],widgets=[{key:'plan',lines:['Next step']}];
      useStore.setState({extensionStatuses:{[key]:{statuses,widgets}}});
      flushSync(()=>root.render(<form className="composer" style={{position:'fixed',left:24,top:480,width:380}}>
        <SessionPanel configError="Missing config" initialTab="info" onAction={async()=>{}} onReload={async()=>{}}/>
        <SessionIndicators address={address}/>
      </form>));
      const form=document.querySelector('form'),activity=form.querySelector('.session-panel');
      const panel=form.querySelector('.session-indicators [role="dialog"]');
      const [status,widget]=form.querySelectorAll('.session-indicators button');
      const aligned=p=>{
        const frame=form.getBoundingClientRect(),popup=p.getBoundingClientRect();
        return Math.abs(popup.left-frame.left)<1&&Math.abs(popup.right-frame.right)<1&&Math.abs(frame.top-popup.bottom-8)<1;
      };
      await until(()=>activity.matches(':popover-open'),'the initial section opens on mount');
      check(aligned(activity)&&activity.style.maxHeight==='420px','activity preserves its own height limit and matches the composer');
      widget.click();
      await until(()=>panel.matches(':popover-open')&&panel.textContent.includes('Next step'),'widget opens its panel');
      check(!activity.matches(':popover-open')&&panel.style.maxHeight==='360px'&&aligned(panel),'opening the other group light-dismisses activity');
      status.click();await wait();
      check(panel.matches(':popover-open')&&panel.textContent.includes('Lint warning')&&!panel.textContent.includes('Next step'),'switching counters reuses the panel');
      form.style.width='270px';
      await until(()=>aligned(panel),'the panel follows a pane-only width change');
      status.click();await wait();
      check(!panel.matches(':popover-open')&&status.getAttribute('aria-expanded')==='false','clicking the same counter closes it');
      status.click();await wait();
      flushSync(()=>useStore.setState({extensionStatuses:{[key]:{statuses:[],widgets}}}));
      await until(()=>!panel.matches(':popover-open'),'removing the active section hides the panel');
      `,
      { viewport: { width: 680, height: 640 } },
    ),
  60_000,
);

test.skipIf(!existsSync(fixtureEdge) && !process.env.PIG_REQUIRE_UI_TESTS)(
  "the live agent chip appears in the Composer before spawn returns",
  () =>
    runUiFixture(
      "composer-agent-start",
      `
      const {createRoot}=await import(${fixtureImport(import.meta.resolve("react-dom/client"))});
      const {flushSync}=await import(${fixtureImport(import.meta.resolve("react-dom"))});
      const {Composer}=await import(${local("./Composer.tsx")});
      await import(${local("./styles.css")});
      ${fixtureHelpers}
      window.__requests={listSlashCommands:async()=>[]};
      const root=createFixtureRoot(createRoot);
      const address={hostId:'ui',sessionId:'agents',epoch:1};
      const base={address,snapshotSeq:1,info:{id:'agents',cwd:'fixture',title:'Agents',modified:1},effort:'off',effortLevels:[],ready:true,modelCatalog:[],transcript:{records:[],tools:{},history:{revision:'branch'},current:null,running:true,liveToEntry:{}}};
      const startedAt=new Date().toISOString();
      const state=phase=>phase?{generation:'gen',commands:[],keymaps:[],diagnostics:[],views:[{
        adapterId:'pig:codex-subagents',revision:phase==='queued'?1:2,view:{id:'codex-subagents',kind:'agents',title:'Subagents',
          source:{scope:{kind:'session',id:address.sessionId},label:'@ogulcancelik/pi-codex-subagents',freshness:'live'},
          runs:[{id:'spawn',title:'review',startedAt,state:{phase}}]}
      }]}:undefined;
      const render=phase=>flushSync(()=>root.render(<div className="chat-shell" style={{height:'80vh',width:420,justifyContent:'end'}}><Composer snapshot={{...base,sessionUI:state(phase)}}/></div>));
      const chip=()=>document.querySelector('.composer-session button[data-tab="tasks"]');
      const layout=()=>['.composer','.composer-pickers','.send-controls'].map(selector=>JSON.stringify(document.querySelector(selector).getBoundingClientRect())).join();
      render();
      await wait();
      check(!chip(),'no chip before the spawn event');
      const before=layout();
      render('queued');
      const queued=chip();
      check(queued?.textContent==='1'&&queued.dataset.live==='false','one chip must be visible before any tool result');
      check(layout()===before,'the chip must not move the Composer, model picker or send controls');
      const bounds=queued.getBoundingClientRect();
      check(document.elementFromPoint(bounds.x+bounds.width/2,bounds.y+bounds.height/2)?.closest('button')===queued,'the queued chip is clickable in the toolbar');
      queued.click();
      await until(()=>document.querySelector('.session-panel:popover-open [data-state="queued"]')?.textContent.includes('review'),'waiting agent is listed by name');
      render('running');
      check(chip()===queued&&queued.dataset.live==='true','spawn confirmation updates the same chip to running');
      await capturePixels();
      `,
    ),
  60_000,
);
