import { test } from "bun:test";
import { syntaxFixture } from "../../scripts/syntax-fixture";
import {
  fixtureHelpers,
  fixtureImport,
  runUiFixture,
} from "../../scripts/ui-fixture";

test(
  "streaming syntax never clears existing colors while code and Markdown workers are delayed",
  () =>
    runUiFixture(
      "syntax-streaming",
      `
  const {createRoot}=await import(${fixtureImport(import.meta.resolve("react-dom/client"))});
  const {flushSync}=await import(${fixtureImport(import.meta.resolve("react-dom"))});
  const {CodeText}=await import(${fixtureImport(new URL("./HighlightedCode.tsx", import.meta.url))});
  const {Markdown}=await import(${fixtureImport(new URL("./MessageContent.tsx", import.meta.url))});
  const {highlightCode}=await import(${fixtureImport(new URL("./syntax-highlighting.ts", import.meta.url))});
  const {cachedMarkdown,prepareMarkdown}=await import(${fixtureImport(new URL("./markdown-processing.ts", import.meta.url))});
  const {syntaxWorker}=await import(${fixtureImport(new URL("./syntax-worker-client.ts", import.meta.url))});
  const {markdownWorker}=await import(${fixtureImport(new URL("./markdown-worker-client.ts", import.meta.url))});
  await import(${fixtureImport(new URL("./styles.css", import.meta.url))});
  ${fixtureHelpers}
  ${syntaxFixture}
  const root=createFixtureRoot(createRoot),metrics=window.__fixtureMetrics={};
  const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  const gate=queue=>{
    const original=queue.run,waiting=[];let holding=true;
    queue.run=(input,signal)=>holding?new Promise((resolve,reject)=>waiting.push({input,signal,resolve,reject})):original(input,signal);
    return {
      waiting,
      release(){holding=false;for(const job of waiting.splice(0))original(job.input,job.signal).then(job.resolve,job.reject);},
      restore(){queue.run=original;},
    };
  };
  for(const kind of ['direct','markdown']){
    let body='const stable = 1;\\nconst growing = "a';
    let closed=false;
    const link='https://example.test/stream-fence';
    const source=()=>'[Guide][reference]\\n\\n~~~ts\\n'+body+
      (closed?'\\n~~~\\n\\n[reference]: '+link+'\\n\\nFinished.':'');
    const codeText=()=>body+(kind==='markdown'?'\\n':'');
    await highlightCode(codeText(),'ts');
    if(kind==='markdown')await prepareMarkdown(source(),undefined,true);
    const render=(final=false)=>flushSync(()=>root.render(kind==='markdown'
      ?<Markdown text={source()} streaming={!final}/>
      :<pre><CodeText text={body} language="ts"/></pre>));
    render();await until(()=>document.querySelector('pre .syntax-text')&&syntaxReady(),'initial source must be colored');
    await wait();
    const code=document.querySelector('pre'),span=code.querySelector('.syntax-text'),leaf=span.firstChild;
    const color=syntaxStyle(leaf,0).color,mark=new Range();mark.setStart(leaf,0);mark.setEnd(leaf,5);
    getSelection().setBaseAndExtent(leaf,5,leaf,0);
    // Probe an unselected numeric glyph: selection paint must not mask a flash.
    const probe=new Range(),number=leaf.data.indexOf('1');probe.setStart(leaf,number);probe.setEnd(leaf,number+1);
    const raster=async()=>{
      const pixel=await capturePixels(),rect=probe.getBoundingClientRect(),values=[];
      for(let y=Math.ceil(rect.top);y<Math.floor(rect.bottom);y++)for(let x=Math.ceil(rect.left);x<Math.floor(rect.right);x++)values.push(pixel(x,y));
      check(values.length>0,'unselected colored glyph must be visible');return JSON.stringify(values);
    };
    const originalRaster=await raster();
    const stable=()=>{
      check(document.querySelector('pre')===code&&span.isConnected&&span.firstChild===leaf,'streaming must not unmount/rebuild the code or its unchanged text: '+kind);
      const painted=syntaxPainted(span,0,5);
      check(painted.length===5&&painted.every(Boolean)&&syntaxStyle(leaf,0).color===color,'existing keyword color must never clear while new text is pending: '+kind);
      check(mark.toString()==='const'&&getSelection().toString()==='const'&&getSelection().anchorNode===leaf&&getSelection().anchorOffset===5,'streaming must retain exact selection/annotation endpoints: '+kind);
    };
    // Positive sensitivity control: the check must notice the very flash we
    // are guarding against, then restore the exact same highlight objects.
    const saved=[...CSS.highlights].filter(([name])=>name.startsWith('pig-syntax-'));
    for(const [name] of saved)CSS.highlights.delete(name);
    let detected=false;try{stable();}catch{detected=true;}
    for(const [name,value] of saved)CSS.highlights.set(name,value);
    check(detected,'a one-frame loss of old syntax color must be detectable');
    const syntax=gate(syntaxWorker),markdown=gate(markdownWorker);
    let running=true,failure,frames=0;
    const frame=()=>{
      if(!running)return;
      try{stable();frames++;}catch(error){failure??=error;}
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
    try{
      for(const [index,chunk] of ['b','";','\\nconst count = 2;','\\n','\\n// new line','\\nconst tail = true;'].entries()){
        body+=chunk;render();stable();
        // Both ordinary 32ms chunks and sampler publication boundaries.
        await sleep(index%2?130:32);
      }
      await until(()=>syntax.waiting.length>0,'syntax computation must genuinely remain delayed');
      await until(()=>code.textContent.includes('const tail = true;'),'pending syntax must still expose all sampled source lines');
      stable();
      check(await raster()===originalRaster,'existing unselected glyph pixels must stay colored while syntax is blocked');
      if(kind==='markdown'){
        check(markdown.waiting.length===0&&!cachedMarkdown(source(),true),'safe appends must not request a parse or populate the shared cache');
        closed=true;render();
        await until(()=>markdown.waiting.some(job=>job.input.text===source()&&job.input.streaming),'closing the fence while streaming must request a full parse');
        check(!document.querySelector('a'),'the reference after the fence is not resolved until the full parse');
        stable();
        check(await raster()===originalRaster,'existing glyphs must stay colored while the closing fence is awaiting both workers');
        markdown.release();
        await until(()=>document.querySelector('a')?.href===link,'the full parse resolves an earlier reference');
        stable();
        render(true);
        await until(()=>cachedMarkdown(source(),false),'completion must parse independently of the streaming result');
        await wait();stable();
      }
      check(await raster()===originalRaster,'closing the streaming fence must not flash existing syntax back to plain text');
      syntax.release();
      await until(()=>{
        const start=code.textContent.indexOf('const tail');
        const painted=syntaxPainted(code,start,code.textContent.length);
        return painted.length&&painted.every(Boolean);
      },'the latest added code must receive its matching colors after release');
      await wait();stable();
      check(await raster()===originalRaster,'final syntax settlement must retain the original glyph color');
      check(code.textContent===codeText(),'final code must contain exactly the latest source and newlines');
      check(!failure,'per-frame color/DOM/selection regression: '+String(failure));
      check(frames>20,'observe real frames through delayed parse and completion');
      metrics[kind]={frames,oldColorNeverCleared:true,sensitivityControl:true,openFenceCompleted:kind==='markdown'};
    }finally{
      running=false;syntax.release();markdown.release();syntax.restore();markdown.restore();
      getSelection().removeAllRanges();flushSync(()=>root.render(null));await wait();
    }
  }
  root.unmount();
  `,
    ),
  60_000,
);
