// Headless Edge, trusted mouse input. Do not overwrite the user's clipboard.
import { fixtureHelpers, fixtureImport, runUiFixture } from "./ui-fixture";

await runUiFixture(
  "virtual-selection",
  `
  await import(${fixtureImport(new URL("../src/mainview/styles.css", import.meta.url))});
  ${fixtureHelpers}
  const input=async(method,params)=>{
    window.__fixtureInput={method,params};
    await until(()=>!window.__fixtureInput,"input timeout");
  };
  const results=[];
  for(const direction of [1,-1]){
    let reference;
    for(const mode of ["full","window","pinned"]){
      const host=document.createElement("div"),list=document.createElement("div");
      host.style.cssText="height:240px;width:500px;overflow:auto;overflow-anchor:none;user-select:text";
      list.style.cssText="position:relative;height:24000px;font:16px/24px monospace;user-select:text";
      host.append(list);document.body.prepend(host);
      const anchor=direction===1?40:160,target=anchor+100*direction;
      let start=null;
      const render=()=>{
        const first=Math.max(0,Math.floor(host.scrollTop/24)-3);
        const last=Math.min(999,Math.ceil((host.scrollTop+240)/24)+3);
        const lo=mode==="full"?0:Math.min(first,start??first);
        const hi=mode==="full"?999:Math.max(last,start??last);
        for(const row of [...list.children])if(+row.dataset.i<lo||+row.dataset.i>hi)row.remove();
        // Keep the existing text nodes and DOM order, including the drag origin.
        let next=list.firstElementChild;
        for(let i=lo;i<=hi;i++){
          if(next&&+next.dataset.i===i){next=next.nextElementSibling;continue;}
          const row=document.createElement("div");row.dataset.i=i;
          row.textContent="record-"+String(i).padStart(4,"0")+" 日本語";
          row.style.cssText="position:absolute;left:0;user-select:text;top:"+i*24+"px";
          list.insertBefore(row,next);
        }
      };
      host.addEventListener("scroll",render);
      host.addEventListener("mousedown",e=>{if(mode==="pinned")start=+e.target.dataset.i});
      host.scrollTop=(anchor-4)*24;render();await wait();
      const normal=list.childElementCount;
      const mouse=(type,x,y,extra)=>input("Input.dispatchMouseEvent",{type,x,y,...extra});
      const point=(i,end)=>{const r=list.querySelector('[data-i="'+i+'"]').getBoundingClientRect();return [end?r.right-1:r.left+1,r.top+12]};
      let [x,y]=point(anchor,direction<0);
      await mouse("mousePressed",x,y,{button:"left",buttons:1,clickCount:1});
      check(document.elementFromPoint(x,y)?.dataset.i===String(anchor),"start hit "+document.elementFromPoint(x,y)?.outerHTML.slice(0,170));
      await mouse("mouseMoved",x+direction*12,y,{button:"left",buttons:1});
      for(let i=0;i<10;i++){
        const before=host.scrollTop;
        await mouse("mouseWheel",120,y,{deltaX:0,deltaY:direction*240,buttons:1});
        await until(()=>Math.abs(host.scrollTop-before)>=239,"wheel did not move");await wait();
        [x,y]=point(anchor+(i+1)*10*direction,direction>0);
        await mouse("mouseMoved",x,y,{button:"left",buttons:1});
      }
      await mouse("mouseReleased",x,y,{button:"left",buttons:0,clickCount:1});
      let copied;
      document.addEventListener("copy",e=>{copied=getSelection().toString();e.preventDefault()},{once:true});
      await input("Input.dispatchKeyEvent",{type:"rawKeyDown",key:"c",code:"KeyC",windowsVirtualKeyCode:67,modifiers:2});
      await input("Input.dispatchKeyEvent",{type:"keyUp",key:"c",code:"KeyC",windowsVirtualKeyCode:67,modifiers:2});
      check(typeof copied==="string","copy event missing");
      const count=(copied.match(/record-/g)??[]).length;
      if(mode==="full"){check(count===101,"control selected "+count+" "+JSON.stringify([copied.slice(0,80),getSelection().anchorNode?.parentElement.outerHTML.slice(0,200),getSelection().focusNode?.parentElement.outerHTML.slice(0,200)]));reference=copied;}
      check((copied===reference)===(mode!=="window"),"unexpected selection: "+[direction,mode,count]);
      const held=list.childElementCount;
      getSelection().removeAllRanges();start=null;render();
      results.push({direction,mode,records:count,normal,held,released:list.childElementCount});
      host.remove();
    }
  }
  window.__fixtureMetrics=results;
`,
);
