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
  "widgets: script-free by default, scripted only when isolated, bounded frame count",
  () =>
    runUiFixture(
      "widget",
      `
    const {createRoot}=await import(${fixtureImport(import.meta.resolve("react-dom/client"))});
    const {flushSync}=await import(${fixtureImport(import.meta.resolve("react-dom"))});
    const {WidgetFrame,MAX_LIVE_WIDGETS}=await import(${local("./WidgetFrame.tsx")});
    const {widgetScriptPolicy,measureFrame}=await import(${local("./widget-frame.ts")});
    const {widgetBlock}=await import(${local("../shared/widget.ts")});
    await import(${local("./styles.css")});
    ${fixtureHelpers}
    const root=createFixtureRoot(createRoot);
    const reached=[];addEventListener('message',e=>{if(e.data?.type==='probe')reached.push(e.data)});
    const source='<div style="height:333px">tall</div><script>parent.postMessage({type:"probe"},"*")</script>';
    const block=widgetBlock(source,{origin:'tool',title:'Chart'});
    const mount=blocks=>flushSync(()=>root.render(<div style={{width:'760px'}}>{blocks.map(b=><WidgetFrame key={b.id} block={b}/>)}</div>));
    const frames=()=>[...document.querySelectorAll('.widget-frame iframe')];

    mount([block]);
    await until(()=>frames().length===1,'a visible widget mounts its frame');
    const plain=frames()[0];
    check(plain.getAttribute('sandbox')==='','script-free sandbox by default');
    check(plain.getAttribute('aria-label')==='Chart','the frame is labelled with its title');
    await new Promise(r=>setTimeout(r,500));
    check(reached.length===0,'fragment scripts do not run');
    check(plain.parentElement.getBoundingClientRect().height===240,'an unmeasurable frame keeps the default height');

    // Where the host can see into a frame (WebView2 today), it sizes to the content.
    const same=document.createElement('iframe');same.srcdoc='<!doctype html><body style="margin:0"><div style="height:123px"></div></body>';
    document.body.append(same);await new Promise(r=>same.onload=r);
    check(measureFrame(same)===123,'measureFrame reads the content height');same.remove();

    // Many widgets: frames exist only up to the live limit.
    const many=Array.from({length:12},(_,i)=>widgetBlock('<p>'+i+'</p>',{origin:'tool'}));
    mount(many);
    await until(()=>frames().length===MAX_LIVE_WIDGETS,'frames are capped');
    await wait();
    check(frames().length===MAX_LIVE_WIDGETS,'no more than the live limit');

    // Script mode: only after the isolation check passes (it does in a normal Chromium).
    widgetScriptPolicy.requested=true;
    flushSync(()=>root.render(<div/>));
    mount([block]);
    await until(()=>frames()[0]?.getAttribute('sandbox')==='allow-scripts','scripts run once the frame is isolated');
    await until(()=>reached.length>=1,'fragment scripts run in script mode');
    await until(()=>Math.round(frames()[0].parentElement.getBoundingClientRect().height)===333,'the frame reports its content height');
    widgetScriptPolicy.requested=false;
  `,
      { viewport: { width: 900, height: 4000 } },
    ),
  120_000,
);
