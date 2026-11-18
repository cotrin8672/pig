import { test } from "bun:test";
import { existsSync } from "node:fs";
import {
  fixtureEdge,
  fixtureHelpers,
  fixtureImport,
  runUiFixture,
} from "../../scripts/ui-fixture";

test.skipIf(!existsSync(fixtureEdge) && !process.env.PIG_REQUIRE_UI_TESTS)(
  "dragging a winbar previews the layout and moves the pane with its editor",
  () =>
    runUiFixture(
      "pane-drag",
      `
    const {createRoot}=await import(${fixtureImport(import.meta.resolve("react-dom/client"))});
    const {flushSync}=await import(${fixtureImport(import.meta.resolve("react-dom"))});
    const {App}=await import(${fixtureImport(new URL("./App.tsx", import.meta.url))});
    const {useStore}=await import(${fixtureImport(new URL("./store.ts", import.meta.url))});
    await import(${fixtureImport(new URL("./styles.css", import.meta.url))});
    ${fixtureHelpers}
    const root=createFixtureRoot(createRoot);
    const snapshot=id=>({address:{hostId:'drag',sessionId:id,epoch:1},snapshotSeq:1,
      info:{id,cwd:'fixture',title:'Chat '+id,modified:1},effort:'off',effortLevels:[],
      transcript:{records:[],tools:{},current:null,running:false,liveToEntry:{}}});
    const a=snapshot('a'),b=snapshot('b');
    window.__requests={listSlashCommands:async()=>[]};
    flushSync(()=>useStore.setState(s=>({
      initialized:true,page:'chat',active:'a',activePane:1,
      paneTree:{type:'split',axis:'columns',weights:[0.5,0.5],children:[{type:'pane',id:1},{type:'pane',id:2}]},
      panes:{1:{sessionId:'a'},2:{sessionId:'b'}},snapshots:{a,b},addresses:{a:a.address,b:b.address},sessions:{},
      bootstrap:{...s.bootstrap,generalCwd:'fixture'},settings:{...s.settings,language:'en'},
    })));
    flushSync(()=>root.render(<App/>));
    const pane=id=>document.querySelector('[data-pane-id="'+id+'"]');
    await until(()=>pane(1)&&pane(2)?.querySelector('.pane-winbar'),'both panes must mount');
    const mouse=async(type,x,y)=>{window.__fixtureInput={method:'Input.dispatchMouseEvent',params:{type,x,y,button:'left',buttons:type==='mouseReleased'?0:1,clickCount:1}};await until(()=>!window.__fixtureInput,'input '+type);await wait();};
    const bar=pane(2).querySelector('.pane-winbar').getBoundingClientRect(),target=pane(1).getBoundingClientRect();
    const bottom=[target.x+target.width/2,target.bottom-12];
    await mouse('mousePressed',bar.x+40,bar.y+bar.height/2);
    await mouse('mouseMoved',bar.x+60,bar.y+40);
    await mouse('mouseMoved',...bottom);
    const stacked=()=>{const slots=[...document.querySelectorAll('.pane-drop-slot')].map(s=>s.getBoundingClientRect());return slots.length===2&&Math.abs(slots[0].x-slots[1].x)<1&&slots[1].y>slots[0].y};
    await until(stacked,'overlay must preview a top/bottom layout');
    check(document.querySelector('.pane-drop-slot[data-moving="true"] .pane-drop-slot-hint')?.textContent.includes('below'),'hint must name the placement');
    check(!document.querySelector('.pane-preview-divider'),'dividers hide while dragging');
    await mouse('mouseReleased',...bottom);
    const one=pane(1).getBoundingClientRect(),two=pane(2).getBoundingClientRect();
    check(!document.querySelector('.pane-drop-layout'),'overlay must close on drop');
    check(Math.abs(one.x-two.x)<1&&two.y>one.y&&Math.abs(one.width-two.width)<1,'pane 2 must move below pane 1');
    check(useStore.getState().activePane===2&&useStore.getState().panes[2].sessionId==='b','moved pane keeps its session and focus');
    // Escape cancels without changing the layout.
    const before=JSON.stringify(useStore.getState().paneTree),barOne=pane(1).querySelector('.pane-winbar').getBoundingClientRect();
    await mouse('mousePressed',barOne.x+40,barOne.y+barOne.height/2);
    await mouse('mouseMoved',barOne.x+40,two.y+two.height/2);
    check(document.querySelector('.pane-drop-layout'),'second drag must preview');
    window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'}));await wait();
    await mouse('mouseReleased',barOne.x+40,two.y+two.height/2);
    check(!document.querySelector('.pane-drop-layout')&&JSON.stringify(useStore.getState().paneTree)===before,'escape must cancel the move');
    `,
    ),
  60_000,
);
