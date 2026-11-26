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
  "sidebar resizes like a pane divider and closes when dragged past its minimum",
  () =>
    runUiFixture(
      "sidebar-resize",
      `
    const {createRoot}=await import(${fixtureImport(import.meta.resolve("react-dom/client"))});
    const {App}=await import(${local("./App.tsx")});
    const {useStore}=await import(${local("./store.ts")});
    await import(${local("./styles.css")});
    ${fixtureHelpers}
    const mouse=async(type,x,y)=>{window.__fixtureInput={method:'Input.dispatchMouseEvent',params:{type,x,y,button:'left',buttons:type==='mouseReleased'?0:1,clickCount:1}};
      await until(()=>!window.__fixtureInput,'input '+type);await wait();};
    const saved=[];
    // Real rpc.ts, so updateUiPreferences really writes the store and persists.
    window.__requests=new Proxy({setUiPreferences:p=>{saved.push(p);}},{get:(t,k)=>t[k]??(async()=>{throw Error('offline fixture');})});
    useStore.setState(s=>({initialized:true,page:'settings',settings:{...s.settings,language:'en'}}));
    const root=createFixtureRoot(createRoot);root.render(<App/>);
    await until(()=>document.querySelector('.sidebar-resizer'),'resizer must render beside an open sidebar');
    const sidebar=()=>document.querySelector('.sidebar').getBoundingClientRect();
    const main=()=>document.querySelector('.app-shell main').getBoundingClientRect();
    const handle=()=>document.querySelector('.sidebar-resizer').getBoundingClientRect();
    check(Math.round(sidebar().width)===260,'default width');
    const centre=r=>r.left+r.width/2;
    check(centre(handle())>sidebar().right-1&&centre(handle())<main().left+1,'handle must sit in the gap between sidebar and content');
    let h=handle(),y=h.top+h.height/2;
    const hit=document.elementFromPoint(centre(h),y);
    check(hit?.classList.contains('sidebar-resizer'),'the handle must receive the pointer, got '+(hit?.className||hit?.tagName));
    await mouse('mousePressed',centre(h),y);await mouse('mouseMoved',centre(h)+80,y);
    check(Math.round(sidebar().width)===340,'width follows the pointer while dragging');
    check(Math.abs(main().left-sidebar().right-0)<=1,'content follows the sidebar edge without lag');
    const shell=document.querySelector('.app-shell');
    check(shell.style.getPropertyValue('--ds-sidebar-width')==='260px','dragging must not restyle every conversation through the shell variable');
    check(Math.abs(centre(handle())-sidebar().right)<=5,'the handle follows the live width');
    const bar=document.querySelector('.window-titlebar');
    check(Math.abs(bar.getBoundingClientRect().left-sidebar().right)<=1,'the window toolbar follows the live width');
    await mouse('mouseReleased',centre(h)+80,y);
    await wait();
    check(shell.style.getPropertyValue('--ds-sidebar-width')==='340px'&&!document.querySelector('.sidebar').style.getPropertyValue('--ds-sidebar-width'),'release moves the committed width back to the shell');
    check(useStore.getState().bootstrap.desktop.sidebarWidth===340,'release commits the width');
    await until(()=>saved.some(p=>p.sidebarWidth===340),'the width is persisted');
    h=handle();
    await mouse('mousePressed',centre(h),y);await mouse('mouseMoved',centre(h)-200,y);
    check(Math.round(sidebar().width)===200,'width stops at the minimum');
    check(document.querySelector('.sidebar-resizer').dataset.collapsing==='true','past the minimum the handle signals closing');
    await mouse('mouseMoved',centre(h)-260,y);await mouse('mouseReleased',centre(h)-260,y);
    await until(()=>document.querySelector('.app-shell.sidebar-collapsed'),'releasing far below the minimum closes the sidebar');
    check(!document.querySelector('.sidebar-resizer'),'closed sidebar has no resizer');
    check(useStore.getState().bootstrap.desktop.sidebarWidth===340,'closing keeps the last usable width');
    const hover=async(x,y)=>{window.__fixtureInput={method:'Input.dispatchMouseEvent',params:{type:'mouseMoved',x,y,buttons:0}};
      await until(()=>!window.__fixtureInput,'hover');await wait();};
    const pause=ms=>new Promise(r=>setTimeout(r,ms));
    await pause(350);
    const collapsedMain=main().left;
    await hover(3,400);
    check(!shell.dataset.peek,'a pass over the edge does not open it at once');
    await until(()=>shell.dataset.peek==='true','resting on the left edge peeks the sidebar');
    await pause(350);
    check(Math.abs(sidebar().left)<=1&&Math.round(sidebar().width)===340,'the peeked sidebar slides fully in at its width');
    check(main().left===collapsedMain,'peeking floats over the content without moving it');
    check(!document.querySelector('.sidebar').inert&&getComputedStyle(document.querySelector('.sidebar')).backgroundColor!=='rgba(0, 0, 0, 0)','the peeked sidebar is usable and has its own surface');
    await hover(100,400);
    check(shell.dataset.peek==='true','moving inside keeps it open');
    await hover(700,400);
    await until(()=>!shell.dataset.peek,'leaving the sidebar hides it again');
    await pause(350);
    check(sidebar().right<=1&&document.querySelector('.sidebar').inert,'hidden again off screen and inert');
    await hover(3,400);
    await until(()=>shell.dataset.peek==='true','peeks again');
    document.querySelector('.sidebar-toggle').click();
    await until(()=>!shell.classList.contains('sidebar-collapsed')&&!shell.dataset.peek,'the toggle pins a peeked sidebar open');
    await pause(350);
    check(Math.abs(main().left-sidebar().right)<=9,'pinned sidebar pushes the content again');
    document.querySelector('.sidebar-toggle').click();
    await until(()=>shell.classList.contains('sidebar-collapsed'),'collapse again');
    await hover(700,400);
    document.querySelector('.window-sidebar-controls button').click();
    await until(()=>!document.querySelector('.app-shell.sidebar-collapsed'),'toggle reopens the sidebar');
    await until(()=>Math.round(sidebar().width)===340&&sidebar().left>=-1,'reopens at the previous width');
    root.unmount();
  `,
      { realRpc: true, viewport: { width: 1200, height: 800 } },
    ),
  60_000,
);
