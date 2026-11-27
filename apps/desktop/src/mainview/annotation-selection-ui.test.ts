import { test } from "bun:test";
import { existsSync } from "node:fs";
import {
  fixtureEdge,
  fixtureHelpers,
  fixtureImport,
  runUiFixture,
} from "../../scripts/ui-fixture";

test.skipIf(!existsSync(fixtureEdge) && !process.env.PIG_REQUIRE_UI_TESTS)(
  "re-dragging inside an annotation selection reselects and keeps the bubble",
  () =>
    runUiFixture(
      "annotation-selection",
      `
      const {createRoot}=await import(${fixtureImport(import.meta.resolve("react-dom/client"))});
      const {flushSync}=await import(${fixtureImport(import.meta.resolve("react-dom"))});
      const {AnnotationPopover}=await import(${fixtureImport(new URL("./AnnotationPopover.tsx", import.meta.url))});
      await import(${fixtureImport(new URL("./styles.css", import.meta.url))});
      const {TurnRail}=await import(${fixtureImport(new URL("./TurnRail.tsx", import.meta.url))});
      ${fixtureHelpers}
      const root=createFixtureRoot(createRoot);
      const text='The quick brown fox jumps over the lazy dog and keeps running far away. '.repeat(4);
      const records=['one','two'].map(id=>({id,kind:'message',message:{role:'user',content:id}}));
      flushSync(()=>root.render(<div style={{position:'relative',width:620,padding:'36px 24px',height:470,boxSizing:'border-box'}}><article className="message assistant"><p>{text}</p><div className="response-footer">done</div></article><TurnRail sessionId="fixture" records={records} thread={{current:null}}/><AnnotationPopover onAdd={()=>{}}/></div>));
      await wait();
      const node=document.querySelector('p').firstChild;
      const point=offset=>{const r=document.createRange();r.setStart(node,offset);r.setEnd(node,offset+1);const b=r.getBoundingClientRect();return {x:b.left+1,y:b.top+b.height/2};};
      // Trusted input: synthetic events cannot reproduce Chromium's native selection drag.
      const input=async params=>{window.__fixtureInput={method:'Input.dispatchMouseEvent',params:{button:'left',clickCount:1,...params}};await until(()=>!window.__fixtureInput,'input '+params.type);await wait();};
      const press=async(at,extra={})=>{const p=point(at);await input({type:'mousePressed',...p,buttons:1,...extra});return p;};
      const release=async(p,extra={})=>input({type:'mouseReleased',...p,buttons:0,...extra});
      const drag=async(from,to)=>{
        await press(from);const b=point(to);
        await input({type:'mouseMoved',...b,buttons:1});
        await release(b);
      };
      const selected=()=>{const r=getSelection().getRangeAt(0);return r.startOffset+'-'+r.endOffset;};
      const bubble=()=>document.querySelector('.annotation-popover > button');
      const tick=document.querySelector('.turn-rail-tick').getBoundingClientRect();
      const move=y=>input({type:'mouseMoved',button:'none',buttons:0,x:tick.left+2,y});
      const card=()=>document.querySelector('.turn-rail-card');
      await move(tick.top-12);
      check(!card(),'extra margin must not open the rail');
      await move(tick.top+4);await until(card,'hover opens preview');
      await move(tick.top-12);
      check(card()&&!document.elementFromPoint(tick.left+2,tick.top-12)?.closest('.turn-rail'),'retain preview without a hit target');
      await move(tick.top-120);await until(()=>!card(),'leaving the margin closes preview');
      await drag(0,5);
      check(selected()==='0-5','the transparent turn rail must not take the first letter');
      await drag(10,60);
      check(selected()==='10-60'&&bubble(),'a first drag must select and show the bubble');
      for(const [from,to] of [[12,58],[20,40],[25,90]]){
        await drag(from,to);
        check(selected()===from+'-'+to,'dragging inside a selection must reselect, not move text: '+selected());
        check(bubble(),'the bubble must return after dragging inside a selection');
      }
      const word=point(42);
      for(const clickCount of [1,2]){await press(42,{clickCount});await release(word,{clickCount});}
      check(getSelection().toString().trim()==='dog','double-click inside a response must still select a word');
      const end=await press(100,{modifiers:8});await release(end,{modifiers:8});
      check(selected()==='40-102'&&bubble(),'shift+click must still extend the selection');
      for(const clickCount of [1,2,3]){await press(42,{clickCount});await release(word,{clickCount});}
      check(bubble(),'triple-click on the paragraph above the footer must still show the bubble');
      const many=Array.from({length:96},(_,i)=>({id:String(i),kind:'message',message:{role:'user',content:'Turn '+i}}));
      flushSync(()=>root.render(<div style={{position:'relative',marginLeft:50,width:620,height:560,'--chat-width':'480px'}}><TurnRail sessionId="long" records={many} thread={{current:null}}/></div>));
      const list=document.querySelector('.turn-rail-ticks'),bounds=list.getBoundingClientRect();
      const center=i=>{const r=list.children[i].getBoundingClientRect();return r.top+r.height/2;};
      const hover=(x,y)=>input({type:'mouseMoved',button:'none',buttons:0,x,y});
      await hover(bounds.left+2,center(4));
      await hover(bounds.left-12,center(8));
      const selectedTick=()=>list.querySelector('[data-open]');
      await until(()=>selectedTick()===list.children[8]&&card()?.querySelector('.turn-rail-card-title').textContent==='Turn 8','selection and preview follow in the margin');
      check(getComputedStyle(selectedTick(),'::before').height==='4px' && getComputedStyle(list.children[7],'::before').height==='2px','only the selected tick thickens');
      await until(()=>getComputedStyle(selectedTick(),'::before').width==='44px','selected tick reaches full width');
      const selectedLeft=parseFloat(getComputedStyle(selectedTick(),'::before').left);
      const neighbor=getComputedStyle(list.children[7],'::before'),idle=getComputedStyle(list.children[0],'::before');
      const axis=parseFloat(neighbor.left);
      check(axis===parseFloat(idle.left) && neighbor.translate.startsWith('-50%') && parseFloat(neighbor.width)>parseFloat(idle.width),'unselected ticks swell on both sides of their original axis');
      check(Math.abs(axis-selectedLeft-13)<1 && selectedLeft+44<=list.clientWidth,'selected mark keeps its full left half and adds length toward the card');
      list.style.setProperty('--ds-accent','#64b589');
      const tickColor=t=>getComputedStyle(t,'::before').backgroundColor;
      await until(()=>tickColor(selectedTick())==='rgb(100, 181, 137)','selection follows theme accent');
      check(tickColor(list.children[7])!==tickColor(selectedTick()),'neighbour stays neutral');
      check(getComputedStyle(list).scrollbarWidth==='none' && list.offsetWidth===list.clientWidth,'no visible scrollbar or gutter');
      await hover(bounds.left-12,center(8));
      await input({type:'mouseWheel',button:'none',buttons:0,x:bounds.left-12,y:center(8),deltaX:0,deltaY:200});
      await until(()=>list.scrollTop>0 && Number(selectedTick()?.dataset.index)>8,'wheel moves the index without a scrollbar');
      `,
      { viewport: { width: 900, height: 700 } },
    ),
  120_000,
);
