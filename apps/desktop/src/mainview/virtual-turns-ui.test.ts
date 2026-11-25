import { test } from "bun:test";
import {
  fixtureHelpers,
  fixtureImport,
  runUiFixture,
} from "../../scripts/ui-fixture";

test(
  "variable-height virtual turns keep native drag selection across unmounted screens",
  () =>
    runUiFixture(
      "virtual-turns-selection",
      `
  const {createRoot}=await import(${fixtureImport(import.meta.resolve("react-dom/client"))});
  const {flushSync}=await import(${fixtureImport(import.meta.resolve("react-dom"))});
  const {VirtualTurns}=await import(${fixtureImport(new URL("./VirtualTurns.tsx", import.meta.url))});
  await import(${fixtureImport(new URL("./styles.css", import.meta.url))});
  ${fixtureHelpers}
  const root=createFixtureRoot(createRoot),thread={current:null};
  const makeRow=i=><div key={i} data-row={i} style={{height:32+(i%3)*4,userSelect:"text"}}><span>row-{i}-日本語</span></div>;
  const rows=Array.from({length:1000},(_,i)=>makeRow(i));
  const input=async(type,x,y,extra)=>{window.__fixtureInput={method:"Input.dispatchMouseEvent",params:{type,x,y,...extra}};await until(()=>!window.__fixtureInput,"mouse input");};
  for(const dir of [1,-1]){
    const from=dir>0?40:120,to=dir>0?120:40;
    let expected;
    for(const virtual of [false,true]){
      const built=new Set();
      flushSync(()=>root.render(<div key={String(virtual)+dir} ref={thread} style={{height:240,overflow:"auto",userSelect:"text"}}>{virtual?<VirtualTurns thread={thread} keys={rows.map(r=>String(r.key))} renderRow={i=>{built.add(i);return rows[i]}} target={String(from)}/>:rows}</div>));
      const row=i=>thread.current.querySelector('[data-row="'+i+'"]');
      await until(()=>row(from),"search must mount drag origin");
      row(from).scrollIntoView({block:"center"});await wait();
      if(virtual)check(built.size<80 && thread.current.querySelectorAll("[data-row]").length<40,"both constructed rows and mounted DOM must be bounded");
      const point=(i,end)=>{const r=row(i).firstChild.getBoundingClientRect();return [end?r.right-1:r.left+1,r.top+r.height/2];};
      let [x,y]=point(from,dir<0);
      await input("mousePressed",x,y,{button:"left",buttons:1,clickCount:1});
      await input("mouseMoved",x+dir*10,y,{button:"left",buttons:1});
      for(let n=0;n<100;n++){
        const box=thread.current.getBoundingClientRect();
        const end=row(to)?.getBoundingClientRect();
        if(end&&end.top>=box.top&&end.bottom<=box.bottom)break;
        await input("mouseWheel",80,box.top+100,{deltaX:0,deltaY:dir*110,buttons:1});await wait();
        await input("mouseMoved",80,box.top+100,{button:"left",buttons:1});
      }
      [x,y]=point(to,dir>0);await input("mouseMoved",x,y,{button:"left",buttons:1});
      await input("mouseReleased",x,y,{button:"left",buttons:0,clickCount:1});await wait();
      const text=getSelection().toString();
      check((text.match(/row-/g)??[]).length===81,"selection must contain all 81 turns");
      if(!virtual)expected=text;else check(text===expected,"selection must match full DOM exactly");
      if(virtual){
        thread.current.scrollTop=thread.current.scrollHeight;
        await until(()=>thread.current.querySelector('[data-row="990"]')||thread.current.querySelector('[data-row="999"]'),"distant viewport must mount");
        check(getSelection().toString()===expected && thread.current.querySelectorAll("[data-row]").length<125,"distant viewport must not mount the gap or lose selection");
      }
      getSelection().removeAllRanges();await wait();
      if(virtual)await until(()=>thread.current.querySelectorAll("[data-row]").length<40,"release selected rows");
    }
  }
  const state={follow:false};
  const render=(rows,target)=>flushSync(()=>root.render(<div key="history" ref={thread} style={{height:240,overflow:"auto"}}><VirtualTurns thread={thread} keys={rows.map(r=>String(r.key))} renderRow={i=>rows[i]} target={target} follow={state}/></div>));
  render(rows,"500");await until(()=>thread.current.querySelector('[data-row="500"]'),"history search");await wait();
  const y=()=>thread.current.querySelector('[data-row="500"]').getBoundingClientRect().top;
  render(rows,undefined);
  const box=thread.current.getBoundingClientRect(),beforeWheel=thread.current.scrollTop,beforeY=y();
  await input("mouseWheel",80,box.top+100,{deltaX:0,deltaY:36});await wait();
  check(Math.abs(y()-beforeY+36)<=2,"native wheel reader displacement: "+[beforeY,y(),beforeWheel,thread.current.scrollTop]);
  const original=y(),older=[...Array.from({length:50},(_,i)=>makeRow(i-50)),...rows];
  render(older,undefined);await wait();check(Math.abs(y()-original)<=2,"first prepend reader drift "+(y()-original));
  const above=[...thread.current.querySelectorAll('[data-row]')].find(r=>r.getBoundingClientRect().bottom<=thread.current.getBoundingClientRect().top);
  check(above,"overscan must include a row above the reader");above.style.height="180px";await wait();await wait();
  check(Math.abs(y()-original)<=2,"late resize reader drift "+(y()-original));
  await wait();const savedKey=state.reading.key;
  const position=()=>thread.current.querySelector('[data-turn-key="'+savedKey+'"]').getBoundingClientRect().top;
  const savedY=position();flushSync(()=>root.render(<div/>));render(older,undefined);
  await until(()=>thread.current.querySelector('[data-turn-key="'+savedKey+'"]'),"restore saved turn");await wait();
  check(Math.abs(position()-savedY)<=2,"return to chat drift "+(position()-savedY));
  root.unmount();
`,
    ),
  125000,
);
