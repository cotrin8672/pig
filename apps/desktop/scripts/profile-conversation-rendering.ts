// Offline browser probes only. No user session, host RPC or production changes.
import { fixtureHelpers, fixtureImport, runUiFixture } from "./ui-fixture";

const mode = process.argv[2] ?? "chat";
if (!["chat", "stream", "ranges", "checkpoints"].includes(mode))
  throw new Error("Expected chat, stream, ranges or checkpoints");
const common = `
  const {createRoot}=await import(${fixtureImport(import.meta.resolve("react-dom/client"))});
  const {flushSync}=await import(${fixtureImport(import.meta.resolve("react-dom"))});
  const {Fragment}=await import(${fixtureImport(import.meta.resolve("react"))});
  const {CodeText,SavedOutputContext}=await import(${fixtureImport(new URL("../src/mainview/HighlightedCode.tsx", import.meta.url))});
  const {SyntaxRangesContext}=await import(${fixtureImport(new URL("../src/mainview/SyntaxText.tsx", import.meta.url))});
  const {highlightCode}=await import(${fixtureImport(new URL("../src/mainview/syntax-highlighting.ts", import.meta.url))});
  await import(${fixtureImport(new URL("../src/mainview/styles.css", import.meta.url))});
  ${fixtureHelpers}
  const root=createFixtureRoot(createRoot);
  const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  const stats=values=>{
    const sorted=[...values].sort((a,b)=>a-b);
    return {n:values.length,mean:values.reduce((a,b)=>a+b,0)/(values.length||1),
      p95:sorted[Math.ceil(sorted.length*.95)-1]??0,max:sorted.at(-1)??0};
  };
  const count=element=>{
    const walk=document.createTreeWalker(element,NodeFilter.SHOW_ALL);
    let all=0,text=0;while(walk.nextNode()){all++;if(walk.currentNode.nodeType===3)text++;}
    return {elements:element.querySelectorAll('*').length,text,all,
      tokens:element.querySelectorAll('.syntax-token').length};
  };
  const frames=[],longTasks=[];let measuring=false,previous=0,alive=true;
  const frame=now=>{if(measuring&&previous)frames.push(now-previous);previous=now;if(alive)requestAnimationFrame(frame);};
  requestAnimationFrame(frame);
  const observer=new PerformanceObserver(list=>{if(measuring)for(const entry of list.getEntries())longTasks.push(entry.duration);});
  observer.observe({type:'longtask'});
  const metrics=window.__fixtureMetrics={};
`;

const chat = (history: number, position: string) => `
  ${common}
  const {Chat}=await import(${fixtureImport(new URL("../src/mainview/App.tsx", import.meta.url))});
  const {useStore}=await import(${fixtureImport(new URL("../src/mainview/store.ts", import.meta.url))});
  const {prepareMarkdown}=await import(${fixtureImport(new URL("../src/mainview/markdown-processing.ts", import.meta.url))});
  const {emptyTranscript}=await import(${fixtureImport(new URL("../src/shared/transcript.ts", import.meta.url))});
  window.__requests={listSlashCommands:()=>[]};
  useStore.setState(s=>({settings:{...s.settings,language:'en'}}));
  const code=Array.from({length:80},(_,i)=>'  const value'+i+' = call('+i+');').join('\\n');
  const markdown='~~~ts\\n'+code+'\\n~~~';
  await highlightCode(code+'\\n','ts');await prepareMarkdown(markdown);
  const assistant=text=>({role:'assistant',content:[{type:'text',text}],api:'openai-responses',
    provider:'fixture',model:'fixture',stopReason:'stop',timestamp:1,
    usage:{input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}}});
  const records=Array.from({length:${history}*2},(_,i)=>({id:'saved-'+i,entryId:'saved-'+i,
    parentId:i?'saved-'+(i-1):null,branchId:'branch',order:i,kind:'message',
    message:i%2?assistant(markdown):{role:'user',content:'Please explain this code.',timestamp:0}}));
  records.push({id:'latest-user',entryId:'latest-user',parentId:records.at(-1)?.id??null,
    branchId:'branch',order:records.length,kind:'message',message:{role:'user',content:'Continue please.',timestamp:2}});
  const base={address:{hostId:'profile',sessionId:'profile',epoch:1},snapshotSeq:1,
    info:{id:'profile',cwd:'fixture',title:'Fixture',modified:0},effort:'off',effortLevels:[],
    transcript:{...emptyTranscript(),history:{revision:'branch'},running:true,current:'live'}};
  let text='Current answer.';
  const snapshot=seq=>({...base,snapshotSeq:seq,transcript:{...base.transcript,records:[...records,
    {id:'live',parentId:records.at(-1)?.id??null,branchId:'branch',order:records.length,kind:'message',message:assistant(text)}]}});
  const mountStart=performance.now();
  flushSync(()=>root.render(<Chat snapshot={snapshot(1)}/>));await wait();await sleep(180);
  metrics.mountToSettledMs=performance.now()-mountStart;
  const thread=document.querySelector('.thread-scroll');
  check(thread&&document.querySelectorAll('.prose code').length===${history},'all saved code blocks must mount');
  thread.scrollTop=${position === "top" ? "0" : "thread.scrollHeight"};
  thread.dispatchEvent(new Event('scroll',{bubbles:true}));await wait();
  const beforeTop=thread.scrollTop,first=document.querySelector('.prose code');
  const historyMutations=[];
  const mutation=new MutationObserver(entries=>historyMutations.push(...entries));
  if(first)mutation.observe(first,{childList:true,characterData:true,subtree:true});
  const descriptor=Object.getOwnPropertyDescriptor(Element.prototype,'scrollHeight');
  const reads=[];check(descriptor?.get,'scrollHeight accessor required');
  Object.defineProperty(Element.prototype,'scrollHeight',{...descriptor,get(){
    const start=performance.now();const value=descriptor.get.call(this);
    if(measuring)reads.push(performance.now()-start);return value;
  }});
  const commits=[];
  metrics.dom=count(thread);
  measuring=true;previous=0;
  for(let i=0;i<32;i++){
    text+=' More text.';
    const start=performance.now();
    flushSync(()=>root.render(<Chat snapshot={snapshot(i+2)}/>));
    commits.push(performance.now()-start);
    await sleep(32);
  }
  await sleep(180);await wait();measuring=false;
  check(document.querySelector('[data-record-id="live"]').textContent.includes(text),'last sampled answer must be complete');
  check(!historyMutations.length,'stable saved code must not mutate on live updates');
  if(${position === "top"}&&${history}>0)check(Math.abs(thread.scrollTop-beforeTop)<1,'rereading position must stay fixed');
  Object.assign(metrics,{history:${history},position:${JSON.stringify(position)},updates:32,
    commitIncludingLayout:stats(commits),scrollHeightReads:stats(reads),
    frames:stats(frames),longTasks:stats(longTasks),firstSavedCodeMutations:historyMutations.length});
  mutation.disconnect();Object.defineProperty(Element.prototype,'scrollHeight',descriptor);
  alive=false;observer.disconnect();root.unmount();
`;

const stream = (lines: number, kind: string) => `
  ${common}
  const {Markdown}=await import(${fixtureImport(new URL("../src/mainview/MessageContent.tsx", import.meta.url))});
  const {prepareMarkdown}=await import(${fixtureImport(new URL("../src/mainview/markdown-processing.ts", import.meta.url))});
  const {markdownWorker}=await import(${fixtureImport(new URL("../src/mainview/markdown-worker-client.ts", import.meta.url))});
  const {syntaxWorker}=await import(${fixtureImport(new URL("../src/mainview/syntax-worker-client.ts", import.meta.url))});
  const base=Array.from({length:${lines}},(_,i)=>'  const value'+i+' = call('+i+');').join('\\n');
  let code=base;
  const source=()=>${kind === "markdown" ? "'~~~ts\\n'+code+'\\n~~~'" : "code"};
  const render=()=>flushSync(()=>root.render(<div className="prose" style={{height:700,overflow:'auto'}}>
    ${kind === "markdown" ? "<Markdown text={source()} streaming/>" : '<pre><CodeText text={code} language="ts"/></pre>'}
  </div>));
  await highlightCode(code+${kind === "markdown" ? "'\\n'" : "''"},'ts');
  ${kind === "markdown" ? "await prepareMarkdown(source());" : ""}
  render();await wait();await sleep(180);
  const posted=[],roundTrips={syntax:[],markdown:[]},inflight=new WeakMap();
  const post=Worker.prototype.postMessage;
  Worker.prototype.postMessage=function(value,...rest){
    if(!inflight.has(this)){
      const jobs=new Map();inflight.set(this,jobs);
      this.addEventListener('message',event=>{
        const job=jobs.get(event.data?.id);
        if(job){roundTrips[job.kind].push(performance.now()-job.start);jobs.delete(event.data.id);}
      });
    }
    if(measuring&&value?.input?.text){
      const kind=value.input.language?'syntax':'markdown';
      posted.push({kind,chars:value.input.text.length});
      inflight.get(this).set(value.id,{kind,start:performance.now()});
    }
    return post.call(this,value,...rest);
  };
  const before={markdown:markdownWorker.stats(),syntax:syntaxWorker.stats()};
  metrics.dom=count(document.getElementById('root'));
  const commits=[];
  measuring=true;previous=0;
  for(let i=0;i<32;i++){
    code+='\\n// appended '+i;
    const start=performance.now();render();commits.push(performance.now()-start);
    await sleep(32);
  }
  const end=performance.now();
  await until(()=>!markdownWorker.stats().running&&!syntaxWorker.stats().running&&
    document.querySelector('pre')?.textContent.includes('// appended 31'),'all final text and workers must settle');
  // Include the 100ms Markdown sampler and the subsequent parse, not just a temporarily empty queue.
  await sleep(200);await until(()=>!markdownWorker.stats().running&&!syntaxWorker.stats().running,'final sampled jobs settle');
  await wait();measuring=false;
  const after={markdown:markdownWorker.stats(),syntax:syntaxWorker.stats()};
  const delta=key=>Object.fromEntries(['posted','completed','cancelled'].map(k=>[k,after[key][k]-before[key][k]]));
  Object.assign(metrics,{kind:${JSON.stringify(kind)},lines:${lines},baseChars:base.length,appendedChars:code.length-base.length,
    updates:32,commitIncludingLayout:stats(commits),frames:stats(frames),longTasks:stats(longTasks),
    settlementWaitMs:performance.now()-end,workers:{markdown:delta('markdown'),syntax:delta('syntax')},
    workerRoundTripIncludingDeliveryMs:{markdown:stats(roundTrips.markdown),syntax:stats(roundTrips.syntax)},
    posted:posted.reduce((totals,p)=>({...totals,[p.kind]:(totals[p.kind]??0)+p.chars}),{})});
  check(document.querySelector('pre').textContent===code+${kind === "markdown" ? "'\\n'" : "''"},'exact final source');
  Worker.prototype.postMessage=post;alive=false;observer.disconnect();root.unmount();
`;

// Deliberate isolated prototype, NOT an app renderer. Colors only: reject fonts/backgrounds.
// Range counts and registration time are reported: fewer DOM nodes alone isn't a win.
const ranges = (blocks: number, representation: string) => `
  ${common}
  const text=Array.from({length:80},(_,i)=>'  const value'+i+' = call('+i+');').join('\\n');
  const tokens=await highlightCode(text,'ts');
  check(tokens&&tokens.flat().every(t=>!t.fontStyle&&!t.bgColor),'this color-only experiment must not drop font/background styling');
  const prototype=${representation.startsWith("ranges") || representation === "plain"};
  const colored=${representation.startsWith("ranges")};
  const visibleOnly=${representation === "ranges-visible"};
  const legacy=${representation === "legacy"};
  const lines=text.split('\\n');
  const start=performance.now();
  flushSync(()=>root.render(<div style={{height:700,overflow:'auto'}} data-scroller>{
    Array.from({length:${blocks}},(_,i)=><pre className="tool-code" key={i}>{
      prototype?lines.map((line,index)=><Fragment key={index}>{line+(index<lines.length-1?'\\n':'')}</Fragment>):
      <SyntaxRangesContext.Provider value={${representation === "native"}}><SavedOutputContext.Provider value={!legacy}><CodeText text={text} language="ts"/></SavedOutputContext.Provider></SyntaxRangesContext.Provider>
    }</pre>)
  }</div>));
  metrics.mountCommitMs=performance.now()-start;
  const groups=new Map();let rangeCount=0;const rangeUpdates=[];
  const register=performance.now();
  const scroller=document.querySelector('[data-scroller]');
  const pres=[...scroller.querySelectorAll('pre')];
  if(colored){
    check(CSS.highlights&&typeof Highlight==='function','CSS Highlight API required');
    for(const token of tokens.flat())if(token.color&&!groups.has(token.color))groups.set(token.color,new Highlight());
    const style=document.createElement('style');let index=0;
    for(const [color,highlight] of groups){
      const name='probe-code-'+index++;highlight.priority=-1;CSS.highlights.set(name,highlight);
      style.textContent+='::highlight('+name+'){color:'+color+';}';
    }
    document.head.append(style);
  }
  const updateRanges=()=>{
    if(!colored)return;
    const started=performance.now();
    for(const group of groups.values())group.clear();
    rangeCount=0;
    const viewport=visibleOnly?scroller.getBoundingClientRect():null;
    for(const pre of pres){
      check(pre.childNodes.length===lines.length,'one stable text node per source line');
      const rect=visibleOnly?pre.getBoundingClientRect():null;
      if(rect&&(rect.bottom<viewport.top||rect.top>viewport.bottom))continue;
      const style=visibleOnly?getComputedStyle(pre):null;
      const lineHeight=style?parseFloat(style.lineHeight):0;
      const firstLineY=style?rect.top+parseFloat(style.paddingTop)-pre.scrollTop:0;
      tokens.forEach((line,index)=>{
        if(rect&&(firstLineY+(index+1)*lineHeight<Math.max(viewport.top,rect.top)-lineHeight||
          firstLineY+index*lineHeight>Math.min(viewport.bottom,rect.bottom)+lineHeight))return;
        let offset=0;
        for(const token of line){
          if(token.color&&token.content.trim()){
            const key=token.color;
            const range=new Range();range.setStart(pre.childNodes[index],offset);
            range.setEnd(pre.childNodes[index],offset+token.content.length);
            groups.get(key).add(range);rangeCount++;
          }
          offset+=token.content.length;
        }
      });
    }
    rangeUpdates.push(performance.now()-started);
  };
  updateRanges();
  metrics.rangeRegistrationMs=performance.now()-register;
  const layout=performance.now();void scroller.scrollHeight;
  metrics.initialLayoutMs=performance.now()-layout;
  await wait();
  const first=scroller.querySelector('pre'),range=new Range();
  range.selectNodeContents(first);getSelection().addRange(range);
  check(getSelection().toString()===text,'native selection keeps exact source');
  getSelection().removeAllRanges();
  check([...scroller.querySelectorAll('pre')].every(pre=>pre.textContent===text),'all source kept');
  await document.fonts.ready;await wait();
  const pixel=await capturePixels(),rect=first.getBoundingClientRect();
  let hash=2166136261;
  for(let y=2;y<28;y++)for(let x=10;x<300;x++)for(const value of pixel(rect.left+x,rect.top+y))
    hash=Math.imul(hash^value,16777619)>>>0;
  metrics.firstLinePixelHash=hash;
  const textNodes=[],walker=document.createTreeWalker(first,NodeFilter.SHOW_TEXT);
  while(walker.nextNode())textNodes.push(walker.currentNode);
  metrics.firstLineGlyphs=Array.from({length:lines[0].length},(_,offset)=>{
    let left=offset,node=textNodes[0];
    for(const candidate of textNodes){node=candidate;if(left<candidate.length)break;left-=candidate.length;}
    const glyph=new Range();glyph.setStart(node,left);glyph.setEnd(node,left+1);
    const bounds=glyph.getBoundingClientRect();
    return [bounds.left-rect.left,bounds.top-rect.top,bounds.width,bounds.height];
  });
  metrics.dom=count(scroller);
  const resize=[],scroll=[];
  measuring=true;previous=0;
  for(let i=0;i<12;i++){
    let at=performance.now();scroller.style.width=(i%2?800:760)+'px';void scroller.scrollHeight;resize.push(performance.now()-at);
    at=performance.now();scroller.scrollTop=scroller.scrollHeight*(i/11);
    if(visibleOnly)updateRanges();
    void first.offsetHeight;scroll.push(performance.now()-at);
    await wait();
  }
  measuring=false;
  Object.assign(metrics,{blocks:${blocks},representation:${JSON.stringify(representation)},rangeCount,
    rangeUpdates:stats(rangeUpdates.slice(1)),
    resizeWithForcedLayout:stats(resize),scrollWithLayout:stats(scroll),frames:stats(frames),longTasks:stats(longTasks)});
  frames.length=0;longTasks.length=0;previous=0;
  const scrolling=[];
  measuring=true;
  for(let i=0;i<24;i++){
    const at=performance.now();
    scroller.scrollTop=(scroller.scrollHeight-scroller.clientHeight)*(i<12?i/11:(23-i)/11);
    if(visibleOnly)updateRanges();
    void first.offsetHeight;scrolling.push(performance.now()-at);
    await wait();
  }
  measuring=false;
  metrics.scrollOnly={sync:stats(scrolling),frames:stats(frames),longTasks:stats(longTasks)};
  if(prototype)for(let i=0;i<groups.size;i++)CSS.highlights.delete('probe-code-'+i);
  alive=false;observer.disconnect();root.unmount();
`;

const checkpoints = (language: "typescript" | "html" | "python") => `
  ${common}
  const {createHighlighterCore}=await import(${fixtureImport(import.meta.resolve("shiki/core"))});
  const {createJavaScriptRegexEngine}=await import(${fixtureImport(import.meta.resolve("shiki/engine/javascript"))});
  const {default:grammar}=await import(${fixtureImport(import.meta.resolve(`shiki/langs/${language}.mjs`))});
  const {default:theme}=await import(${fixtureImport(import.meta.resolve("shiki/themes/nord.mjs"))});
  const engine=await createHighlighterCore({engine:createJavaScriptRegexEngine(),themes:[theme],langs:[grammar]});
  const language=${JSON.stringify(language)};
  const ordinary=language==='typescript'?'const value = call(1);':language==='html'?'<section>text</section>':'value = call(1)';
  const opening=language==='typescript'?'/* open comment':language==='html'?'<script>':'text = """open';
  const prefix=Array(1499).fill(ordinary).join('\\n')+'\\n'+opening;
  const options={lang:language,theme:'nord',tokenizeMaxLineLength:2000,tokenizeTimeLimit:0};
  const stable=engine.codeToTokensBase(prefix,options),state=engine.getLastGrammarState(stable);
  const fullTimes=[],suffixTimes=[];
  // Compare token text AND visible styles AND adjusted offsets, not just final text.
  const normalized=(tokens,shift=0)=>tokens.map(line=>line.map(t=>({
    content:t.content,offset:t.offset+shift,color:t.color,bgColor:t.bgColor,fontStyle:t.fontStyle
  })));
  for(let i=0;i<16;i++){
    const suffix=language==='typescript'?'more text\\n*/\\nconst next = '+i+';':
      language==='html'?'const next = '+i+';\\n</script>\\n<div>tail</div>':'more text\\n"""\\nnext = '+i;
    let full,tail;
    const baseline=()=>{const at=performance.now();full=engine.codeToTokensBase(prefix+'\\n'+suffix,options);fullTimes.push(performance.now()-at);};
    const incremental=()=>{const at=performance.now();tail=engine.codeToTokensBase(suffix,{...options,grammarState:state});suffixTimes.push(performance.now()-at);};
    if(i%2){baseline();incremental();}else{incremental();baseline();}
    check(JSON.stringify(normalized(full))===JSON.stringify([...normalized(stable),...normalized(tail,prefix.length+1)]),
      'checkpoint must match full oracle including multiline lexical state and offsets');
    await sleep(0);
  }
  Object.assign(metrics,{language,prefixLines:1500,oracleUpdates:16,
    fullTokenizationMs:stats(fullTimes.slice(2)),checkpointSuffixMs:stats(suffixTimes.slice(2)),
    note:'Fixed unchanged prefix only; initial state creation excluded; no production queue/IPC/incremental editor implementation'});
  engine.dispose();alive=false;observer.disconnect();root.unmount();
`;

const cases =
  mode === "chat"
    ? [0, 50, 200].flatMap((history) =>
        ["bottom", "top"].map((position) => ({
          name: `chat-${history}-${position}`,
          source: chat(history, position),
        })),
      )
    : mode === "stream"
      ? [80, 1500].flatMap((lines) =>
          ["code", "markdown"].map((kind) => ({
            name: `stream-${lines}-${kind}`,
            source: stream(lines, kind),
          })),
        )
      : mode === "checkpoints"
        ? (["typescript", "html", "python"] as const).map((language) => ({
            name: `checkpoint-${language}`,
            source: checkpoints(language),
          }))
        : [20, 200].flatMap((blocks) =>
            [
              "legacy",
              "compact",
              "native",
              "ranges",
              "ranges-visible",
              "plain",
            ].map((representation) => ({
              name: `structure-${blocks}-${representation}`,
              source: ranges(blocks, representation),
            })),
          );
console.info(
  "Synthetic Edge / GPU disabled / warm shared parse inputs. No IPC, no real-session memory or input-latency claim.",
);
// Reversing independently-started cases helps spot warmup/order artifacts.
if (process.argv.includes("--reverse")) cases.reverse();
const selected = process.argv
  .find((arg) => arg.startsWith("--case="))
  ?.slice(7);
if (selected && !cases.some((probe) => probe.name === selected))
  throw new Error(`Unknown probe case: ${selected}`);
for (const probe of cases.filter(
  (probe) => !selected || probe.name === selected,
))
  await runUiFixture(probe.name, probe.source, {
    viewport: { width: 1100, height: 800 },
  });
