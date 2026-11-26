// Temporary probe: how much of chat mount/update time is React render work (what Solid could remove)?
import { fixtureHelpers, fixtureImport, runUiFixture } from "./ui-fixture";

const probe = (history: number) => `
  const {createRoot}=await import(${fixtureImport(import.meta.resolve("react-dom/profiling"))});
  const {flushSync}=await import(${fixtureImport(import.meta.resolve("react-dom"))});
  const {Profiler}=await import(${fixtureImport(import.meta.resolve("react"))});
  await import(${fixtureImport(new URL("../src/mainview/styles.css", import.meta.url))});
  const {Chat}=await import(${fixtureImport(new URL("../src/mainview/App.tsx", import.meta.url))});
  const {useStore}=await import(${fixtureImport(new URL("../src/mainview/store.ts", import.meta.url))});
  const {prepareMarkdown}=await import(${fixtureImport(new URL("../src/mainview/markdown-processing.ts", import.meta.url))});
  const {highlightCode}=await import(${fixtureImport(new URL("../src/mainview/syntax-highlighting.ts", import.meta.url))});
  const {emptyTranscript}=await import(${fixtureImport(new URL("../src/shared/transcript.ts", import.meta.url))});
  ${fixtureHelpers}
  if(${process.env.CV ? 1 : 0})document.head.insertAdjacentHTML('beforeend','<style>[data-record-id]{content-visibility:auto;contain-intrinsic-size:auto 300px}</style>');
  const root=createFixtureRoot(createRoot);
  const sleep=ms=>new Promise(r=>setTimeout(r,ms));
  const sum=a=>a.reduce((x,y)=>x+y,0);
  const p=(a,q)=>{const s=[...a].sort((x,y)=>x-y);return s[Math.ceil(s.length*q)-1]??0;};
  window.__requests={listSlashCommands:()=>[]};
  useStore.setState(s=>({settings:{...s.settings,language:'en'}}));
  const code=Array.from({length:80},(_,i)=>'  const value'+i+' = call('+i+');').join('\\n');
  const markdown='Some **prose** with a [link](https://x.y) and a list:\\n\\n- one\\n- two\\n\\n~~~ts\\n'+code+'\\n~~~';
  await highlightCode(code+'\\n','ts');await prepareMarkdown(markdown);
  const assistant=text=>({role:'assistant',content:[{type:'text',text}],api:'openai-responses',
    provider:'fixture',model:'fixture',stopReason:'stop',timestamp:1,
    usage:{input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}}});
  const records=Array.from({length:${history}*2},(_,i)=>({id:'saved-'+i,entryId:'saved-'+i,
    parentId:i?'saved-'+(i-1):null,branchId:'branch',order:i,kind:'message',
    message:i%2?assistant(markdown):{role:'user',content:'Please explain this code.',timestamp:0}}));
  const base={address:{hostId:'profile',sessionId:'profile',epoch:1},snapshotSeq:1,
    info:{id:'profile',cwd:'fixture',title:'Fixture',modified:0},effort:'off',effortLevels:[],
    transcript:{...emptyTranscript(),history:{revision:'branch'},running:true,current:'live'}};
  let text='Current answer.';
  const snapshot=seq=>({...base,snapshotSeq:seq,transcript:{...base.transcript,records:[...records,
    {id:'live',parentId:records.at(-1)?.id??null,branchId:'branch',order:records.length,kind:'message',message:assistant(text)}]}});
  let renders=[];
  const onRender=(_id,_phase,actual)=>renders.push(actual);
  const view=seq=><Profiler id="chat" onRender={onRender}><Chat snapshot={snapshot(seq)}/></Profiler>;
  // mount
  renders=[];
  let t=performance.now();
  flushSync(()=>root.render(view(1)));
  const mountCommit=performance.now()-t;
  const mountReact=sum(renders);
  t=performance.now();void document.body.offsetHeight;const mountLayout=performance.now()-t;
  renders=[];await wait();await sleep(300);
  const mountFollowReact=sum(renders);
  const thread=document.querySelector(".thread-scroll");
  check(thread.scrollHeight-thread.clientHeight-thread.scrollTop<=2,"chat must open at end: "+[thread.scrollTop,thread.scrollHeight,thread.clientHeight]);
  // streaming updates
  const wall=[],react=[],layout=[];let followReact=0;
  for(let i=0;i<32;i++){
    text+=' More **text** here.';
    renders=[];
    t=performance.now();flushSync(()=>root.render(view(i+2)));wall.push(performance.now()-t);
    react.push(sum(renders));
    t=performance.now();void document.body.offsetHeight;layout.push(performance.now()-t);
    renders=[];await sleep(32);followReact+=sum(renders);
  }
  const f=n=>Math.round(n*10)/10;
  window.__fixtureMetrics=({history:${history},
    mount:{flushSyncMs:f(mountCommit),reactRenderMs:f(mountReact),extraLayoutMs:f(mountLayout),followupReactMs:f(mountFollowReact)},
    update:{flushSyncMean:f(sum(wall)/32),flushSyncP95:f(p(wall,.95)),reactRenderMean:f(sum(react)/32),reactRenderP95:f(p(react,.95)),
      extraLayoutMean:f(sum(layout)/32),asyncReactTotalOver32:f(followReact)},
    dom:document.querySelectorAll('*').length});
  // Framework-independent cost: full style+layout of the same DOM.
  const host=document.getElementById('root');host.style.display='none';void document.body.offsetHeight;
  t=performance.now();host.style.display='';void document.body.offsetHeight;
  window.__fixtureMetrics.fullStyleLayoutMs=f(performance.now()-t);
  if (${history}===500) {
    await wait();thread.scrollTop=thread.scrollHeight;await wait();
    const rect=thread.getBoundingClientRect(),before=thread.scrollTop;
    const reader=[...thread.querySelectorAll('[data-record-id]')].find(r=>r.getBoundingClientRect().bottom>rect.top+24);
    const y=reader.getBoundingClientRect().top;
    window.__fixtureInput={method:'Input.dispatchMouseEvent',params:{type:'mouseWheel',x:rect.left+12,y:rect.top+80,deltaX:0,deltaY:-420}};
    await until(()=>!window.__fixtureInput && thread.scrollTop<before,'wheel failed');await wait();
    const movement=reader.getBoundingClientRect().top-y;
    window.__fixtureMetrics.wheel={input:-420,offsetDelta:thread.scrollTop-before,readerMovement:movement};
    check(reader.isConnected && Math.abs(movement-420)<=2,'wheel reader drift: '+JSON.stringify(window.__fixtureMetrics.wheel));
  }
  root.unmount();await sleep(100);
  const root2=createFixtureRoot(createRoot);
  renders=[];t=performance.now();flushSync(()=>root2.render(view(99)));
  window.__fixtureMetrics.warmMount={flushSyncMs:f(performance.now()-t),reactRenderMs:f(sum(renders))};
  root2.unmount();
`;

for (const history of process.argv.includes("--scale")
  ? [50, 500, 2500]
  : process.argv.includes("--thousand")
    ? [500]
    : process.argv.includes("--short")
      ? [50]
      : [50, 200])
  await runUiFixture(`react-share-${history}`, probe(history), {
    viewport: { width: 1100, height: 800 },
  });
