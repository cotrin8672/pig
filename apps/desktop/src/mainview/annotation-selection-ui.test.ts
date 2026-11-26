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
      await import(${fixtureImport(new URL("./turn-rail.css", import.meta.url))});
      ${fixtureHelpers}
      const root=createFixtureRoot(createRoot);
      const text='The quick brown fox jumps over the lazy dog and keeps running far away. '.repeat(4);
      flushSync(()=>root.render(<div style={{position:'relative',width:620,padding:'36px 24px',height:470,boxSizing:'border-box'}}><article className="message assistant"><p>{text}</p></article><nav className="turn-rail"><div className="turn-rail-ticks"><button className="turn-rail-tick"/></div></nav><AnnotationPopover onAdd={()=>{}}/></div>));
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
      `,
      { viewport: { width: 900, height: 700 } },
    ),
  120_000,
);
