import { test } from "bun:test";
import { existsSync } from "node:fs";
import {
  fixtureEdge,
  fixtureHelpers,
  fixtureImport,
  runUiFixture,
} from "../../scripts/ui-fixture";

test.skipIf(!existsSync(fixtureEdge) && !process.env.PIG_REQUIRE_UI_TESTS)(
  "dragging a winbar previews the layout and preserves both chat viewports",
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
    const snapshot=(id,count)=>({address:{hostId:'drag',sessionId:id,epoch:1},snapshotSeq:1,
      info:{id,cwd:'fixture',title:'Chat '+id,modified:1},effort:'off',effortLevels:[],
      transcript:{records:Array.from({length:count},(_,i)=>({
        id:id+'-'+i,order:i,kind:'message',message:{role:'user',content:'Message '+i+' '+('content '.repeat(14+i%7)),timestamp:i},
      })),tools:{},current:null,running:false,liveToEntry:{}}});
    const a=snapshot('a',100),b=snapshot('b',240);
    window.__requests={listSlashCommands:async()=>[]};
    flushSync(()=>useStore.setState(s=>({
      initialized:true,page:'chat',active:'a',activePane:1,
      paneTree:{type:'split',axis:'columns',weights:[0.5,0.5],children:[{type:'pane',id:1},{type:'pane',id:2}]},
      panes:{1:{sessionId:'a'},2:{sessionId:'b'}},snapshots:{a,b},addresses:{a:a.address,b:b.address},sessions:{},
      bootstrap:{...s.bootstrap,generalCwd:'fixture'},settings:{...s.settings,language:'en'},
    })));
    flushSync(()=>root.render(<App/>));
    const pane=id=>document.querySelector('[data-pane-id="'+id+'"]');
    const thread=id=>pane(id)?.querySelector('.thread-scroll');
    const editor=id=>pane(id)?.querySelector('textarea');
    await until(()=>[1,2].every(id=>thread(id)?.querySelector('[data-record-id]')&&editor(id)),'both chats must mount');
    const threads=[1,2].map(thread),editors=[1,2].map(editor);
    await wait();
    for(const el of threads)el.scrollTop=el.scrollHeight/2;
    await wait();await wait();
    const tops=threads.map(el=>el.scrollTop);
    check(tops.every((top,i)=>top>threads[i].clientHeight),'both readers must start well away from the top');
    const input=async(method,params)=>{window.__fixtureInput={method,params};await until(()=>!window.__fixtureInput,'input '+params.type);await wait();};
    const mouse=(type,x,y)=>input('Input.dispatchMouseEvent',{type,x,y,button:'left',buttons:type==='mouseReleased'?0:1,clickCount:1});
    const press=id=>{
      const bar=pane(id).querySelector('.pane-winbar').getBoundingClientRect();
      return mouse('mousePressed',bar.x+40,bar.y+bar.height/2);
    };
    const checkDom=()=>check([1,2].every((id,i)=>thread(id)===threads[i]&&editor(id)===editors[i]),'pane drags must preserve both chats and editors');
    for(const left of [2,1]){
      const target=pane(1).getBoundingClientRect(),center=[target.x+target.width/2,target.y+target.height/2];
      await press(2);await mouse('mouseMoved',...center);await mouse('mouseReleased',...center);
      check(pane(left).getBoundingClientRect().left<pane(3-left).getBoundingClientRect().left,'dropping at the center must swap the panes');
      checkDom();
      check(threads.every((el,i)=>el.scrollTop===tops[i]),'swapping must preserve both scroll positions: '+threads.map(el=>el.scrollTop)+' vs '+tops);
      if(left===2){
        pane(2).querySelector('.pane-close').focus({preventScroll:true});
        const tab={key:'Tab',code:'Tab',windowsVirtualKeyCode:9};
        await input('Input.dispatchKeyEvent',{...tab,type:'keyDown'});
        await input('Input.dispatchKeyEvent',{...tab,type:'keyUp'});
        check(pane(1).contains(document.activeElement),'Tab must move from the left pane to the right pane after a swap');
      }
    }
    const readers=threads.map(el=>[...el.querySelectorAll('[data-record-id]')].find(row=>row.getBoundingClientRect().top>=el.getBoundingClientRect().top+24));
    const target=pane(2).getBoundingClientRect(),bottom=[target.x+target.width/2,target.bottom-12];
    await press(1);
    await mouse('mouseMoved',...bottom);
    const stacked=()=>{const slots=[...document.querySelectorAll('.pane-drop-slot')].map(s=>s.getBoundingClientRect());return slots.length===2&&Math.abs(slots[0].x-slots[1].x)<1&&slots[1].y>slots[0].y};
    await until(stacked,'overlay must preview a top/bottom layout');
    check(document.querySelector('.pane-drop-slot[data-moving="true"] .pane-drop-slot-hint')?.textContent.includes('below'),'hint must name the placement');
    check(!document.querySelector('.pane-preview-divider'),'dividers hide while dragging');
    await mouse('mouseReleased',...bottom);
    const one=pane(1).getBoundingClientRect(),two=pane(2).getBoundingClientRect();
    check(!document.querySelector('.pane-drop-layout'),'overlay must close on drop');
    check(Math.abs(one.x-two.x)<1&&one.y>two.y&&Math.abs(one.width-two.width)<1,'pane 1 must move below pane 2');
    check(useStore.getState().activePane===1&&document.activeElement===editors[0],'moved pane keeps its editor focus');
    checkDom();
    await wait();
    check(readers.every((row,i)=>{
      if(!row?.isConnected)return false;
      const bounds=threads[i].getBoundingClientRect(),rect=row.getBoundingClientRect();
      return rect.bottom>bounds.top&&rect.top<bounds.bottom;
    }),'resizing and reordering must keep both readers in view');
    // Escape cancels without changing the layout.
    const before=JSON.stringify(useStore.getState().paneTree),center=[one.x+one.width/2,one.y+one.height/2];
    await press(2);
    await mouse('mouseMoved',...center);
    check(document.querySelector('.pane-drop-layout'),'second drag must preview');
    window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'}));await wait();
    await mouse('mouseReleased',...center);
    check(!document.querySelector('.pane-drop-layout')&&JSON.stringify(useStore.getState().paneTree)===before,'escape must cancel the move');
    `,
      { viewport: { width: 1200, height: 800 } },
    ),
  60_000,
);
