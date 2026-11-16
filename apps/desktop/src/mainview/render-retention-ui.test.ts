import { test } from "bun:test";
import { syntaxFixture } from "../../scripts/syntax-fixture";
import {
  fixtureHelpers,
  fixtureImport,
  runUiFixture,
} from "../../scripts/ui-fixture";

test(
  "parsed math and mounted syntax survive pending parsing and shared-cache eviction",
  () =>
    runUiFixture(
      "render-retention",
      `
  const {createRoot}=await import(${fixtureImport(import.meta.resolve("react-dom/client"))});
  const {flushSync}=await import(${fixtureImport(import.meta.resolve("react-dom"))});
  const {Markdown}=await import(${fixtureImport(new URL("./MessageContent.tsx", import.meta.url))});
  const {CodeText}=await import(${fixtureImport(new URL("./HighlightedCode.tsx", import.meta.url))});
  const {prepareMarkdown}=await import(${fixtureImport(new URL("./markdown-processing.ts", import.meta.url))});
  const {normalizeMath}=await import(${fixtureImport(new URL("../shared/math.ts", import.meta.url))});
  const {cachedHighlight,highlightCode}=await import(${fixtureImport(new URL("./syntax-highlighting.ts", import.meta.url))});
  const {markdownWorker}=await import(${fixtureImport(new URL("./markdown-worker-client.ts", import.meta.url))});
  const {syntaxWorker}=await import(${fixtureImport(new URL("./syntax-worker-client.ts", import.meta.url))});
  await import(${fixtureImport(new URL("./styles.css", import.meta.url))});
  await import(${fixtureImport(import.meta.resolve("katex/dist/katex.min.css"))});
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
  let caseIndex=0;
  for(const initial of [
    'Intro\\n\\n$$\\nx = \\\\frac{1}{2}\\n$$',
    'Intro\\n\\n\\\\[x = \\\\frac{1}{2}\\\\]',
    'Intro\\n\\n~~~math\\nx = \\\\frac{1}{2}\\n~~~',
  ]){
    let text=initial;
    await prepareMarkdown(normalizeMath(text));
    const render=final=>flushSync(()=>root.render(<div className="prose"><Markdown text={text} streaming={!final}/></div>));
    render(false);await until(()=>document.querySelector('.katex-display'),'initial completed formula');
    await document.fonts.ready;await wait();
    const formula=document.querySelector('.katex-display'),before=formula.getBoundingClientRect();
    const walker=document.createTreeWalker(formula.querySelector('.katex-html'),NodeFilter.SHOW_TEXT);
    let leaf;while(leaf=walker.nextNode())if(leaf.data.trim())break;
    check(leaf,'formula has selectable glyphs');
    const range=new Range();range.setStart(leaf,0);range.setEnd(leaf,1);
    getSelection().removeAllRanges();getSelection().addRange(range);
    const quote=range.toString();
    const stable=()=>{
      check(formula.isConnected&&document.querySelector('.katex-display')===formula,'completed formula must never unmount while later prose is parsed');
      check(range.toString()===quote&&getSelection().toString()===quote&&getSelection().anchorNode===leaf,'formula selection and annotation endpoints must survive');
      const rect=formula.getBoundingClientRect();
      check(Math.abs(rect.top-before.top)<.5&&Math.abs(rect.height-before.height)<.5,'completed formula must not grow/shrink or move during fallback');
    };
    const markdown=gate(markdownWorker);
    let running=true,failure,frames=0;
    const frame=()=>{
      if(!running)return;
      try{stable();frames++;}catch(error){failure??=error;}
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
    try{
      for(const chunk of ['\\n\\nNext',' paragraph.','\\n\\nAnother paragraph.']){
        text+=chunk;render(false);await sleep(140);stable();
      }
      check(markdown.waiting.length>0,'the test must genuinely hold Markdown work');
      check(document.querySelector('.prose').textContent.includes('Another paragraph.'),'pending prose remains current and visible');
      markdown.release();
      await until(()=>!markdownWorker.stats().running&&!document.querySelector('.markdown-pending-source'),'latest parse settles');
      await wait();stable();
      render(true);await wait();stable();
      check(!failure,'per-frame math regression: '+String(failure));
      check(frames>10,'observe real frames through pending and completed parsing');
      metrics['math'+caseIndex++]={frames,originalFormulaRetained:true,selectionRetained:true};
    }finally{
      running=false;markdown.release();markdown.restore();
      getSelection().removeAllRanges();flushSync(()=>root.render(null));await wait();
    }
  }

  const sources=Array.from({length:3},(_,i)=>('const value'+i+' = fn(a, b, c) + foo.bar[0] * (x - y);\\n').repeat(1500));
  await highlightCode(sources[0],'ts');
  const renderCodes=count=>flushSync(()=>root.render(<div>{sources.slice(0,count).map((text,i)=><pre key={i} data-code-index={i} style={{height:120,overflow:'auto'}}><CodeText text={text} language="ts"/></pre>)}</div>));
  renderCodes(1);await until(syntaxReady,'first mounted code is colored');await wait();
  const code=document.querySelector('pre'),leaf=code.querySelector('.syntax-text').firstChild;
  const color=syntaxStyle(leaf,0).color,mark=new Range();mark.setStart(leaf,0);mark.setEnd(leaf,5);
  getSelection().setBaseAndExtent(leaf,5,leaf,0);
  const stableCode=()=>{
    check(document.querySelector('pre')===code&&leaf.isConnected,'eviction must not rebuild mounted output');
    check(syntaxStyle(leaf,0).color===color&&syntaxPainted(code,0,5).every(Boolean),'eviction must not clear mounted syntax colors');
    check(mark.toString()==='const'&&getSelection().toString()==='const','eviction must preserve selection and annotation ranges');
    check(code.textContent===sources[0],'eviction must preserve every source byte');
  };
  for(const count of [2,3]){
    renderCodes(count);
    await until(()=>!syntaxWorker.stats().running&&!syntaxWorker.stats().pending,'additional code finishes');
    await wait();stableCode();
  }
  await until(()=>!cachedHighlight(sources[0],'ts'),'mounted results must not make the shared cache unbounded');
  renderCodes(3);await wait();stableCode();
  metrics.cacheEviction={mountedResultEvicted:true,originalDomAndColorRetained:true};
  getSelection().removeAllRanges();root.unmount();
  `,
      { viewport: { width: 900, height: 700 } },
    ),
  60_000,
);

test(
  "incomplete equations stay literal through streaming parses and settle exactly on close or stop",
  () =>
    runUiFixture(
      "math-streaming",
      `
  const {createRoot}=await import(${fixtureImport(import.meta.resolve("react-dom/client"))});
  const {flushSync}=await import(${fixtureImport(import.meta.resolve("react-dom"))});
  const {Markdown,BuiltinMarkdown}=await import(${fixtureImport(new URL("./MessageContent.tsx", import.meta.url))});
  const {prepareMarkdown}=await import(${fixtureImport(new URL("./markdown-processing.ts", import.meta.url))});
  const {markdownWorker}=await import(${fixtureImport(new URL("./markdown-worker-client.ts", import.meta.url))});
  await import(${fixtureImport(new URL("./styles.css", import.meta.url))});
  await import(${fixtureImport(import.meta.resolve("katex/dist/katex.min.css"))});
  ${fixtureHelpers}
  const root=createFixtureRoot(createRoot),metrics=window.__fixtureMetrics={};
  const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  for(const finish of ['close','stop']){
    const stable='Stable\\n\\n$$\\na = \\\\frac{1}{2}\\n$$';
    let text=stable+'\\n\\n$$\\ny = \\\\frac{1',final=false;
    await prepareMarkdown(text,undefined,true);
    const render=()=>flushSync(()=>root.render(<>
      <div className="prose" data-stream><Markdown text={text} streaming={!final}/></div>
      <div className="prose" data-oracle>{final&&<BuiltinMarkdown data={{text}}/>}</div>
    </>));
    render();await wait();await document.fonts.ready;
    const stream=document.querySelector('[data-stream]'),first=stream.querySelector('.katex-display');
    const raw=stream.querySelector('.markdown-pending-source');
    check(first&&raw,'one finished equation and one literal unfinished equation');
    const before=first.getBoundingClientRect();
    const stableView=()=>{
      check(first.isConnected&&first===stream.querySelector('.katex-display'),'earlier math must remain mounted');
      check(stream.querySelectorAll('.katex').length===1,'an unfinished equation must never be typeset speculatively');
      check(stream.querySelector('.markdown-pending-source')===raw,'pending and parsed streaming math must use the same literal node');
      const rect=first.getBoundingClientRect();
      check(Math.abs(rect.top-before.top)<.5&&Math.abs(rect.height-before.height)<.5,'earlier equation geometry must remain fixed');
    };
    let running=true,failure,frames=0;
    const frame=()=>{if(!running)return;try{stableView();frames++;}catch(error){failure??=error;}requestAnimationFrame(frame);};
    requestAnimationFrame(frame);
    const original=markdownWorker.run,waiting=[];
    let holding=false;
    markdownWorker.run=(input,signal)=>holding&&input.streaming?new Promise((resolve,reject)=>waiting.push({input,signal,resolve,reject})):original(input,signal);
    const release=()=>{holding=false;for(const job of waiting.splice(0))original(job.input,job.signal).then(job.resolve,job.reject);};
    try{
      for(const chunk of ['}{2}','\\n+ 3']){
        text+=chunk;render();await sleep(160);await wait();stableView();
        check(raw.textContent===text.slice(stable.length+2),'every current formula byte remains visible after parsing');
      }
      holding=true;text+=' + 4';render();await sleep(160);stableView();
      check(waiting.length>0,'genuinely hold an old streaming parse');
      check(raw.textContent.endsWith('+ 4'),'pending math shows the latest suffix');
      running=false;check(!failure,'per-frame math regression: '+String(failure));
      if(finish==='close')text+='\\n$$';
      final=true;render();
      await until(()=>stream.querySelectorAll('.katex').length===2&&document.querySelector('[data-oracle] .katex'),'final math settles even with a retired streaming job pending');
      await wait();
      check(first.isConnected,'finishing must retain the earlier equation DOM');
      check(!stream.querySelector('.markdown-pending-source'),'completion flushes unfinished math');
      check(stream.innerHTML===document.querySelector('[data-oracle]').innerHTML,'final rendering must equal the ordinary full pipeline');
      const html=stream.innerHTML;release();await sleep(80);await wait();
      check(stream.innerHTML===html,'late streaming results must not undo final typesetting');
      metrics[finish]={frames,literalWhileStreaming:true,finalParity:true,staleResultIgnored:true};
    }finally{
      running=false;release();markdownWorker.run=original;
      flushSync(()=>root.render(null));await wait();
    }
  }
  root.unmount();
  `,
      { viewport: { width: 900, height: 700 } },
    ),
  60_000,
);
