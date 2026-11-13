import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import { build as buildStyles } from "vite";
import { renderWorkerFixturePlugin } from "../../scripts/render-worker-fixture";

const edge =
  process.env.PIG_UI_BROWSER ??
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";

test.skipIf(!existsSync(edge) && !process.env.PIG_REQUIRE_UI_TESTS)(
  "transcript in Edge: native scrolling, scrollbar geometry, history, attachments and streaming",
  async () => {
    if (!existsSync(edge))
      throw new Error(
        "Required UI browser is missing; set PIG_UI_BROWSER to Edge/Chromium.",
      );
    const dir = await mkdtemp(join(tmpdir(), "piris-transcript-ui-"));
    let passed = false;
    try {
      const source = (name: string) =>
        JSON.stringify(fileURLToPath(new URL(name, import.meta.url)));
      const entry = join(dir, "fixture.tsx");
      await Bun.write(
        entry,
        `
      import {useState} from ${JSON.stringify(fileURLToPath(import.meta.resolve("react")))};
      import {createRoot} from ${JSON.stringify(fileURLToPath(import.meta.resolve("react-dom/client")))};
      import {flushSync} from ${JSON.stringify(fileURLToPath(import.meta.resolve("react-dom")))};
      import {Chat} from ${source("./App.tsx")};
      import {MainViewport} from ${source("./MainViewport.tsx")};
      import {WindowTitlebar} from ${source("./WindowTitlebar.tsx")};
      import {Composer} from ${source("./Composer.tsx")};
      import {ModelPicker} from ${source("./ModelPicker.tsx")};
      import {SessionList} from ${source("./SessionList.tsx")};
      import {Settings} from ${source("./Settings.tsx")};
      import {ProviderUsageView} from ${source("./ProviderUsageView.tsx")};
      import {usageFixtures,usageFixtureTime} from ${source("../stories/providers/usage-fixtures.ts")};
      import {defaultModelPreference} from ${source("./ui-mutations.ts")};
      import {accountSourceKey,accountModelKey} from ${source("../shared/account-models.ts")};
      import {OpeningComposer} from ${source("./ChatOpening.tsx")};
      import {MessageQueue} from ${source("./MessageQueue.tsx")};
      import {AnnotationPopover} from ${source("./AnnotationPopover.tsx")};
      import {AnnotationDrafts} from ${source("./AnnotationCards.tsx")};
      import {rememberAnnotationRange} from ${source("./annotation-highlights.ts")};
      import {drafts} from ${source("./draft-store.ts")};
      import {addressKey,newerSnapshot} from ${source("./chat-snapshot.ts")};
      import {ToolBlock,ToolGroup,ThinkingBlock} from ${source("./ToolBlock.tsx")};
      import {DisclosureScope} from ${source("./LazyDetails.tsx")};
      import {Markdown,BuiltinMarkdown,markdownComponents} from ${source("./MessageContent.tsx")};
      import ReactMarkdown from ${JSON.stringify(fileURLToPath(import.meta.resolve("react-markdown")))};
      import remarkGfm from ${JSON.stringify(fileURLToPath(import.meta.resolve("remark-gfm")))};
      import remarkMath from ${JSON.stringify(fileURLToPath(import.meta.resolve("remark-math")))};
      import rehypeKatex from ${JSON.stringify(fileURLToPath(import.meta.resolve("rehype-katex")))};
      import {normalizeMath} from ${source("../shared/math.ts")};
      import {markdownUrl} from ${source("./markdown-url.ts")};
      import {CodeText,TerminalOutput} from ${source("./HighlightedCode.tsx")};
      import {sizeEditor} from ${source("./ComposerEditor.tsx")};
      import {highlightCode} from ${source("./syntax-highlighting.ts")};
      import {prepareMarkdown} from ${source("./markdown-processing.ts")};
      import {syntaxWorker} from ${source("./syntax-worker-client.ts")};
      import {markdownWorker} from ${source("./markdown-worker-client.ts")};
      import {installChatRenderers} from ${source("./chat-renderer-registry.ts")};
      import {useStore} from ${source("./store.ts")};
      const root=createRoot(document.getElementById("root"));
      const wait=()=>new Promise(resolve=>{const timer=setTimeout(resolve,100);requestAnimationFrame(()=>requestAnimationFrame(()=>{clearTimeout(timer);resolve();}));});
      const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
      const check=(value,message)=>{if(!value) throw new Error(message);};
      const until=async(predicate,message)=>{const end=performance.now()+3000;while(!predicate()){check(performance.now()<end,message);await wait();}};
      const render=async node=>{flushSync(()=>root.render(node));await wait();};
      const metrics=window.__transcriptMetrics={wheels:[],loaded:[]};
      const click=async element=>{check(element,"missing click target");element.click();await wait();};
      const button=(parent,text)=>[...parent.querySelectorAll("button")].find(b=>b.textContent===text);
      const visible=element=>!!element?.checkVisibility({visibilityProperty:true});
      // Only CDP supplies wheel input; the fixture never assigns scrollTop to simulate it.
      async function wheel(element,deltaY){
        const rect=element.getBoundingClientRect();
        check(visible(element) && rect.height>0,"wheel target must be visible");
        const before=element.scrollTop;
        const expected=Math.max(0,Math.min(element.scrollHeight-element.clientHeight,before+deltaY));
        check(Math.abs(expected-before)>2,"wheel needs room to scroll");
        const row=element.matches(".thread-scroll")?[...element.querySelectorAll("[data-record-id]")].find(row=>row.getBoundingClientRect().bottom>rect.top+24):undefined;
        const rowTop=row?.getBoundingClientRect().top;
        let received;
        element.addEventListener("wheel",event=>{received=event;},{once:true,passive:true});
        window.__transcriptWheel={type:"mouseWheel",x:rect.left+(element.matches(".thread-scroll")?12:rect.width/2),y:rect.top+Math.min(rect.height,innerHeight-rect.top)/2,deltaX:0,deltaY};
        await until(()=>!window.__transcriptWheel,"CDP did not dispatch wheel input");
        await until(()=>Math.abs(element.scrollTop-before)>2,"native wheel did not move the scroll container");
        let previous=element.scrollTop,stable=0;
        for(let frame=0;frame<120 && stable<4;frame++){await wait();const top=element.scrollTop;stable=Math.abs(top-previous)<0.5?stable+1:0;previous=top;}
        const after=element.scrollTop;
        const measurement={target:element.className,deltaY,before,after,expected,trusted:received?.isTrusted};
        metrics.wheels.push(measurement);
        check(stable===4 && received?.isTrusted && !received.defaultPrevented,"wheel must settle through the browser default action: "+JSON.stringify(measurement));
        check(Math.abs(after-expected)<=2,"wheel distance must match native scrolling: "+JSON.stringify(measurement));
        if(row) check(row.isConnected && Math.abs(row.getBoundingClientRect().top-rowTop+after-before)<=2,"record geometry must move with the native scroll position");
      }
      // Production usage dock: sidebar width, fixed 18px rings, display preference, stale data and scrolling.
      for(const width of [240,210]){
        await render(<div style={{width}}><ProviderUsageView entries={usageFixtures} now={usageFixtureTime}/></div>);
        const card=document.querySelector('.provider-usage-card');
        const rows=[...card.querySelectorAll('.provider-usage-row')];
        check(card.getBoundingClientRect().width===width,'usage dock must follow available sidebar width');
        check(rows.every(row=>row.getBoundingClientRect().height===22),'usage rows must remain compact and fixed height');
        check([...card.querySelectorAll('.provider-usage-ring')].every(r=>r.getBoundingClientRect().width===18 && r.getBoundingClientRect().height===18),'usage rings must be 18px');
        check(card.textContent.includes('1h 12m'),'usage countdown must be language-independent with spaced units');
        check(!card.textContent.includes('NaN'),'unknown reset/duration must not be invented');
        await render(<div style={{width}}><ProviderUsageView entries={usageFixtures} now={usageFixtureTime} display="used"/></div>);
        check(document.querySelector('.provider-usage-card').textContent.includes('88%'),'usage preference must change the displayed percentage');
        const lots=Array.from({length:30},(_,i)=>({...usageFixtures[0],key:'usage-'+i,label:'Account '+i}));
        await render(<div style={{width}}><ProviderUsageView entries={lots} now={usageFixtureTime}/></div>);
        const list=document.querySelector('.provider-usage-list');
        check(list.scrollHeight>list.clientHeight,'many accounts must scroll inside the usage dock');
        list.scrollTop=list.scrollHeight;await wait();
        const last=list.lastElementChild.getBoundingClientRect();
        check(last.bottom<=list.getBoundingClientRect().bottom+1,'last usage account must be reachable');
      }
      const base={address:{hostId:"ui",sessionId:"chat",epoch:1},snapshotSeq:1,info:{id:"chat",cwd:"fixture",title:"Fixture",modified:1},effort:"off",effortLevels:[],ready:false};
      const record=(id,order,message)=>({id,parentId:null,branchId:"branch",order,kind:"message",message});
      const transcript=records=>({records,tools:{},history:{revision:"branch"},current:null,running:false,liveToEntry:{}});
      const user=i=>record("r"+i,i,{role:"user",content:"Question "+i+" "+(i===5?"needle-search ":"")+"wrapping words ".repeat(20),timestamp:i});
      const assistant=(id,order,content)=>record(id,order,{role:"assistant",content,api:"openai-responses",provider:"fixture",model:"fixture",usage:{input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}},stopReason:"stop",timestamp:order});
      function StoredChat({id}){const snapshot=useStore(state=>state.snapshots[id]);return <Chat snapshot={snapshot}/>;}
      const show=async snapshot=>{flushSync(()=>useStore.setState(state=>({snapshots:{...state.snapshots,[snapshot.info.id]:snapshot},settings:{...state.settings,language:"en"}})));await render(<StoredChat key={snapshot.info.id+":"+snapshot.address.epoch} id={snapshot.info.id}/>);};
      let snapshot;
      metrics.stage="titlebar-clipping";
      metrics.titlebarClipping=[];
      for(const collapsed of [false,true]){
        await render(<div className={"app-shell"+(collapsed?" sidebar-collapsed":"")}><aside className="sidebar"/><MainViewport><Chat snapshot={{...base,transcript:transcript(Array.from({length:40},(_,i)=>user(i)))}}/></MainViewport><WindowTitlebar maximized={false} onAction={()=>{}}/></div>);
        const bar=document.querySelector('.window-titlebar'),clip=document.querySelector('.main-clip'),thread=document.querySelector('.thread-scroll');
        await pause(220);
        const measure=()=>{
          const nodes=[document.querySelector('.session-layout'),document.querySelector('.composer'),document.querySelector('[data-record-id="r20"]'),thread];
          return [...nodes.flatMap(node=>{check(node,"missing titlebar measurement target");const r=node.getBoundingClientRect();return [r.x,r.y,r.width,r.height];}),thread.scrollTop,thread.scrollHeight,thread.clientHeight];
        };
        for(const position of ['top','middle','bottom']){
          thread.scrollTop=position==='top'?0:position==='bottom'?thread.scrollHeight:1000;await wait();
          const before=measure();
          for(const expanded of [true,false]){
            if(expanded){const r=bar.getBoundingClientRect();window.dispatchEvent(new MouseEvent('mousemove',{clientX:r.left+100,clientY:2}));}
            else window.dispatchEvent(new Event('blur'));
            for(let frame=0;frame<6;frame++){
              await pause(35);
              check(measure().every((value,i)=>Math.abs(value-before[i])<0.01),'titlebar must not resize or move chat/composer/records or change scroll position during animation');
            }
            check(bar.dataset.expanded===String(expanded),'titlebar hover must change visibility');
            const bounds=clip.getBoundingClientRect();
            check(Math.abs(bounds.top-(expanded?34:8))<0.01,'only the clipping boundary should move');
            if(expanded){
              check(!!document.elementFromPoint(bounds.left+100,20)?.closest('.window-titlebar'),'revealed band must receive pointer input');
              check(!document.elementFromPoint(bounds.left+100,33)?.closest('.main-viewport'),'clipped content must not receive pointer input');
            }
          }
          metrics.titlebarClipping.push({collapsed,position,drift:0});
        }
        bar.focus();await pause(220);
        check(Math.abs(clip.getBoundingClientRect().top-34)<0.01,'keyboard focus must reveal the band');
        bar.blur();await pause(220);
      }
      metrics.stage="response-errors";
      const providerError='429 {"type":"error","error":{"type":"rate_limit_error","message":"Please try again later."},"request_id":"req_ui_error"}';
      const failedRecord=assistant("failed",1,[]);
      failedRecord.message.stopReason="error";failedRecord.message.errorMessage=providerError;
      await show({...base,failure:providerError,transcript:transcript([user(0),failedRecord])});
      const errorCard=document.querySelector(".response-error");
      check(document.querySelectorAll(".response-error").length===1,"model failure must not be duplicated as a session failure");
      check(errorCard.getAttribute("role")==="alert" && errorCard.textContent.includes("rate limit reached"),"model failure must explain why the response stopped");
      check(!errorCard.querySelector("pre") && !errorCard.textContent.includes("req_ui_error"),"raw provider JSON must be collapsed by default");
      await click(errorCard.querySelector("summary"));
      check(errorCard.querySelector("pre").textContent===providerError,"expanded error details must preserve the original error");
      await show({...base,failure:"Unexpected runtime failure",transcript:transcript([])});
      check(document.querySelectorAll(".response-error").length===1 && document.querySelector(".response-error").textContent.includes("an error occurred"),"standalone runtime failures must use the same renderer");
      metrics.responseSpacing=[];
      for(const changed of [false,true]){
        const firstAnswer=assistant("spacing-first",1,[{type:"text",text:"Previous response"}]);
        firstAnswer.message.provider="anthropic";firstAnswer.message.model="claude-opus-5-5";firstAnswer.message.usage.totalTokens=483000;
        const nextAnswer=assistant("spacing-next",3,[{type:"text",text:"Next response"}]);
        nextAnswer.message.provider=firstAnswer.message.provider;nextAnswer.message.model=firstAnswer.message.model;
        if(changed){nextAnswer.message.provider="openai-codex";nextAnswer.message.model="gpt-6.1-sol";}
        await show({...base,transcript:transcript([user(0),firstAnswer,user(2),nextAnswer])});
        const spacingThread=document.querySelector(".thread-scroll");
        for(const width of [900,360]){
          spacingThread.style.width=width+"px";await wait();
          const turn=document.querySelector('[data-record-id="spacing-first"]');
          const footer=turn.querySelector(".response-footer"),meta=footer.querySelector(".response-meta"),actions=footer.querySelector(".response-actions");
          const next=document.querySelector('[data-record-id="r2"]');
          const boundary=next.querySelector(changed?".model-divider":".user-bubble");
          const metaRect=meta.getBoundingClientRect(),actionsRect=actions.getBoundingClientRect();
          check(actionsRect.top>=metaRect.top-1 && actionsRect.bottom<=metaRect.bottom+3 && actionsRect.left>=metaRect.right-1,"response actions must share the metadata row, not reserve a hidden row or overlap metadata");
          const gap=boundary.getBoundingClientRect().top-footer.getBoundingClientRect().bottom;
          check(Math.abs(gap-28)<=1,"response spacing must be a single 28px gap, including before a model divider: "+gap);
          if(changed) check(Math.abs(next.querySelector(".user-bubble").getBoundingClientRect().top-boundary.getBoundingClientRect().bottom-1.5*parseFloat(getComputedStyle(document.documentElement).fontSize))<=1,"model divider must retain its normal bottom spacing");
          const before=next.getBoundingClientRect().top,footerHeight=footer.getBoundingClientRect().height;
          // Measure focus styling, not the browser's native reveal of an offscreen button.
          actions.querySelector("button:not(:disabled)").focus({preventScroll:true});await wait();
          check(getComputedStyle(actions.querySelector("time")).opacity==="1" && next.getBoundingClientRect().top===before && footer.getBoundingClientRect().height===footerHeight,"revealing response actions must not shift the following turn: "+JSON.stringify({changed,width,before,after:next.getBoundingClientRect().top,footerHeight,afterHeight:footer.getBoundingClientRect().height,top:spacingThread.scrollTop,scrollHeight:spacingThread.scrollHeight,clientHeight:spacingThread.clientHeight}));
          document.activeElement.blur();
          metrics.responseSpacing.push({changed,width,gap,footerHeight});
        }
        spacingThread.style.removeProperty("width");
        if(changed){window.__scrollbarCapture=true;await until(()=>typeof window.__scrollbarCapture==="string","missing response spacing screenshot");window.__responseSpacingScreenshot=window.__scrollbarCapture;delete window.__scrollbarCapture;}
      }
      await render(<Markdown text={'~~~javascript\\nconst fixed = 1;\\n~~~\\n\\nBefore'}/>);
      await until(()=>document.querySelector("code"),"initial Markdown must finish through its worker");
      const streamingCode=document.querySelector(".syntax-token")?.closest("code")??document.querySelector("code");
      await render(<Markdown text={'~~~javascript\\nconst fixed = 1;\\n~~~\\n\\nAfter'}/>);
      check(streamingCode===document.querySelector("code"),"streaming Markdown must preserve unchanged code DOM, not remount its highlighter");
      // Replay IPC clones: immutable saved tools must not rerender on every token.
      let toolRenders=0;
      installChatRenderers([{id:"perf-tools",kind:"tool",component:({DefaultRenderer})=>{toolRenders++;return <DefaultRenderer/>;}}]);
      const perfRecords=[user(0)],perfTools={};
      for(let i=0;i<40;i++){
        const call={type:"toolCall",id:"perf-call-"+i,name:i%2?"read":"bash",arguments:i%2?{path:"fixture.ts"}:{command:"echo fixture"}};
        const turn=assistant("perf-step-"+i,perfRecords.length,[call]);turn.entryId=turn.id;perfRecords.push(turn);
        const result=record("perf-result-"+i,perfRecords.length,{role:"toolResult",toolCallId:call.id,toolName:call.name,content:[{type:"text",text:"output line\\n".repeat(8)}],isError:false,timestamp:i});result.entryId=result.id;perfRecords.push(result);
        perfTools[call.id]={status:"done",result:{content:result.message.content}};
      }
      perfRecords.push(assistant("perf-live",perfRecords.length,[{type:"text",text:"Live"}]));
      let perfSnapshot={...base,transcript:{...transcript(perfRecords),tools:perfTools,running:true,current:"perf-live"}};
      await show(perfSnapshot);await pause(150);toolRenders=0;
      const perfStarted=performance.now();
      for(let i=0;i<6;i++){
        const incoming=structuredClone(perfSnapshot);incoming.snapshotSeq++;
        incoming.transcript.records.at(-1).message.content[0].text+=" token";
        perfSnapshot=newerSnapshot(perfSnapshot,incoming);await show(perfSnapshot);
      }
      metrics.streamingReplay={savedTools:40,updates:6,unchangedToolRenders:toolRenders,ms:performance.now()-perfStarted};
      check(toolRenders===0,"IPC clones must not rerender unchanged saved tools: "+JSON.stringify(metrics.streamingReplay));
      const groupedCalls=perfRecords.filter(record=>record.message?.role==="assistant").flatMap(record=>record.message.content).filter(block=>block.type==="toolCall" && block.name==="read");
      const groupedTurn=assistant("perf-group",1,groupedCalls);groupedTurn.entryId=groupedTurn.id;
      perfSnapshot={...perfSnapshot,transcript:{...perfSnapshot.transcript,records:[user(0),groupedTurn,...perfRecords.filter(record=>record.message?.role==="toolResult" && groupedCalls.some(call=>call.id===record.message.toolCallId)),perfRecords.at(-1)]}};
      await show(perfSnapshot);await click(document.querySelector(".tool-group > summary"));toolRenders=0;
      const groupClone=structuredClone(perfSnapshot);groupClone.snapshotSeq++;
      perfSnapshot=newerSnapshot(perfSnapshot,groupClone);await show(perfSnapshot);
      check(toolRenders===0,"an expanded exploration group must ignore unrelated cloned updates");
      const changedTool=structuredClone(perfSnapshot);changedTool.snapshotSeq++;changedTool.transcript.tools[groupedCalls[0].id].status="error";
      perfSnapshot=newerSnapshot(perfSnapshot,changedTool);await show(perfSnapshot);
      check(toolRenders===1 && document.querySelector(".tool-group-body .tool-row.error"),"group memoization must still update exactly the changed tool");
      metrics.streamingReplay.groupChangedToolRenders=toolRenders;
      installChatRenderers([]);
      for(const count of [50,1000]){
        snapshot={...base,transcript:transcript(Array.from({length:count},(_,i)=>user(i)))};
        const started=performance.now();await show(snapshot);
        const mounted=document.querySelectorAll("[data-record-id]");
        metrics.loaded.push({count,mounted:mounted.length,ms:performance.now()-started});
        check(mounted.length===count && [...mounted].every(visible),"all loaded conversation rows must remain rendered");
        check(!document.querySelector(".text-range"),"loaded rows must not have presentation paging");
      }
      const sizingEditor=document.querySelector("textarea"),sizingText=sizingEditor.value;
      metrics.editorSizing=[];
      for(const lines of [1,20]){
        const timings=[];
        for(let i=0;i<12;i++){
          sizingEditor.value=("wrapped editor words ".repeat(8)+"\\n").repeat(lines)+i;
          const start=performance.now();sizeEditor(sizingEditor);timings.push(performance.now()-start);
        }
        timings.sort((a,b)=>a-b);
        metrics.editorSizing.push({loadedRows:1000,lines,p95Ms:timings[Math.floor(timings.length*0.95)],meanMs:timings.reduce((sum,value)=>sum+value,0)/timings.length});
      }
      sizingEditor.value=sizingText;sizeEditor(sizingEditor);await wait();
      metrics.workerInput=[];
      async function workerInputProbe(kind,start,worker){
        const host=document.createElement("div");host.className="chat-shell";host.style.cssText="position:fixed;left:0;top:0;width:700px;height:300px;z-index:10000";document.body.append(host);
        const probeRoot=createRoot(host),probe={...base,address:{...base.address,sessionId:"worker-probe-"+kind},info:{...base.info,id:"worker-probe-"+kind}};
        flushSync(()=>probeRoot.render(<OpeningComposer preview={probe}/>));await wait();
        const editor=host.querySelector("textarea");editor.focus({preventScroll:true});
        let finished=false,received=false,receivedBeforeCompletion=false,trusted=false,ticks=0;
        const posted=worker.stats().posted;
        const task=start().finally(()=>{finished=true;});
        await until(()=>worker.stats().posted>posted,"the real "+kind+" worker must start its task: "+JSON.stringify({stats:worker.stats(),errors:window.__fixtureWorkerErrors}));
        const timer=setInterval(()=>ticks++,5),begin=performance.now();
        editor.addEventListener("input",event=>{received=true;receivedBeforeCompletion=!finished;trusted=event.isTrusted;},{once:true});
        window.__transcriptInput={text:"worker probe"};
        try{await until(()=>received,"trusted input must be delivered while "+kind+" runs");const inputMs=performance.now()-begin;await task;
          check(receivedBeforeCompletion && trusted && ticks>0 && !worker.stats().failed,"input/heartbeat must run before the heavy worker completes: "+kind);
          metrics.workerInput.push({kind,inputBeforeCompletion:receivedBeforeCompletion,trusted,inputMs,ticks,worker:worker.stats()});
        }finally{clearInterval(timer);probeRoot.unmount();host.remove();drafts.discard(probe.address,true);await wait();}
      }
      await workerInputProbe("syntax",()=>highlightCode("export const value = <span data-test='fixture'>content</span>;\\n".repeat(1000),"tsx"),syntaxWorker);
      await workerInputProbe("markdown",()=>prepareMarkdown("$$ x^2 + y^2 = z^2 $$\\n\\n".repeat(250)),markdownWorker);
      let thread=document.querySelector(".thread-scroll");
      check(getComputedStyle(thread).overflowY==="auto" && getComputedStyle(thread).overflowAnchor==="auto","the real stylesheet must allow browser scrolling and anchoring");
      const bubble=document.querySelector(".user-bubble");
      check(getComputedStyle(bubble).whiteSpace==="pre-wrap" && parseFloat(getComputedStyle(bubble).borderRadius)>0,"user bubbles must retain their original formatting");
      const writes=[];
      const scrollTop=Object.getOwnPropertyDescriptor(Element.prototype,"scrollTop");
      Object.defineProperty(thread,"scrollTop",{configurable:true,get(){return scrollTop.get.call(this);},set(value){writes.push(value);scrollTop.set.call(this,value);}});
      check(!document.querySelector(".thread-scroll-to-bottom"),"jump button must be absent at the bottom");
      const threadHeight=thread.clientHeight,composerTop=document.querySelector(".composer-dock").getBoundingClientRect().top;
      await wheel(thread,-420);await wheel(thread,160);await wheel(thread,-200);await wheel(thread,120);
      const jump=document.querySelector(".thread-scroll-to-bottom");
      check(visible(jump) && jump.getAttribute("aria-label")==="Scroll to bottom" && jump.title==="Scroll to bottom","reading earlier messages must show an accessible jump button");
      const jumpRect=jump.getBoundingClientRect(),shellRect=document.querySelector(".chat-shell").getBoundingClientRect();
      check(jumpRect.bottom<=composerTop && jumpRect.top>=shellRect.top && Math.abs(jumpRect.left+jumpRect.width/2-shellRect.left-shellRect.width/2)<=1,"jump button must float above the composer at the center of the chat");
      check(thread.clientHeight===threadHeight && document.querySelector(".composer-dock").getBoundingClientRect().top===composerTop,"showing the jump button must not shift the conversation or composer: "+JSON.stringify({threadHeight,afterHeight:thread.clientHeight,composerTop,afterTop:document.querySelector(".composer-dock").getBoundingClientRect().top,editor:document.querySelector("textarea").value,editorHeight:document.querySelector("textarea").getBoundingClientRect().height}));
      const jumpCanvas=document.createElement("canvas");jumpCanvas.width=jumpCanvas.height=1;
      const jumpContext=jumpCanvas.getContext("2d");jumpContext.fillStyle=getComputedStyle(jump).backgroundColor;jumpContext.fillRect(0,0,1,1);
      const jumpAlpha=jumpContext.getImageData(0,0,1,1).data[3];
      check(jumpAlpha>0 && jumpAlpha<255 && getComputedStyle(jump).opacity==="1","jump button must use a translucent surface without dimming its icon");
      window.__scrollbarCapture=true;await until(()=>typeof window.__scrollbarCapture==="string","missing jump button screenshot");window.__jumpButtonScreenshot=window.__scrollbarCapture;delete window.__scrollbarCapture;
      check(writes.length===0,"wheel input must not cause application scroll corrections");
      const reader=[...thread.querySelectorAll("[data-record-id]")].find(row=>row.getBoundingClientRect().top>=thread.getBoundingClientRect().top+24);
      const selected=reader.querySelector(".user-bubble");
      const selection=window.getSelection();const selectionRange=document.createRange();selectionRange.selectNodeContents(selected);selection.removeAllRanges();selection.addRange(selectionRange);
      const readingTop=thread.scrollTop,readingOffset=reader.getBoundingClientRect().top,readingHeight=thread.scrollHeight;
      snapshot={...snapshot,transcript:{...snapshot.transcript,records:[...snapshot.transcript.records,assistant("live",1000,[{type:"text",text:"Streaming starts"}])],current:"live",running:true}};await show(snapshot);
      snapshot={...snapshot,transcript:{...snapshot.transcript,records:[...snapshot.transcript.records.slice(0,-1),assistant("live",1000,[{type:"text",text:"**Streaming paragraph**\\n\\n".repeat(80)}])]}};await show(snapshot);await pause(150);await wait();
      await until(()=>document.querySelector('[data-record-id="live"] strong')?.textContent==="Streaming paragraph","rich streamed formatting must complete while reading earlier content");
      metrics.readingDrift=Math.abs(thread.scrollTop-readingTop);
      check(thread.scrollHeight>readingHeight+1000 && document.querySelector('[data-record-id="live"] .prose').textContent.includes("Streaming paragraph"),"streaming must actually grow the transcript below the reader");
      check(metrics.readingDrift<=2 && Math.abs(reader.getBoundingClientRect().top-readingOffset)<=2,"background append and streaming must leave the reader in place");
      check(selected.isConnected && selection.toString()===selected.textContent,"background updates must retain selected text and its DOM");selection.removeAllRanges();
      const first=thread.querySelector("[data-record-id]");first.style.minHeight=(first.getBoundingClientRect().height+128)+"px";await wait();await pause(100);
      metrics.nativeAnchorDrift=Math.abs(reader.getBoundingClientRect().top-readingOffset);
      check(metrics.nativeAnchorDrift<=2,"browser anchoring must handle late content growth above the reader");
      thread.style.width="700px";await wait();await pause(100);
      check(writes.length===0,"background content and resize observers must not write scrollTop while reading");
      await wheel(thread,-180);await wheel(thread,100);
      metrics.readerScrollWrites=writes.length;
      check(writes.length===0,"scrolling after layout changes must remain native");
      check(!document.querySelector(".transcript-search") && !document.querySelector('input[type="search"]'),"loaded-message search must not appear in a conversation");
      check(visible(document.querySelector(".thread-scroll-to-bottom")),"streaming and resizing must keep the jump button available while reading");
      const savedReadingTop=thread.scrollTop;
      await show({...base,address:{...base.address,sessionId:"short"},info:{...base.info,id:"short"},transcript:transcript([user(0)])});
      check(!document.querySelector(".thread-scroll-to-bottom"),"short conversations must not show a jump button");
      await show(snapshot);thread=document.querySelector(".thread-scroll");
      check(Math.abs(thread.scrollTop-savedReadingTop)<=2 && visible(document.querySelector(".thread-scroll-to-bottom")),"returning to an earlier reading position must restore the jump button");
      document.querySelector(".thread-scroll-to-bottom").focus();
      check(document.activeElement.matches(".thread-scroll-to-bottom"),"jump button must be keyboard focusable");
      await click(document.activeElement);
      check(thread.scrollHeight-thread.clientHeight-thread.scrollTop<=1 && !document.querySelector(".thread-scroll-to-bottom"),"clicking jump must reach the bottom and remove the button");
      snapshot={...snapshot,transcript:{...snapshot.transcript,records:[...snapshot.transcript.records,assistant("after-jump",1001,[{type:"text",text:"**New response after jump**\\n\\n".repeat(30)}])]}};await show(snapshot);
      await until(()=>document.querySelector('[data-record-id="after-jump"] strong')?.textContent==="New response after jump","rich formatting must complete after jumping to the bottom");
      await wait();
      check(thread.scrollHeight-thread.clientHeight-thread.scrollTop<=1 && !document.querySelector(".thread-scroll-to-bottom"),"jumping must resume automatic following through asynchronous formatting");
      metrics.asyncMarkdownFollowing=true;
      await wheel(thread,-200);
      check(visible(document.querySelector(".thread-scroll-to-bottom")),"scrolling away again must show the jump button");
      await wheel(thread,thread.scrollHeight);
      check(!document.querySelector(".thread-scroll-to-bottom"),"manually reaching the bottom must hide the jump button");
      const imageCanvas=document.createElement("canvas");imageCanvas.width=1000;imageCanvas.height=80;
      window.__requests={...window.__requests,attachmentPreview:async()=>imageCanvas.toDataURL("image/png")};
      const imagePath="C:/Users/me/attachments/"+"a".repeat(64)+".png";
      snapshot={...base,address:{...base.address,sessionId:"images"},info:{...base.info,id:"images"},transcript:transcript([record("image-user",0,{role:"user",content:"Attached image\\n\\n"+imagePath,timestamp:0})])};
      await show(snapshot);
      await until(()=>document.querySelector(".sent-attachments img")?.complete,"sent image must load");
      const image=document.querySelector(".sent-attachments .image-set");
      const imageBubble=document.querySelector(".user-bubble");
      check(Math.abs(image.getBoundingClientRect().right-imageBubble.getBoundingClientRect().right)<=2,"sent image must align with the right edge of its user bubble");
      check(image.getBoundingClientRect().bottom<=imageBubble.getBoundingClientRect().top,"sent image must remain above its user bubble");
      const preview=image.querySelector(".image-preview");
      await click(preview);
      let viewer=document.querySelector(".image-viewer");
      check(viewer?.open,"image preview must open a modal viewer");
      check(getComputedStyle(viewer).backgroundColor==="rgba(0, 0, 0, 0)","viewer surface must not hide the translucent backdrop");
      const backdropCanvas=document.createElement("canvas");backdropCanvas.width=backdropCanvas.height=1;
      const backdropContext=backdropCanvas.getContext("2d");backdropContext.fillStyle=getComputedStyle(viewer,"::backdrop").backgroundColor;backdropContext.fillRect(0,0,1,1);
      const backdropAlpha=backdropContext.getImageData(0,0,1,1).data[3];
      check(backdropAlpha>0 && backdropAlpha<255,"viewer backdrop must be translucent, not invisible or opaque");
      const zoom=viewer.querySelector(".image-viewer-zoom");
      await click(zoom.querySelector("img"));
      check(viewer.open && zoom.getAttribute("aria-pressed")==="true","clicking the image must zoom without closing");
      await click(zoom);
      check(viewer.open && zoom.getAttribute("aria-pressed")==="false","clicking the zoom control must fit the image without closing");
      for(const selector of [".image-viewer-viewport",".image-viewer-body",".image-viewer-header strong",".image-viewer"]){
        await click(document.querySelector(selector));
        check(!document.querySelector(".image-viewer"),"clicking outside the image must close the viewer: "+selector);
        check(document.activeElement===preview,"closing the viewer must restore focus to its preview");
        await click(preview);
      }
      viewer=document.querySelector(".image-viewer");
      viewer.dispatchEvent(new Event("cancel",{cancelable:true}));await wait();
      check(!document.querySelector(".image-viewer"),"Escape must still close the viewer");
      const historyRequests=[];
      window.__getSessionHistory=async request=>{historyRequests.push(request);return transcript(Array.from({length:100},(_,i)=>user(i)));};
      snapshot={...base,address:{...base.address,sessionId:"history"},info:{...base.info,id:"history"},transcript:{...transcript(Array.from({length:150},(_,i)=>user(i+100))),history:{revision:"branch",before:"r100"}}};
      await show(snapshot);thread=document.querySelector(".thread-scroll");await wheel(thread,-thread.scrollHeight);await pause(100);
      check(historyRequests.length===0 && !document.querySelector('[data-record-id="r0"]'),"scrolling to the top must not load history automatically");
      await click(button(document,"Load earlier messages"));
      await until(()=>document.querySelectorAll("[data-record-id]").length===250,"the earlier-history button must prepend its returned rows");
      check(JSON.stringify(historyRequests)==='[{"hostId":"ui","sessionId":"history","epoch":1,"revision":"branch","before":"r100"}]',"history must use the active session and cursor");
      check(document.querySelector('[data-record-id="r0"]') && document.querySelector('[data-record-id="r249"]') && !button(document,"Load earlier messages") && !document.querySelector(".text-range"),"all fetched history must be available without another presentation page");
      metrics.historyRows=document.querySelectorAll("[data-record-id]").length;
      const values={};
      const diff=Array.from({length:10000},(_,i)=>"+"+i+" changed").join("\\n");
      const edit=<DisclosureScope id="edit" values={values}><ToolBlock call={{id:"edit",name:"edit",arguments:{path:"file.ts"}}} state={{status:"done",result:{details:{diff}}}} live={false}/></DisclosureScope>;
      await render(edit);
      check(document.querySelector("details").open && visible(document.querySelector(".tool-diff")),"edits must start expanded");
      metrics.diffSpans=document.querySelectorAll(".tool-diff > span").length;
      check(metrics.diffSpans===10000 && visible(document.querySelector(".tool-diff")) && !document.querySelector(".text-range"),"expanded diff must show every line in the original scrollable preview");
      const checkPreviewRows=element=>{
        const originalSize=parseFloat(getComputedStyle(element).fontSize);
        for(const scale of [1,1.25]){
          element.style.fontSize=originalSize*scale+"px";
          const style=getComputedStyle(element),padding=parseFloat(style.paddingTop)+parseFloat(style.paddingBottom),border=parseFloat(style.borderTopWidth)+parseFloat(style.borderBottomWidth);
          const expected=8*parseFloat(style.lineHeight)+padding+border+parseFloat(style.getPropertyValue("--scrollbar-size"));
          check(Math.abs(parseFloat(style.maxHeight)-expected)<1,"file and shell previews must cap at eight lines plus padding and scrollbar space, at any font size");
        }
        element.style.removeProperty("font-size");
      };
      checkPreviewRows(document.querySelector(".tool-diff"));
      await wheel(document.querySelector(".tool-diff"),320);
      const diffTop=document.querySelector(".tool-diff").scrollTop;
      await click(document.querySelector("summary"));check(!document.querySelector(".tool-diff"),"closing an unannotated diff must release its body");
      await click(document.querySelector("summary"));
      check(document.querySelector(".tool-diff").scrollTop===diffTop,"reopening a diff must restore its internal scroll position");
      await click(document.querySelector("summary"));
      await render(<div/>);await render(edit);
      check(!visible(document.querySelector(".tool-diff")),"closing a diff must survive navigation");
      await click(document.querySelector("summary"));
      check(document.querySelector(".tool-diff").scrollTop===diffTop,"diff scroll coordinates must survive navigation without retaining its DOM");
      const plainLog=Array.from({length:10000},(_,i)=>"complete log line "+i).join("\\n");
      await render(<pre className="tool-term-output"><TerminalOutput text={plainLog}/></pre>);
      const compactLog=document.querySelector(".tool-term-output");
      check(compactLog.textContent===plainLog && compactLog.querySelectorAll("span").length===1,"large plain logs must retain every byte with compact native text DOM");
      const logRange=document.createRange();logRange.selectNodeContents(compactLog);getSelection().removeAllRanges();getSelection().addRange(logRange);
      check(getSelection().toString()===plainLog,"compacted terminal text must remain completely selectable/copyable");getSelection().removeAllRanges();
      compactLog.scrollTop=compactLog.scrollHeight;await wait();check(compactLog.scrollTop>0 && compactLog.textContent.endsWith("complete log line 9999"),"the last compacted log line must remain reachable");
      metrics.compactTerminal={lines:10000,spans:compactLog.querySelectorAll("span").length};
      await render(<ThinkingBlock text="# actual thinking" label="Thinking" active={false}/>);
      check(document.querySelector("details").open && document.getElementById("root").textContent.includes("actual thinking"),"thinking content must remain visible while formatting");
      await until(()=>visible(document.querySelector("h1")),"thinking formatting must finish through its worker");
      check(document.querySelector("details").open && visible(document.querySelector("h1")),"thinking must start expanded with formatted content");
      await click(document.querySelector("summary"));
      check(!visible(document.querySelector("h1")),"thinking must still close manually");
      const output=Array.from({length:600},(_,i)=>"line "+i+" "+"original output ".repeat(4)+"end").join("\\n");
      await render(<ToolBlock call={{id:"shell",name:"bash",arguments:{command:"echo fixture"}}} state={{status:"done",result:{content:[{type:"text",text:output}]}}} live={false}/>);
      const peek=document.querySelector(".tool-peek");
      check(peek?.tagName==="PRE" && peek.parentElement.matches("details.tool-term") && peek.textContent===output.split("\\n").slice(-2).join("\\n"),"shell preview must keep the original separate two-line preformatted block");
      check(document.querySelector(".tool-term.done .tool-term-dot")?.getAttribute("aria-label")==="exit 0" && !document.querySelector(".tool-term-time"),"completed shell must show its status dot and no time without a reported run time");
      check(document.querySelector(".tool-term").open,"bash must start expanded");
      const shell=document.querySelector(".tool-term-output");
      check(shell.textContent===output && visible(shell) && !visible(peek) && !document.querySelector(".text-range"),"expanded shell must retain the complete output in its scrollable preview");
      checkPreviewRows(shell);
      await wheel(shell,240);
      const shellTop=shell.scrollTop;
      await click(document.querySelector(".tool-term > summary"));
      check(!document.querySelector(".tool-term-output") && document.querySelector(".tool-peek"),"closing a shell must release its complete body, retaining the small preview");
      await click(document.querySelector(".tool-term > summary"));
      check(document.querySelector(".tool-term-output").textContent===output,"reopening a shell must restore its complete output");
      check(document.querySelector(".tool-term-output").scrollTop===shellTop,"reopening a shell must restore its internal scroll position");
      await render(<ToolBlock call={{id:"timed",name:"bash",arguments:{command:"pnpm test"}}} state={{status:"done",result:{content:[{type:"text",text:"ok"}],structuredContent:{exit_code:0,wall_time_seconds:2.1}}}} live={false}/>);
      check(document.querySelector(".tool-term-status .tool-term-time")?.textContent==="2.1s","completed shell must show the run time the SDK reported");
      await render(<ToolBlock call={{id:"failed",name:"bash",arguments:{command:"false"}}} state={{status:"error",result:{content:[{type:"text",text:"boom\\nCommand exited with code 3"}]}}} live={false}/>);
      check(document.querySelector(".tool-term.error .tool-term-time")?.textContent==="exit 3" && !document.querySelector(".tool-term-caret"),"failed shell must show its exit code without a caret");
      await render(<ToolBlock call={{id:"live",name:"bash",arguments:{command:"sleep 9"}}} state={{status:"running",result:{content:[{type:"text",text:"step 1"}]}}} live/>);
      const liveOutput=document.querySelector(".tool-term.running .tool-term-output"),caret=liveOutput?.querySelector(".tool-term-caret");
      check(caret && liveOutput.textContent==="step 1","running shell must retain a block caret after the log");
      const reducedMotion=matchMedia("(prefers-reduced-motion: reduce)").matches;
      const animation=getComputedStyle(caret).animationName;
      check(animation===(reducedMotion?"none":"tool-term-caret"),"running caret animation must respect reduced motion: "+JSON.stringify({reducedMotion,animation}));
      const elapsed=document.querySelector(".tool-term-time").textContent;
      check(/^\\d+(?:\\.\\d)?s$/.test(elapsed),"running shell must count its elapsed time: "+elapsed);
      const wideOutput=Array.from({length:80},(_,i)=>i+" "+"wide output ".repeat(150)).join("\\n");
      await render(<DisclosureScope id="multi-scroll" reveal={1}><ToolBlock call={{id:"multi-scroll",name:"extension",arguments:{}}} state={{status:"done"}} live={false} card={{title:"Scroll positions",body:[{type:"code",text:wideOutput},{type:"code",text:wideOutput}]}}/></DisclosureScope>);
      let scrollPreviews=document.querySelectorAll(".tool-code");
      scrollPreviews[0].scrollTop=90;scrollPreviews[0].scrollLeft=120;
      scrollPreviews[1].scrollTop=180;scrollPreviews[1].scrollLeft=240;await wait();
      const previewPositions=[...scrollPreviews].map(pre=>({top:pre.scrollTop,left:pre.scrollLeft}));
      check(previewPositions.every(pos=>pos.top>0 && pos.left>0),"multi-output fixture must scroll both axes");
      await click(document.querySelector("summary"));check(!document.querySelector(".tool-code"),"closed card bodies must still be released");
      await click(document.querySelector("summary"));
      scrollPreviews=document.querySelectorAll(".tool-code");
      check(JSON.stringify([...scrollPreviews].map(pre=>({top:pre.scrollTop,left:pre.scrollLeft})))===JSON.stringify(previewPositions),"each output must restore its own vertical and horizontal coordinates");
      const syntaxCode='const message = "<script>literal</script>";\\nconst count = 42;';
      await render(<ToolBlock call={{id:"syntax-write",name:"write",arguments:{path:"file.ts",content:syntaxCode}}} state={{status:"done"}} live={false}/>);
      check(document.querySelector("details").open && visible(document.querySelector(".tool-code")),"writes must start expanded");
      checkPreviewRows(document.querySelector(".tool-code"));
      await until(()=>document.querySelector(".tool-code .syntax-token"),"file writes must eventually highlight");
      check(document.querySelector(".tool-code").textContent===syntaxCode && !document.querySelector(".tool-code script"),"syntax tokens must preserve literal copied code, never HTML");
      const syntaxDiff='-1 /*\\n-2 old comment\\n-3 */\\n+1 const count = 42;\\n 4 const same = true;';
      await render(<ToolBlock call={{id:"syntax-edit",name:"edit",arguments:{path:"file.ts"}}} state={{status:"done",result:{details:{diff:syntaxDiff}}}} live={false}/>);
      await until(()=>document.querySelector(".tool-diff .add .syntax-token") && document.querySelector(".tool-diff .del .syntax-token"),"both sides of edits must highlight");
      const syntaxLines=[...document.querySelectorAll(".tool-diff > span")];
      check(document.querySelector(".tool-diff").textContent===syntaxDiff && syntaxLines.length===5,"diff prefixes, line breaks and code must remain copyable");
      check(Math.abs(syntaxLines[1].getBoundingClientRect().top-syntaxLines[0].getBoundingClientRect().top-parseFloat(getComputedStyle(syntaxLines[0]).lineHeight))<2,"diff token spans must not add blank display lines");
      check(getComputedStyle(document.querySelector(".tool-diff .add")).backgroundColor!=="rgba(0, 0, 0, 0)","syntax colors must retain the addition background");
      const ansiOutput='\\u001b[1;32mPASS\\ncontinued\\u001b[0m plain\\n\\u001b]8;;https://example.com\\u0007link\\u001b]8;;\\u0007';
      await render(<ToolBlock call={{id:"syntax-ansi",name:"bash",arguments:{command:"echo fixture"}}} state={{status:"done",result:{content:[{type:"text",text:ansiOutput}]}}} live={false}/>);
      await until(()=>document.querySelector(".tool-term-output .syntax-token"),"shell ANSI output must eventually use colored tokens");
      check(document.querySelector(".tool-term-output").textContent==='PASS\\ncontinued plain\\nlink' && document.querySelector(".tool-peek").textContent==='continued plain\\nlink' && !document.querySelector(".tool-term-output a"),"ANSI controls must not leak into shell text or create links");
      await render(<CodeText text="old source" language="python"/>);
      await render(<CodeText text="print(42)" language="python"/>);
      await until(()=>document.querySelector(".syntax-token"),"a changed source must eventually highlight");
      check(document.getElementById("root").textContent==="print(42)","an older asynchronous highlight must not overwrite new source");
      await render(<CodeText text="plain replacement" language="unknown"/>);
      check(document.getElementById("root").textContent==="plain replacement" && !document.querySelector(".syntax-token"),"changing to an unsupported language must immediately discard old tokens");
      // Inspect the synchronous commit, before asynchronous tokenization can hide a flash.
      async function verifyRetainedHighlight(makeNode,selector,initial,plain=text=>text){
        await render(makeNode(initial));
        await until(()=>document.querySelector(selector+" .syntax-token"),"streaming fixture must initially highlight");
        const host=document.querySelector(selector),token=host.querySelector(".syntax-token"),color=getComputedStyle(token).color;
        const range=document.createRange();range.selectNodeContents(token);
        const selection=window.getSelection();selection.removeAllRanges();selection.addRange(range);
        const selected=selection.toString();
        let latest;
        for(const suffix of [" = 78431;"," = 78432;"," = 78433;"]){
          latest=initial+suffix;
          flushSync(()=>root.render(makeNode(latest)));
          check(document.querySelector(selector)===host && host.querySelector(".syntax-token")===token && getComputedStyle(token).color===color,"pending highlighting must preserve unchanged colored DOM: "+selector);
          check(host.textContent===plain(latest),"pending highlighting must show only the latest source: "+selector);
          check(selection.toString()===selected && token.isConnected,"streaming must retain selection in unchanged tokens: "+selector);
          check(![...host.querySelectorAll(".syntax-token")].filter(span=>span.style.color).map(span=>span.textContent).join("").includes(suffix),"new text must remain plain until its matching tokens arrive: "+selector);
        }
        selection.removeAllRanges();
        await until(()=>[...host.querySelectorAll(".syntax-token")].filter(span=>span.style.color).map(span=>span.textContent).join("").includes(" = 78433;"),"latest streaming source must eventually highlight: "+selector);
        check(host.textContent===plain(latest),"stale async results must never restore old source: "+selector);
      }
      await verifyRetainedHighlight(text=><pre><CodeText text={text} language="ts"/></pre>,"pre","const stableDirect = 1;\\nconst growingDirect");
      await verifyRetainedHighlight(text=><Markdown text={'~~~ts\\n'+text+'\\n~~~'}/>,"pre code","const stableMarkdown = 1;\\nconst growingMarkdown",text=>text+"\\n");
      await verifyRetainedHighlight(text=><ToolBlock call={{id:"stream-write",name:"write",arguments:{path:"stream.ts",content:text}}} live/> ,".tool-code","const stableWrite = 1;\\nconst growingWrite");
      await verifyRetainedHighlight(text=><ToolBlock call={{id:"stream-edit",name:"edit",arguments:{path:"stream.ts"}}} state={{status:"done",result:{details:{diff:text}}}} live={false}/>,".tool-diff","-1 const oldDiff = 1;\\n+1 const stableDiff = 1;\\n+2 const growingDiff");
      await verifyRetainedHighlight(text=><ToolBlock call={{id:"stream-ansi",name:"bash",arguments:{command:"echo stream"}}} state={{status:"running",result:{content:[{type:"text",text}]}}} live/>,".tool-term-output","\\u001b[32mStable ANSI\\ngrowing ANSI",text=>text.replace("\\u001b[32m",""));
      metrics.syntaxHighlighting=true;
      metrics.retainedHighlighting=true;
      const calls=Array.from({length:500},(_,i)=>({id:"call"+i,name:"read",arguments:{path:"file"+i}}));
      await render(<ToolGroup calls={calls} tools={{}} live={false}/>);
      check(!document.querySelector(".tool-group-body"),"collapsed exploration groups must not mount child tools");
      await click(document.querySelector("summary"));
      metrics.groupCalls=document.querySelectorAll(".tool-group-body > details").length;
      check(metrics.groupCalls===500 && !document.querySelector(".text-range") && document.querySelector('.tool-target[title="file499"]'),"expanded exploration group must keep every original tool row without paging or wrappers");
      await click(document.querySelector('.tool-group-body > details > summary'));
      check(document.querySelector('.tool-group-body > details').open,"child tool must open");
      await click(document.querySelector('.tool-group > summary'));
      check(!document.querySelector('.tool-group-body'),"closing a group must unmount its child tools");
      await click(document.querySelector('.tool-group > summary'));
      check(document.querySelector('.tool-group-body > details').open,"reopening a group must preserve child expansion");
      await render(<ToolGroup calls={calls.slice(0,2)} tools={{}} live={false}/>);
      check(document.querySelectorAll(".tool-group-body > details").length===2,"a reconciled shorter group must show all remaining calls");
      const nestedCall={id:"nested-scroll",name:"read",arguments:{path:"file.txt"}};
      await render(<DisclosureScope id="nested-scroll"><ToolGroup calls={[nestedCall]} tools={{[nestedCall.id]:{status:"done",result:{content:[{type:"text",text:wideOutput}]}}}} live={false}/></DisclosureScope>);
      await click(document.querySelector(".tool-group > summary"));
      await click(document.querySelector(".tool-group-body > details > summary"));
      const nestedPreview=document.querySelector(".tool-body pre");nestedPreview.scrollTop=180;nestedPreview.scrollLeft=240;await wait();
      const nestedPosition={top:nestedPreview.scrollTop,left:nestedPreview.scrollLeft};
      await click(document.querySelector(".tool-group > summary"));
      check(!nestedPreview.isConnected && !document.querySelector(".tool-group-body"),"closed unannotated groups must release their child DOM");
      await click(document.querySelector(".tool-group > summary"));
      const restoredPreview=document.querySelector(".tool-body pre");
      check(restoredPreview.scrollTop===nestedPosition.top && restoredPreview.scrollLeft===nestedPosition.left,"parent group collapse must not discard child output coordinates");
      metrics.toolScrollRestored={shell:shellTop,diff:diffTop,multiple:previewPositions,nested:nestedPosition};
      let parses=0;
      installChatRenderers([{id:"counter",kind:"markdown",component:({DefaultRenderer})=>{parses++;return <DefaultRenderer/>;}}]);
      await render(<Markdown text={"start"} streaming/>);
      const before=parses;
      for(let i=0;i<100;i++) flushSync(()=>root.render(<Markdown text={"# token "+i} streaming/>));
      check(parses===before,"streaming updates must not reparse unchanged samples");
      await pause(130);
      await until(()=>document.querySelector("h1")?.textContent==="token 99","the sampled latest Markdown must finish without an extra user action");
      check(parses===before+1 && document.querySelector("h1")?.textContent==="token 99","streaming must publish the latest sample once per interval");
      const final=["| A | B |","| - | - |","| 1 | 2 |","","[go][ref]","","[ref]: https://example.com","","\u0060\u0060\u0060ts","const x=1","\u0060\u0060\u0060","","$x^2$"].join("\\n");
      await render(<Markdown text={final}/>);
      await until(()=>document.querySelector("pre code.language-ts .syntax-token"),"Markdown code fences must eventually highlight");
      const complete=document.getElementById("root").innerHTML;
      const comparison=document.createElement("div");document.body.append(comparison);
      const other=createRoot(comparison);flushSync(()=>other.render(<BuiltinMarkdown data={{text:final}} DefaultRenderer={()=>null}/>));
      check(complete===comparison.innerHTML && document.querySelector("table td")?.textContent==="1" && document.querySelector('a[href="https://example.com"]') && document.querySelector("pre code.language-ts") && document.querySelector(".katex"),"final Markdown must preserve ordinary tables, references, code and math");
      await pause(130);check(document.getElementById("root").innerHTML===complete,"old streaming samples must not overwrite final Markdown");
      metrics.streamParses=parses-before;
      for(const text of [final,"A &amp; B &copy; &NotEqualTilde;","$x^2$\\n\\n$$ x = \\\\frac{-b \\\\pm \\\\sqrt{b^2 - 4ac}}{2a} $$","$\\\\notARealCommand{x}$","<script>alert(1)</script>\\n\\n[bad](javascript:alert) [chat](pi://session/opaque-session-id)"]){
        await render(<Markdown text={text}/>);await until(()=>!document.querySelector("#root .markdown-pending-source"),"worker Markdown must complete before independent DOM comparison");
        flushSync(()=>other.render(<ReactMarkdown remarkPlugins={[remarkGfm,remarkMath]} rehypePlugins={[[rehypeKatex,{throwOnError:false}]]} components={markdownComponents} urlTransform={markdownUrl}>{normalizeMath(text)}</ReactMarkdown>));
        await until(()=>document.getElementById("root").innerHTML===comparison.innerHTML,"worker DOM must equal the original browser Markdown/GFM/KaTeX pipeline");
      }
      metrics.markdownDomParity=5;other.unmount();comparison.remove();installChatRenderers([]);
      await render(<Markdown text={"# Large\\n\\n"+"wrapping words ".repeat(10000)+"\\n\\n**End marker**"}/>);
      check(document.getElementById("root").textContent.includes("End marker"),"a pending large parse must still expose the complete latest text");
      await until(()=>document.querySelector("h1")?.textContent==="Large" && document.querySelector("strong")?.textContent==="End marker","the worker must finish the original large Markdown appearance without another action");
      check(!button(document,"Render full Markdown") && !document.querySelector(".text-range"),"large messages must not require paging or a render-full action");
      const workRecords=[user(0)];const tools={};
      for(let i=0;i<150;i++){const call={id:"t"+i,name:"bash",arguments:{command:"echo "+i}};const text="Tool-marker-"+i+"-end";workRecords.push(assistant("a"+i,1+2*i,[{type:"toolCall",...call}]));workRecords.push(record("result"+i,2+2*i,{role:"toolResult",toolCallId:call.id,toolName:"bash",content:[{type:"text",text}],isError:false,timestamp:i}));tools[call.id]={status:"done",result:{content:[{type:"text",text}]}};}
      workRecords.push(assistant("final",301,[{type:"text",text:"Final answer"}]));
      snapshot={...base,address:{...base.address,sessionId:"work"},info:{...base.info,id:"work"},transcript:{...transcript(workRecords),tools}};await show(snapshot);
      check(document.querySelector(".work-toggle")?.getAttribute("aria-expanded")==="false" && document.querySelector('[data-record-id="final"]').textContent.includes("Final answer"),"finished work must stay folded above the final answer");
      await click(document.querySelector(".work-toggle"));
      check(document.querySelectorAll(".tool-term").length===150 && !document.querySelector(".text-range"),"unfolded work must contain every tool record");
      for(const grouped of [true,false]){
        metrics.stage="nested-"+grouped;
        const nestedCalls=Array.from({length:150},(_,i)=>({id:"nested"+i,name:grouped?"read":"bash",arguments:grouped?{path:"file"+i}:{command:"echo "+i}}));
        const nestedTools={};
        const nestedResults=nestedCalls.map((call,i)=>{const text=i===125?"Single-marker-125-end\\n"+output:"small result "+i;nestedTools[call.id]={status:"done",result:{content:[{type:"text",text}]}};return record("nested-result"+i,2+i,{role:"toolResult",toolCallId:call.id,toolName:call.name,content:[{type:"text",text}],isError:false,timestamp:i});});
        const id=grouped?"single-grouped":"single-ungrouped";
        snapshot={...base,address:{...base.address,sessionId:id},info:{...base.info,id},transcript:{...transcript([user(0),assistant("single",1,nestedCalls.map(call=>({type:"toolCall",...call}))),...nestedResults,assistant("single-final",152,[{type:"text",text:"Nested final"}])]),tools:nestedTools}};await show(snapshot);
        await click(document.querySelector(".work-toggle"));
        if(grouped) await click(document.querySelector(".tool-group > summary"));
        const focused=document.querySelector('details[data-tool-call-id="nested125"]');
        if(grouped) await click(focused.querySelector("summary"));
        focused.scrollIntoView({block:"center"});await wait();
        check(document.querySelectorAll("details[data-tool-call-id]").length===150 && !document.querySelector(".text-range"),"nested tools must all be available without content paging");
        check(focused.open && (grouped?focused.closest(".tool-group").open:!focused.closest(".tool-group")),"manual expansion must preserve exploration grouping and separate shell rows");
        check(focused.querySelector("pre").textContent.includes("line 599"),"manual expansion must expose complete output beyond the old text range");
        const readingThread=document.querySelector(".thread-scroll");const top=readingThread.scrollTop;
        metrics.stage="nested-wheel-"+grouped;
        await wheel(focused.querySelector(grouped?".tool-body pre":".tool-term-output"),120);
        check(Math.abs(readingThread.scrollTop-top)<=2,"wheel over a scrollable tool preview must scroll the preview alone");
      }
      const type=async(input,value)=>{Object.getOwnPropertyDescriptor(input instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,"value").set.call(input,value);input.dispatchEvent(new Event("input",{bubbles:true}));await wait();};
      const deferred=()=>Promise.withResolvers();
      metrics.stage="completion";
      const completions=[];window.__sendCount=0;
      window.__requests={listSlashCommands:()=>[{name:"hello",category:"extension"},{name:"other",category:"extension"}],completeSlashArguments:params=>{const read=deferred();completions.push({...params,read});return read.promise;}};
      const composerSnapshot={...base,ready:true,address:{hostId:"completion",sessionId:"completion",epoch:1},info:{...base.info,id:"completion"},transcript:transcript([])};
      drafts.edit(composerSnapshot.address,content=>({...content,text:"/hello a"}));
      await render(<div className="chat-shell" style={{height:300}}><Composer snapshot={composerSnapshot}/></div>);
      const editor=document.querySelector("textarea");editor.setSelectionRange(editor.value.length,editor.value.length);editor.focus();document.dispatchEvent(new Event("selectionchange"));await until(()=>completions.some(read=>read.argumentPrefix==="a"),"initial completion did not start");
      completions.find(read=>read.argumentPrefix==="a").read.resolve([{label:"alpha",value:"alpha"}]);await until(()=>document.querySelector(".slash-options"),"missing initial suggestions");
      const popup=document.querySelector(".slash-options");await type(editor,"/hello ab");await until(()=>completions.some(read=>read.argumentPrefix==="ab"),"updated completion did not start");
      check(document.querySelector(".slash-options")===popup && popup.getAttribute("aria-busy")==="true" && popup.querySelector('[aria-disabled="true"]'),"completion must retain its popup but disable stale choices");
      const enter=new KeyboardEvent("keydown",{key:"Enter",bubbles:true,cancelable:true});editor.dispatchEvent(enter);await click(popup.querySelector('[role="option"]'));
      check(enter.defaultPrevented && editor.value==="/hello ab" && window.__sendCount===0,"pending stale choices must neither insert old arguments nor send the command");
      await type(editor,"/hello abc");await until(()=>completions.some(read=>read.argumentPrefix==="abc"),"latest completion did not start");
      completions.find(read=>read.argumentPrefix==="abc").read.resolve([{label:"current",value:"abcd"}]);await until(()=>popup.textContent.includes("current"),"latest completion did not publish");
      completions.find(read=>read.argumentPrefix==="ab").read.resolve([{label:"stale",value:"old"}]);await wait();check(!popup.textContent.includes("stale"),"late completions must not replace the current query");
      await click(popup.querySelector('[role="option"]'));check(editor.value==="/hello abcd","confirmed current suggestion must still work: "+JSON.stringify({value:editor.value,start:editor.selectionStart,end:editor.selectionEnd,queries:completions.map(read=>read.argumentPrefix),popup:popup.textContent,busy:popup.getAttribute("aria-busy")}));
      await type(editor,"/other a");await wait();check(!document.querySelector(".slash-options"),"another command must not inherit the previous command's suggestions");
      await render(<div/>);
      metrics.stage="composer-keys";
      window.__sendModes=[];
      drafts.edit(composerSnapshot.address,content=>({...content,text:"message"}));
      await render(<div className="chat-shell" style={{height:350}}><Composer snapshot={{...composerSnapshot,modelCatalog:[{provider:"fixture",id:"fixture",name:"Fixture",input:["text"]}]}}/></div>);
      let keyEditor=document.querySelector("textarea");keyEditor.focus();
      const press=async(key,modifiers={})=>{const event=new KeyboardEvent("keydown",{key,bubbles:true,cancelable:true,...modifiers});keyEditor.dispatchEvent(event);await wait();return event;};
      await press("Enter");check(window.__sendModes.length===0 && keyEditor.value.includes("\\n"),"Enter must insert a newline, never send");
      await press("Enter",{shiftKey:true});
      check(JSON.stringify(window.__sendModes)==='["steer"]',"idle Shift+Enter must send immediately without entering the queue");
      await render(<div className="chat-shell" style={{height:350}}><Composer snapshot={{...composerSnapshot,transcript:{...composerSnapshot.transcript,running:true},modelCatalog:[{provider:"fixture",id:"fixture",name:"Fixture",input:["text"]}]}}/></div>);
      keyEditor=document.querySelector("textarea");keyEditor.focus();
      await press("Enter",{shiftKey:true});await press("Enter",{ctrlKey:true});
      check(JSON.stringify(window.__sendModes)==='["steer","followUp","steer"]',"while responding Shift+Enter must queue and Ctrl+Enter must steer");
      await press("Enter",{isComposing:true});await press("Enter",{keyCode:229});await press("Enter",{ctrlKey:true,repeat:true});
      check(window.__sendModes.length===3,"IME confirmation and key-repeat must never send messages");
      const altEnter=await press("Enter",{altKey:true});check(!altEnter.defaultPrevented && window.__sendModes.length===3,"Alt+Enter must have no app shortcut binding");
      await type(keyEditor,"message");keyEditor.setSelectionRange(3,3);await press("Enter");
      check(keyEditor.value==="mes\\nsage" && keyEditor.selectionStart===4,"Enter must insert at the caret without sending");
      flushSync(()=>useStore.setState(state=>({settings:{...state.settings,keybindings:{"composer.steer":"Ctrl+S","composer.newline":"Ctrl+J"}}})));await wait();
      await press("j",{ctrlKey:true});check(window.__sendModes.length===3,"custom newline must not send");
      await press("s",{ctrlKey:true});check(window.__sendModes.length===4 && window.__sendModes[3]==="steer","custom steering binding must work in the real composer");
      check(!document.querySelector(".composer-dock kbd"),"the composer must not display shortcut instructions");
      flushSync(()=>useStore.setState(state=>({settings:{...state.settings,keybindings:{}}})));
      metrics.stage="opening-composer-keys";
      const previousOpening=useStore.getState();
      for(const running of [false,true]){
        const target={cwd:"fixture",id:"completion"};
        flushSync(()=>useStore.setState({openId:"key-test",openingTarget:target,pendingOpens:{"key-test":target}}));
        drafts.edit(composerSnapshot.address,content=>({...content,text:"opening message"}));
        await render(<OpeningComposer preview={{...composerSnapshot,transcript:{...composerSnapshot.transcript,running}}}/>);
        keyEditor=document.querySelector("textarea");keyEditor.focus();await press("Enter",{shiftKey:true});
        const send=useStore.getState().pendingOpens["key-test"].queued[0];
        check(send.delivery===(running?"followUp":"steer"),"opening composer must queue only while responding");
        check(!!document.querySelector(".message-queue")===running,"idle opening sends must not flash a queue row");
      }
      flushSync(()=>useStore.setState({openId:previousOpening.openId,openingTarget:previousOpening.openingTarget,pendingOpens:previousOpening.pendingOpens,newChatDrafts:previousOpening.newChatDrafts}));
      metrics.stage="composer-no-footer";
      const renderComposer=async modelCatalog=>render(<div className="chat-shell" style={{height:350}}><Composer snapshot={{...composerSnapshot,modelCatalog}}/></div>);
      const catalog=[{provider:"fixture",id:"fixture",name:"Fixture",input:["text"]}];
      await renderComposer(catalog);
      await type(document.querySelector("textarea"),"initial draft");
      const dock=document.querySelector(".composer-dock"),composer=document.querySelector("form.composer"),composerRect=composer.getBoundingClientRect(),dockHeight=dock.getBoundingClientRect().height;
      const checkComposer=()=>{
        check(dock.lastElementChild===composer && !dock.querySelector(".belowEditor"),"nothing may render below the composer form");
        check(composer.getBoundingClientRect().top===composerRect.top && composer.getBoundingClientRect().height===composerRect.height && dock.getBoundingClientRect().height===dockHeight,"composer status changes must not shift or resize the dock");
      };
      for(const state of ["sending","checking","unknown","rejected","accepted"]){
        window.__sendState={state,message:"Send status must not appear below the editor"};await renderComposer(catalog);checkComposer();
        check(!dock.textContent.includes(window.__sendState.message),"send status must not render in the composer");
      }
      window.__sendState=undefined;
      flushSync(()=>useStore.setState({extensionStatuses:{[addressKey(composerSnapshot.address)]:{statuses:[],widgets:[{key:"footer",placement:"belowEditor",lines:["Extension footer must not render"]}]}}}));
      await renderComposer([]);checkComposer();
      check(!dock.textContent.includes("Extension footer") && !dock.textContent.includes("Choose an enabled model") && composer.querySelector('[aria-label="Send"]').disabled,"no-model state and extension footers must not add a message row");
      window.__requests.syncDraft=async()=>{throw new Error("Composer mirror fixture failure");};
      await type(document.querySelector("textarea"),"unsaved draft");
      await until(()=>useStore.getState().noticeHistory.some(notice=>notice.message.includes("Composer mirror fixture failure")),"mirror errors must reach the existing notification UI");
      checkComposer();check(document.querySelector("textarea").value==="unsaved draft" && !dock.textContent.includes("Composer mirror fixture failure"),"mirror failure must preserve the draft without inserting a message");
      delete window.__requests.syncDraft;
      metrics.composerNoFooter=true;
      metrics.stage="composer-attachments";
      const pasteFiles=files=>{
        const data=new DataTransfer();for(const file of files)data.items.add(file);
        document.querySelector("textarea").dispatchEvent(new ClipboardEvent("paste",{clipboardData:data,bubbles:true,cancelable:true}));
      };
      const clearAttachments=async()=>{drafts.edit(composerSnapshot.address,content=>({...content,images:[],files:[]}));await wait();};
      const attachmentBounds=()=>{
        const item=document.querySelector(".composer-attachment"),row=document.querySelector(".composer-attachments"),form=document.querySelector("form.composer");
        check(item && row && getComputedStyle(item).position==="relative","attachment must stay in normal flow, never use the page loading overlay");
        const a=item.getBoundingClientRect(),r=row.getBoundingClientRect(),f=form.getBoundingClientRect();
        const style=getComputedStyle(form),inset=parseFloat(style.paddingLeft)+parseFloat(style.borderLeftWidth)+12;
        check(Math.abs(a.left-r.left-12)<=1 && Math.abs(a.top-r.top-8)<=1 && Math.abs(a.left-f.left-inset)<=1,"pending attachments must start in the composer's top-left attachment slot: "+JSON.stringify({item:a.toJSON(),row:r.toJSON(),form:f.toJSON(),inset}));
        return {x:a.left,y:a.top,width:a.width,height:a.height};
      };
      const assertSameBounds=before=>{
        const after=attachmentBounds();
        check(Object.keys(before).every(key=>Math.abs(before[key]-after[key])<=1),"attachment must keep its slot and dimensions after loading: "+JSON.stringify({before,after}));
      };
      await renderComposer(catalog);await clearAttachments();
      const storedFile=deferred();window.__requests.storeAttachment=()=>storedFile.promise;
      pasteFiles([new File(["fixture"],"fixture.txt",{type:"text/plain"})]);
      await until(()=>document.querySelector('.composer-attachment[aria-busy="true"]'),"file placeholder must render");
      const fileBounds=attachmentBounds();storedFile.resolve("C:/fixture.txt");
      await until(()=>document.querySelector(".composer-attachment:not([aria-busy])"),"stored file must replace its placeholder");assertSameBounds(fileBounds);
      await clearAttachments();delete window.__requests.storeAttachment;
      const NativeFileReader=window.FileReader,pendingImageReads=[];
      window.FileReader=class extends NativeFileReader {readAsDataURL(file){pendingImageReads.push(()=>super.readAsDataURL(file));}};
      const pngBytes=Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII="),char=>char.charCodeAt(0));
      pasteFiles([new File([pngBytes],"fixture.png",{type:"image/png"})]);
      await until(()=>document.querySelector('.composer-attachment[aria-busy="true"]'),"image placeholder must render");
      const imageBounds=attachmentBounds();pendingImageReads.shift()();
      await until(()=>document.querySelector(".composer-attachment img")?.complete,"loaded image must render");assertSameBounds(imageBounds);
      window.FileReader=NativeFileReader;await clearAttachments();
      const clipboardProbe=deferred();window.__requests.readClipboardImage=()=>clipboardProbe.promise;
      const beforeProbe=document.querySelector("form.composer").getBoundingClientRect();
      pasteFiles([]);await wait();
      check(!document.querySelector(".composer-attachments"),"unknown native clipboard data must not flash a loading attachment");
      clipboardProbe.resolve(null);
      await until(()=>useStore.getState().noticeHistory.some(notice=>notice.message.includes("No image could be read from the clipboard")),"empty native image reads must notify instead of silently disappearing");
      const afterProbe=document.querySelector("form.composer").getBoundingClientRect();
      check(!document.querySelector(".composer-attachments") && !document.querySelector(".composer-hint") && beforeProbe.top===afterProbe.top && beforeProbe.height===afterProbe.height,"unsuccessful clipboard probes must not flash or resize the composer");
      const clipboardImage=deferred();window.__requests.readClipboardImage=()=>clipboardImage.promise;
      pasteFiles([]);await wait();check(!document.querySelector(".composer-attachments"),"native probes must stay invisible until image data arrives");
      clipboardImage.resolve(btoa(String.fromCharCode(...pngBytes)));
      await until(()=>document.querySelector(".composer-attachment img"),"native PNG clipboard data must attach successfully");attachmentBounds();
      await clearAttachments();delete window.__requests.readClipboardImage;
      metrics.composerAttachments=true;
      const queueActions=[];
      const queueContent={text:"A quiet follow-up",pastes:[],images:[]};
      await render(<div style={{width:340}}><MessageQueue items={[{id:"one",content:queueContent},{id:"two",content:{...queueContent,text:"Another message"}}]} onEdit={id=>queueActions.push("edit:"+id)} onDelete={id=>queueActions.push("delete:"+id)}/></div>);
      check(document.querySelectorAll(".message-queue li").length===2 && document.querySelector(".message-queue").scrollWidth<=340,"queue rows must fit a narrow composer without horizontal overflow");
      await click(document.querySelector('.message-queue button[aria-label="Edit queued message in composer"]'));
      await click(document.querySelector('.message-queue button[aria-label="Delete queued message"]'));
      check(JSON.stringify(queueActions)==='["edit:one","delete:one"]',"queue edit/delete controls must target the correct message");
      await click(document.querySelector(".message-queue summary"));check(!document.querySelector(".message-queue").open,"queue must collapse to its compact summary");
      metrics.composerKeys=true;await render(<div/>);
      metrics.stage="model-picker-height";
      const originalBootstrap=useStore.getState().bootstrap;
      const pickerProvider={id:"openai-codex",name:"OpenAI Codex",configured:true,accounts:[{id:"work",provider:"openai-codex",label:"Work",configured:true},{id:"old",provider:"openai-codex",label:"Signed out",configured:false}]};
      const pickerModels=Array.from({length:12},(_,i)=>({provider:pickerProvider.id,id:"model-"+i,name:"Model "+i,effortLevels:["low","high"],effectiveDefaultEffort:"low"}));
      const pickerBootstrap={...originalBootstrap,providers:[pickerProvider],models:pickerModels,disabledModels:[],defaultModel:null,accountCatalogs:{[accountSourceKey(pickerProvider.id)]:pickerModels.slice(0,3),[accountSourceKey(pickerProvider.id,"work")]:pickerModels,[accountSourceKey(pickerProvider.id,"old")]:[]},desktop:{...originalBootstrap.desktop,recentModels:pickerModels.slice(0,5).map(model=>accountModelKey(model,"work"))}};
      const pickerSelection={model:pickerModels[0],effort:"low",effortLevels:["low","high"]};
      const beforeNewChat=useStore.getState();
      let catalogReads=0;
      const largeCatalog=Array.from({length:1000},(_,i)=>Object.defineProperty({...pickerModels[0],id:"large-"+i,name:"Large model "+i},"provider",{enumerable:true,get(){catalogReads++;return pickerProvider.id;}}));
      flushSync(()=>useStore.setState({bootstrap:{...pickerBootstrap,providers:[{...pickerProvider,accounts:undefined}],models:largeCatalog,accountCatalogs:undefined},openingTarget:{cwd:"perf-new-chat",selection:pickerSelection}}));
      const newChatStarted=performance.now();await render(<OpeningComposer/>);
      check(!document.querySelector(".model-option"),"a new composer must not mount a thousand hidden model options");
      const newChatMountMs=performance.now()-newChatStarted;
      const newEditor=document.querySelector("textarea");newEditor.focus();catalogReads=0;
      for(let i=1;i<=12;i++)await type(newEditor,"typing input".slice(0,i));
      check(newEditor.value==="typing input" && catalogReads===0,"typing in a new chat must not recompute the model catalog: "+catalogReads);
      metrics.newChatInput={catalogModels:1000,catalogReadsDuringTyping:catalogReads,hiddenModelOptions:document.querySelectorAll(".model-option").length,mountMs:newChatMountMs};
      const readyInputSnapshot={...base,address:{...base.address,sessionId:"perf-ready-input"},info:{...base.info,id:"perf-ready-input"},ready:true,model:pickerModels[0],modelCatalog:largeCatalog,transcript:transcript([])};
      await render(<Composer snapshot={readyInputSnapshot}/>);catalogReads=0;
      const readyEditor=document.querySelector("textarea");readyEditor.focus();
      for(let i=1;i<=12;i++)await type(readyEditor,"typing ready".slice(0,i));
      check(readyEditor.value==="typing ready" && catalogReads===0,"typing in a ready composer must not refilter its model catalog: "+catalogReads);
      metrics.newChatInput.readyCatalogReadsDuringTyping=catalogReads;
      await render(<div/>);
      flushSync(()=>useStore.setState({bootstrap:pickerBootstrap,openingTarget:beforeNewChat.openingTarget,newChatDrafts:beforeNewChat.newChatDrafts}));
      await render(<div className="chat-shell" style={{height:500}}><div style={{marginTop:"auto",alignSelf:"flex-end"}}><ModelPicker selection={pickerSelection} onSelect={()=>{}}/></div></div>);
      check(!document.querySelector(".model-panel") && !document.querySelector(".model-option"),"closed model pickers must not mount hidden model lists on a new chat");
      await click(document.querySelector(".model-picker summary"));
      check(document.activeElement===document.querySelector(".model-search input"),"lazily mounted model search must receive focus");
      const panel=document.querySelector(".model-panel"),browser=document.querySelector(".model-browser"),reasoning=document.querySelector(".model-reasoning");
      const panelRect=panel.getBoundingClientRect(),browserHeight=browser.getBoundingClientRect().height,reasoningTop=reasoning.getBoundingClientRect().top;
      const checkPickerHeight=()=>{
        const rect=panel.getBoundingClientRect();
        check(rect.height===panelRect.height && rect.top===panelRect.top && browser.getBoundingClientRect().height===browserHeight && reasoning.getBoundingClientRect().top===reasoningTop,"model counts and account/search states must not resize or shift the picker or effort slider");
      };
      check(document.querySelectorAll(".model-option").length===5,"recent fixture must have five models");
      window.__scrollbarCapture=true;await until(()=>typeof window.__scrollbarCapture==="string","missing model picker screenshot");window.__modelPickerScreenshot=window.__scrollbarCapture;delete window.__scrollbarCapture;
      const sourceButton=text=>[...document.querySelectorAll(".model-source-rail button")].find(button=>button.textContent.includes(text));
      await click(sourceButton("OpenAI Codex"));checkPickerHeight();
      check(document.querySelectorAll(".model-option").length===3,"default account fixture must have three models");
      await click(sourceButton("Work"));checkPickerHeight();
      const modelResults=document.querySelector(".model-results");
      check(modelResults.scrollHeight>modelResults.clientHeight,"long model lists must scroll inside the fixed browser");
      await wheel(modelResults,modelResults.scrollHeight);checkPickerHeight();
      check(modelResults.querySelector('[data-model-index="11"]').getBoundingClientRect().bottom<=modelResults.getBoundingClientRect().bottom,"the last model must remain reachable");
      await type(document.querySelector(".model-search input"),"no-such-model");checkPickerHeight();
      check(document.querySelector(".picker-empty") && !document.querySelector(".model-option"),"empty search must keep the fixed browser");
      await type(document.querySelector(".model-search input"),"Model 0");checkPickerHeight();
      await click(sourceButton("Signed out"));checkPickerHeight();
      check(document.querySelector(".model-account-action"),"signed-out account must show its action inside the fixed browser");
      const extraAccounts=Array.from({length:15},(_,i)=>({id:"extra-"+i,provider:pickerProvider.id,label:"Extra "+i,configured:false}));
      flushSync(()=>useStore.setState({bootstrap:{...pickerBootstrap,providers:[{...pickerProvider,accounts:[...pickerProvider.accounts,...extraAccounts]}]}}));await wait();checkPickerHeight();
      const sourceRail=document.querySelector(".model-source-rail");
      check(sourceRail.scrollHeight>sourceRail.clientHeight,"many accounts must scroll instead of stretching the picker");
      await wheel(sourceRail,sourceRail.scrollHeight);checkPickerHeight();
      check(sourceButton("Extra 14").getBoundingClientRect().bottom<=sourceRail.getBoundingClientRect().bottom,"the last account must remain reachable");
      metrics.modelPickerFixedHeight=panelRect.height;
      await render(<div/>);
      metrics.stage="default-model-settings";
      flushSync(()=>useStore.setState({bootstrap:pickerBootstrap}));
      const defaultCalls=[];
      window.__requests.setDefaultModel=async({model})=>{defaultCalls.push(model);return model;};
      await render(<Settings/>);
      const defaultSelect=document.querySelector(".utility-model-select select"),defaultLabel=document.querySelector(".utility-model-select label");
      check(visible(defaultSelect) && defaultLabel.textContent==="Default model" && defaultLabel.htmlFor===defaultSelect.id,"General settings must visibly expose the default model selector with an associated label");
      check(defaultSelect.options.length===4 && defaultSelect.selectedOptions[0].textContent==="Automatic","default settings must offer Automatic and enabled default-account models");
      const chooseDefault=async value=>{defaultSelect.value=value;defaultSelect.dispatchEvent(new Event("change",{bubbles:true}));await defaultModelPreference.flush("default");await wait();};
      await chooseDefault(JSON.stringify([pickerProvider.id,"model-1"]));
      check(defaultCalls.length===1 && defaultCalls[0].id==="model-1" && useStore.getState().bootstrap.defaultModel.id==="model-1","choosing the default in Settings must immediately save the provider/model");
      window.__requests.setDefaultModel=async()=>{throw new Error("Default model save failed");};
      await chooseDefault(JSON.stringify([pickerProvider.id,"model-2"]));
      check(defaultSelect.value===JSON.stringify([pickerProvider.id,"model-1"]) && useStore.getState().notices.some(notice=>notice.message.includes("Default model save failed")),"failed default saves must roll back the visible selection and use notifications");
      window.__requests.setDefaultModel=async({model})=>{defaultCalls.push(model);return model;};
      await chooseDefault("");
      check(defaultCalls.at(-1)===null && useStore.getState().bootstrap.defaultModel===null,"Automatic must clear the saved default from Settings");
      flushSync(()=>useStore.setState(state=>({settings:{...state.settings,language:"ja"}})));await wait();
      check(document.querySelector(".utility-model-select label").textContent==="デフォルトモデル","default selection must also be discoverable in Japanese settings");
      window.__scrollbarCapture=true;await until(()=>typeof window.__scrollbarCapture==="string","missing default model settings screenshot");window.__defaultModelScreenshot=window.__scrollbarCapture;delete window.__scrollbarCapture;
      delete window.__requests.setDefaultModel;
      flushSync(()=>useStore.setState({bootstrap:originalBootstrap}));
      metrics.defaultModelSettings=true;
      metrics.stage="annotations";
      flushSync(()=>useStore.setState(state=>({settings:{...state.settings,language:"ja"}})));
      function AnnotationFixture(){
        const [items,setItems]=useState([]);
        return <><article className="message assistant"><p>Repeated passage</p><p>Repeated passage</p></article>
          <AnnotationPopover onAdd={(annotation,range)=>{const id=crypto.randomUUID();rememberAnnotationRange(id,range);setItems(items=>[...items,{id,...annotation}]);}}/>
          <AnnotationDrafts annotations={items} onRemove={id=>setItems(items=>items.filter(item=>item.id!==id))}/></>;
      }
      await render(<AnnotationFixture/>);
      const paragraphs=document.querySelectorAll("article.message.assistant p");
      const pointer=(element,event)=>element.dispatchEvent(new PointerEvent(event,{bubbles:true,button:0,pointerId:1}));
      const selectPassage=async index=>{
        pointer(paragraphs[index],"pointerdown");await wait();
        check(!document.querySelector(".annotation-popover"),"starting a new drag must hide the previous bubble");
        const range=document.createRange();range.selectNodeContents(paragraphs[1-index]);
        getSelection().removeAllRanges();getSelection().addRange(range);await wait();
        check(!document.querySelector(".annotation-popover"),"selection changes during dragging must not show the bubble");
        range.selectNodeContents(paragraphs[index]);
        getSelection().removeAllRanges();getSelection().addRange(range);await wait();
        check(!document.querySelector(".annotation-popover"),"extending the drag must not show the bubble");
        pointer(document.body,"pointerup");
        await until(()=>document.querySelector(".annotation-popover > button"),"releasing the pointer must show annotation trigger");
      };
      const keyboardRange=document.createRange();keyboardRange.selectNodeContents(paragraphs[0]);
      getSelection().removeAllRanges();getSelection().addRange(keyboardRange);
      await until(()=>document.querySelector(".annotation-popover > button"),"non-pointer selections must still show the bubble");
      pointer(paragraphs[0],"pointerdown");pointer(paragraphs[0],"pointercancel");await wait();
      check(!document.querySelector(".annotation-popover"),"canceling a drag must leave the bubble hidden");
      await selectPassage(0);
      await selectPassage(1);
      check(document.querySelector(".annotation-popover > button").textContent==="注釈をつける","annotation trigger must have the requested label");
      const annotationTrigger=document.querySelector(".annotation-popover > button");
      pointer(annotationTrigger,"pointerdown");pointer(annotationTrigger,"pointerup");
      await click(annotationTrigger);
      check(!!document.querySelector(".annotation-popover textarea"),"pressing the bubble must keep it available for editing");
      check(!CSS.highlights.has("pig-annotation-saved"),"editing alone must not leave a saved annotation mark");
      await type(document.querySelector(".annotation-popover textarea"),"Second occurrence only");
      await click(document.querySelector('.annotation-popover button[type="submit"]'));
      await until(()=>CSS.highlights.has("pig-annotation-saved"),"adding a comment must leave a source highlight");
      const savedRange=[...CSS.highlights.get("pig-annotation-saved")][0];
      check(savedRange.toString()==="Repeated passage" && paragraphs[1].contains(savedRange.startContainer),"the mark must use the exact selected occurrence, not the first matching text");
      check(getComputedStyle(paragraphs[1],"::highlight(pig-annotation-saved)").backgroundColor!==getComputedStyle(paragraphs[1],"::selection").backgroundColor,"annotation markers must differ from selection blue");
      const firstCard=document.querySelector(".composer-annotations li");
      firstCard.dispatchEvent(new MouseEvent("mouseenter"));
      check(CSS.highlights.get("pig-annotation-active")?.has(savedRange),"hovering a card must emphasize its source");
      firstCard.dispatchEvent(new MouseEvent("mouseleave"));
      check(!CSS.highlights.has("pig-annotation-active"),"leaving a card must soften its source");
      getSelection().removeAllRanges();
      const sourceRect=savedRange.getClientRects()[0];
      paragraphs[1].dispatchEvent(new MouseEvent("click",{bubbles:true,clientX:sourceRect.left+2,clientY:sourceRect.top+2}));
      check(document.activeElement===firstCard && CSS.highlights.has("pig-annotation-active"),"clicking marked text must focus the corresponding card and emphasize its source");
      await selectPassage(0);
      await click(document.querySelector(".annotation-popover > button"));
      await click(document.querySelector('.annotation-popover button[type="submit"]'));
      check(CSS.highlights.get("pig-annotation-saved")?.size===2,"multiple annotations must retain independent source marks");
      await click(document.querySelector(".annotation-remove"));
      check(CSS.highlights.get("pig-annotation-saved")?.size===1 && !CSS.highlights.has("pig-annotation-active"),"removing a card must clear only its mark and active state");
      await render(<div/>);
      check(!CSS.highlights.has("pig-annotation-saved") && !CSS.highlights.has("pig-annotation-active"),"leaving the draft must clean up all source marks");
      flushSync(()=>useStore.setState(state=>({settings:{...state.settings,language:"en"}})));
      metrics.annotations=true;
      metrics.stage="annotation-targets";
      const annotationCall={id:"annotation-target",name:"read",arguments:{path:"fixture.txt"}};
      await render(<><article className="message assistant">
        <div className="before-label"><Markdown text="Response content"/></div>
        <ThinkingBlock text="Reasoning content" label="Thinking" active={false}/>
        <ThinkingBlock text="" label="Thinking" active/>
        <ToolBlock call={{id:"annotation-shell",name:"bash",arguments:{command:"echo fixture"}}} state={{status:"done",result:{content:[{type:"text",text:"Execution result"}]}}} live={false}/>
        <ToolBlock call={annotationCall} state={{status:"done"}} live={false}/>
        <ToolGroup calls={[annotationCall]} tools={{}} live={false}/>
        <div className="after-label"><Markdown text="More response content"/></div>
        <div className="response-footer"><strong>Finished</strong><time>12:00</time></div>
        <button type="button">Show work</button>
      </article><AnnotationPopover onAdd={()=>{}}/></>);
      const selectAnnotationTarget=async selector=>{
        const element=document.querySelector(selector),range=document.createRange();
        check(element,"missing annotation target: "+selector);range.selectNodeContents(element);
        getSelection().removeAllRanges();getSelection().addRange(range);await wait();
      };
      for(const selector of [".before-label p",".thinking-body p",".tool-cmd",".tool-term-output",".tool-row:not(.tool-group) .tool-target"]){
        await selectAnnotationTarget(selector);
        check(document.querySelector(".annotation-popover > button"),"response and execution content must remain annotatable: "+selector);
      }
      for(const selector of [".thinking > summary",".thinking.active",".tool-verb",".tool-term-status",".tool-prompt",".tool-group > summary .tool-target",".response-footer strong",".response-footer time","article > button"]){
        await selectAnnotationTarget(selector);
        check(!document.querySelector(".annotation-popover"),"UI labels must not offer annotation: "+selector);
      }
      const mixedRange=document.createRange();mixedRange.setStartBefore(document.querySelector(".before-label"));mixedRange.setEndAfter(document.querySelector(".after-label"));
      getSelection().removeAllRanges();getSelection().addRange(mixedRange);await wait();
      check(!document.querySelector(".annotation-popover"),"content endpoints must not allow UI labels in the middle of a quote");
      getSelection().removeAllRanges();
      metrics.annotationTargets=true;
      metrics.stage="tool-annotations";
      function ToolAnnotationFixture({grouped}){
        const [items,setItems]=useState([]);
        const call={id:"annotated-tool",name:grouped?"read":"bash",arguments:grouped?{path:"file.txt"}:{command:"echo repeated"}};
        const state={status:"done",result:{content:[{type:"text",text:"Repeated tool passage\\nRepeated tool passage"}]}};
        return <><article className="message assistant">{grouped?<ToolGroup calls={[call]} tools={{[call.id]:state}} live={false}/>:<ToolBlock call={call} state={state} live={false}/>}</article>
          <AnnotationPopover onAdd={(annotation,range)=>{const id=crypto.randomUUID();rememberAnnotationRange(id,range);setItems(items=>[...items,{id,...annotation}]);}}/>
          <AnnotationDrafts annotations={items} onRemove={id=>setItems(items=>items.filter(item=>item.id!==id))}/></>;
      }
      for(const grouped of [false,true]){
        await render(<ToolAnnotationFixture key={String(grouped)} grouped={grouped}/>);
        if(grouped){await click(document.querySelector(".tool-group > summary"));await click(document.querySelector(".tool-group-body > details > summary"));}
        const source=document.querySelector(grouped?".tool-body pre":".tool-term-output");
        const walker=document.createTreeWalker(source,NodeFilter.SHOW_TEXT);let selectedText;
        for(let node=walker.nextNode();node;node=walker.nextNode()) if(node.textContent.includes("Repeated tool passage"))selectedText=node;
        const range=document.createRange(),quote="Repeated tool passage",offset=selectedText.textContent.lastIndexOf(quote);
        range.setStart(selectedText,offset);range.setEnd(selectedText,offset+quote.length);
        getSelection().removeAllRanges();getSelection().addRange(range);
        await until(()=>document.querySelector(".annotation-popover > button"),"tool text selection must offer annotation");
        await click(document.querySelector(".annotation-popover > button"));
        await click(document.querySelector('.annotation-popover button[type="submit"]'));
        const marked=[...CSS.highlights.get("pig-annotation-saved")][0];
        check(marked.toString()===quote && marked.startContainer===selectedText,"annotation must mark the exact repeated occurrence in tool output");
        const firstText=document.createTreeWalker(source,NodeFilter.SHOW_TEXT).nextNode();
        const firstRange=document.createRange(),firstOffset=firstText.textContent.indexOf(quote);
        firstRange.setStart(firstText,firstOffset);firstRange.setEnd(firstText,firstOffset+quote.length);
        getSelection().removeAllRanges();getSelection().addRange(firstRange);
        await until(()=>document.querySelector(".annotation-popover > button"),"another tool annotation must remain available");
        await click(document.querySelector(".annotation-popover > button"));await click(document.querySelector('.annotation-popover button[type="submit"]'));
        check(CSS.highlights.get("pig-annotation-saved")?.size===2,"tool annotations must keep independent exact source ranges");
        const tool=document.querySelector('details[data-tool-call-id="annotated-tool"]');
        await click(tool.querySelector("summary"));
        check(!tool.open && source.isConnected && marked.toString()===quote,"an annotated body must keep its exact source range while closed");
        if(grouped){await click(document.querySelector(".tool-group > summary"));check(source.isConnected && marked.toString()===quote,"closing an ancestor group must protect annotated child ranges");await click(document.querySelector(".tool-group > summary"));}
        await click(tool.querySelector("summary"));
        const card=document.querySelector(".annotation-card");card.dispatchEvent(new MouseEvent("mouseenter"));
        check(visible(source) && CSS.highlights.get("pig-annotation-active")?.has(marked),"reopened tool annotations must still highlight the original source");
        card.dispatchEvent(new MouseEvent("mouseleave"));getSelection().removeAllRanges();
        const rect=marked.getClientRects()[0];source.dispatchEvent(new MouseEvent("click",{bubbles:true,clientX:rect.left+2,clientY:rect.top+2}));
        check(document.activeElement===card && CSS.highlights.has("pig-annotation-active"),"reopened source clicks must still focus their annotation card");
        await click(tool.querySelector("summary"));
        if(grouped)await click(document.querySelector(".tool-group > summary"));
        await click(document.querySelector(".annotation-remove"));
        check(source.isConnected && CSS.highlights.get("pig-annotation-saved")?.size===1,"removing one annotation must not discard another annotation's protected body");
        await click(document.querySelector(".annotation-remove"));
        await until(()=>!source.isConnected,"removing the last annotation must release the closed protected body");
        check(!CSS.highlights.has("pig-annotation-saved") && !CSS.highlights.has("pig-annotation-active"),"last annotation removal must clear all highlights");
        if(grouped)check(!document.querySelector(".tool-group-body"),"annotation removal must also release the closed parent group");
      }
      metrics.toolAnnotationsPreserved=true;
      metrics.stage="ui-design-contracts";
      const cardClasses=["settings-card","market-card","installed-card","annotation-card","session-panel","response-error","provider-usage-card"];
      await render(<div>{cardClasses.map(name=><div key={name} className={name}>Card text</div>)}</div>);
      const swatch=document.createElement("canvas");swatch.width=swatch.height=1;const paint=swatch.getContext("2d");
      for(const name of cardClasses){
        const style=getComputedStyle(document.querySelector("."+name));paint.clearRect(0,0,1,1);paint.fillStyle=style.backgroundColor;paint.fillRect(0,0,1,1);
        const alpha=paint.getImageData(0,0,1,1).data[3];
        check(alpha>0 && alpha<255,"normal Card background must be translucent: "+name);
        check(style.opacity==="1","Card text/icons must not fade with the background: "+name);
      }
      const contractOutput=Array.from({length:40},()=>"wide output ".repeat(80)).join("\\n");
      const oldFontScale=document.documentElement.style.getPropertyValue("--font-scale");
      for(const width of [280,760])for(const scale of [1,1.25]){
        document.documentElement.style.setProperty("--font-scale",String(scale));
        await render(<article key={width+":"+scale} className="message assistant" style={{width}}>
          <ToolBlock call={{id:"contract-shell",name:"bash",arguments:{command:"echo fixture"}}} state={{status:"done",result:{content:[{type:"text",text:contractOutput}]}}} live={false}/>
          <ToolBlock call={{id:"contract-edit",name:"edit",arguments:{path:"file.ts"}}} state={{status:"done",result:{details:{diff:contractOutput}}}} live={false}/>
        </article>);
        const frame=document.querySelector(".tool-term").getBoundingClientRect(),preview=document.querySelector(".tool-term-output").getBoundingClientRect(),diffRect=document.querySelector(".tool-diff").getBoundingClientRect();
        check(Math.abs(frame.left-diffRect.left)<=1 && Math.abs(frame.right-diffRect.right)<=1,"terminal and file frames must align at narrow/wide widths and changed font sizes");
        check(preview.left-frame.left>=1 && frame.right-preview.right>=1 && frame.bottom-preview.bottom>=1,"terminal scroller must leave at least 1px inside the Card ring");
        checkPreviewRows(document.querySelector(".tool-term-output"));checkPreviewRows(document.querySelector(".tool-diff"));
      }
      if(oldFontScale)document.documentElement.style.setProperty("--font-scale",oldFontScale);else document.documentElement.style.removeProperty("--font-scale");
      const beforeMoreChats=useStore.getState();
      const moreChatsCwd="centered-more-chats-fixture";
      flushSync(()=>useStore.setState({sessions:{...beforeMoreChats.sessions,[moreChatsCwd]:Array.from({length:8},(_,i)=>({id:"centered-chat-"+i,cwd:moreChatsCwd,title:"Chat "+i,modified:8-i}))}}));
      for(const width of [180,240])for(const scale of [1,1.25]){
        document.documentElement.style.setProperty("--font-scale",String(scale));
        await render(<div key={width+":"+scale} className="project-threads" style={{width}}><SessionList cwd={moreChatsCwd}/></div>);
        const toggle=document.querySelector(".more-chats");
        const checkCentered=()=>{
          const bounds=toggle.getBoundingClientRect(),icon=toggle.querySelector("svg").getBoundingClientRect();
          check(Math.abs((icon.left+icon.right-bounds.left-bounds.right)/2)<=0.5,"chat list toggle icon must be horizontally centered in its hit target");
          check(Math.abs((icon.top+icon.bottom-bounds.top-bounds.bottom)/2)<=0.5,"chat list toggle icon must be vertically centered in its hit target");
        };
        check(toggle.getAttribute("aria-expanded")==="false","chat list must start collapsed");checkCentered();
        const height=toggle.getBoundingClientRect().height;
        await click(toggle);
        check(toggle.getAttribute("aria-expanded")==="true","chat list must expand");checkCentered();
        check(toggle.getBoundingClientRect().height===height,"toggle height must not change on expansion");
        await click(toggle);checkCentered();
      }
      await render(null);
      flushSync(()=>useStore.setState(beforeMoreChats,true));
      if(oldFontScale)document.documentElement.style.setProperty("--font-scale",oldFontScale);else document.documentElement.style.removeProperty("--font-scale");
      metrics.moreChatsCentered=true;
      await render(<aside className="sidebar" style={{height:180}}><div className="project-list"/><div className="sidebar-footer"><button className="sidebar-icon">A</button><button className="sidebar-icon">B</button></div></aside>);
      const sidebar=document.querySelector(".sidebar").getBoundingClientRect(),footer=document.querySelector(".sidebar-footer").getBoundingClientRect(),list=document.querySelector(".project-list").getBoundingClientRect();
      check(Math.abs(footer.top-list.bottom-(sidebar.bottom-footer.bottom))<=1 && footer.top-list.bottom>=12,"sidebar icons need equal top/bottom breathing room");
      metrics.uiDesignContracts={translucentCards:cardClasses.length,alignedPreviewVariants:4,terminalRingInset:1,sidebarSpacing:true};
      metrics.stage="scrollbar-geometry";
      // Paint real native scrollbars: computed styles alone cannot detect the
      // bottom-right corner's contribution or a thumb clipped by an ancestor.
      const scrollbarStyle=document.createElement("style");
      scrollbarStyle.textContent='::-webkit-scrollbar-thumb{background-color:rgb(255,0,255)!important}.scrollbar-audit{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;padding:12px}.scrollbar-audit section{min-width:0}.scrollbar-audit .audit-scroller{position:relative;inset:auto;width:100%;height:100px;min-height:0;max-height:100px;max-width:none;margin:0;flex:none}.scrollbar-audit main{display:block;height:auto;margin:0;box-shadow:none}.scrollbar-audit dialog{display:block}.scrollbar-audit .slash-options{position:relative;bottom:auto}.scrollbar-audit .composer{padding:10px 12px}.scrollbar-audit label{display:block;font-size:11px}.scrollbar-audit .audit-scroller[data-axis="x"]{overflow-x:auto;overflow-y:hidden}.scrollbar-audit .audit-scroller[data-axis="y"]{overflow-x:hidden;overflow-y:auto}';
      document.head.append(scrollbarStyle);
      const cases=[
        ["shell-both",'<details class="tool-term done" open><summary>$ fixture</summary><pre class="tool-term-output audit-scroller"></pre></details>'],
        ["shell-horizontal",'<details class="tool-term done" open><summary>$ fixture</summary><pre class="tool-term-output audit-scroller" data-axis="x"></pre></details>'],
        ["shell-vertical",'<details class="tool-term done" open><summary>$ fixture</summary><pre class="tool-term-output audit-scroller" data-axis="y"></pre></details>'],
        ["horizontal-stable-gutter",'<pre class="audit-scroller" data-axis="x" style="scrollbar-gutter:stable;white-space:pre"></pre>'],
        ["edit",'<div class="tool-body"><pre class="tool-diff audit-scroller"></pre></div>'],
        ["markdown",'<div class="prose"><pre class="audit-scroller"></pre></div>'],
        ["read",'<div class="tool-body"><div class="message-content literal"><pre class="audit-scroller"></pre></div></div>'],
        ["sidebar",'<div class="project-list audit-scroller"></div>'],
        ["conversation",'<main><div class="chat-shell"><div class="thread-scroll audit-scroller" data-axis="y"></div></div></main>'],
        ["content-page",'<main><div class="content-page audit-scroller" data-axis="y"></div></main>'],
        ["provider-groups",'<div class="provider-groups audit-scroller"></div>'],
        ["provider-usage",'<div class="provider-usage-card"><ul class="provider-usage-list audit-scroller" data-axis="y"></ul></div>'],
        ["provider-detail",'<div class="provider-detail audit-scroller"></div>'],
        ["provider-utility",'<div class="provider-utility-panel audit-scroller"></div>'],
        ["provider-filters",'<fieldset class="provider-filters audit-scroller" data-axis="x"></fieldset>'],
        ["settings-nav",'<nav class="settings-nav audit-scroller" data-axis="x"></nav>'],
        ["slash-options",'<div class="slash-options audit-scroller"></div>'],
        ["queue",'<details class="message-queue" open><ol class="audit-scroller"></ol></details>'],
        ["models",'<div class="picker-panel model-panel" style="position:static;width:100%"><div class="model-results audit-scroller"></div></div>'],
        ["fonts",'<div class="font-picker-panel" style="padding:6px"><div class="font-picker-list audit-scroller"></div></div>'],
        ["notification-history",'<div class="notification-panel" style="position:static;width:100%"><div class="notification-history audit-scroller"></div></div>'],
        ["oauth",'<dialog class="oauth-dialog audit-scroller" open></dialog>'],
        ["sdk-dialog",'<dialog class="sdk-request audit-scroller" open></dialog>'],
        ["session-dock",'<div class="session-panel" style="width:100%"><div class="session-dock-viewport audit-scroller"></div></div>'],
        ["session-connections",'<div class="session-panel" style="width:100%"><details class="session-connections" open><div class="audit-scroller"></div></details></div>'],
        ["session-task",'<div class="session-task-output"><pre class="audit-scroller"></pre></div>'],
        ["session-document",'<div class="session-document audit-scroller"></div>'],
        ["composer-editor",'<form class="composer"><textarea class="audit-scroller" data-axis="y"></textarea></form>'],
        ["user-editor",'<div class="user-bubble"><form class="user-edit"><textarea class="audit-scroller" data-axis="y"></textarea></form></div>'],
        ["annotation-editor",'<div class="annotation-popover" style="position:static"><form style="width:100%"><textarea class="audit-scroller" data-axis="y"></textarea></form></div>'],
        ["image-thumbnails",'<div class="image-thumbnails audit-scroller"></div>'],
        ["image-viewer-thumbs",'<div class="image-viewer-thumbs audit-scroller"></div>'],
        ["image-viewport",'<div class="image-viewer-viewport audit-scroller"></div>'],
        ["extension-dialogs",'<div class="extension-dialogs audit-scroller"></div>'],
        ["toasts",'<div class="notifications audit-scroller"></div>'],
        ["custom-record",'<div class="custom-record"><pre class="audit-scroller"></pre></div>'],
        ["draft-conflict",'<div class="draft-conflict"><pre class="audit-scroller"></pre></div>'],
      ];
      const screenshot=async()=>{
        window.__scrollbarCapture=true;
        await until(()=>typeof window.__scrollbarCapture==="string","missing native scrollbar screenshot");
        const image=new Image();image.src="data:image/png;base64,"+window.__scrollbarCapture;await image.decode();
        const canvas=document.createElement("canvas");canvas.width=image.width;canvas.height=image.height;const context=canvas.getContext("2d");context.drawImage(image,0,0);
        delete window.__scrollbarCapture;
        return context.getImageData(0,0,image.width,image.height);
      };
      function thumb(image,element,axis){
        const rect=element.getBoundingClientRect(),style=getComputedStyle(element);
        const left=Math.round(rect.left+parseFloat(style.borderLeftWidth)),right=Math.round(rect.right-parseFloat(style.borderRightWidth));
        const top=Math.round(rect.top+parseFloat(style.borderTopWidth)),bottom=Math.round(rect.bottom-parseFloat(style.borderBottomWidth));
        const start=axis==="x"?left:top,end=axis==="x"?right:bottom,points=[];
        for(let p=start;p<end;p++){
          const x=axis==="x"?p:right-4,y=axis==="x"?bottom-4:p,index=(y*image.width+x)*4;
          if(image.data[index]>180 && image.data[index+1]<60 && image.data[index+2]>180)points.push(p);
        }
        check(points.length>4,"native thumb must be visible and unclipped: "+element.dataset.name+"/"+axis);
        return {leading:points[0]-start,trailing:end-1-points.at(-1),length:points.length};
      }
      metrics.scrollbars=[];
      for(const width of [960,720])for(let batch=0;batch<cases.length;batch+=9){
        await render(<div className="scrollbar-audit" style={{width}} dangerouslySetInnerHTML={{__html:cases.slice(batch,batch+9).map(([name,html])=>'<section><label>'+name+'</label>'+html+'</section>').join("")}}/>);
        const scrollers=[...document.querySelectorAll(".audit-scroller")];
        scrollers.forEach((element,index)=>{
          element.dataset.name=cases[batch+index][0];
          check(getComputedStyle(element).scrollbarWidth==="auto","native thin scrollbars must not bypass track insets: "+element.dataset.name);
          const text=("scrollbar fixture ".repeat(30)+"\\n").repeat(40);
          if(element.tagName==="TEXTAREA")element.value=text;else if(element.tagName==="PRE")element.textContent=text;else{const child=document.createElement("div");child.style.cssText="flex:none;width:1800px;height:600px";child.textContent="Scroll content";element.append(child);}
          element.scrollTop=0;element.scrollLeft=0;
        });
        await wait();
        const before=await screenshot();
        const starts=scrollers.map(element=>({x:element.scrollWidth>element.clientWidth && getComputedStyle(element).overflowX!=="hidden"?thumb(before,element,"x"):null,y:element.scrollHeight>element.clientHeight && getComputedStyle(element).overflowY!=="hidden"?thumb(before,element,"y"):null}));
        scrollers.forEach(element=>{element.scrollTop=1e6;element.scrollLeft=1e6;});await wait();
        const after=await screenshot();
        scrollers.forEach((element,index)=>{
          const axes=[];
          for(const axis of ["x","y"]){
            const start=starts[index][axis];if(!start)continue;
            const end=thumb(after,element,axis),inset=parseFloat(getComputedStyle(element).getPropertyValue("--scrollbar-inset"));
            check(Math.abs(start.leading-end.trailing)<=1,"native track must have equal end insets: "+JSON.stringify({name:element.dataset.name,width,axis,start,end}));
            check(start.leading>=inset && end.trailing>=inset,"thumb must clear rounded corners: "+element.dataset.name+"/"+axis);
            check(Math.abs(start.length-end.length)<=1,"thumb must not be clipped at either extreme: "+element.dataset.name+"/"+axis);
            check((axis==="x"?element.scrollLeft:element.scrollTop)>0,"all content must remain reachable: "+element.dataset.name+"/"+axis);
            axes.push(axis);
          }
          check(axes.length>0,"fixture must exercise a native scrollbar: "+element.dataset.name);
          metrics.scrollbars.push({name:element.dataset.name,width,axes});
        });
      }
      scrollbarStyle.remove();
      window.__transcriptReport={ok:true,metrics};
    `,
      );
      const cssFiles = new Set([
        fileURLToPath(new URL("./styles.css", import.meta.url)),
        fileURLToPath(import.meta.resolve("katex/dist/katex.min.css")),
      ]);
      const built = await Bun.build({
        entrypoints: [entry],
        target: "browser",
        minify: true,
        define: { "process.env.NODE_ENV": '"production"' },
        loader: { ".svg": "text" },
        plugins: [
          await renderWorkerFixturePlugin(),
          {
            name: "isolated-host",
            setup(build) {
              build.onResolve({ filter: /^react\/jsx-runtime$/ }, () => ({
                path: fileURLToPath(import.meta.resolve("react/jsx-runtime")),
              }));
              build.onLoad({ filter: /\.css$/ }, ({ path }) => {
                cssFiles.add(path);
                return { loader: "js", contents: "" };
              });
              build.onLoad({ filter: /[\\/]rpc\.ts$/ }, () => ({
                loader: "ts",
                contents: `
          const noop=()=>{};export const rpc={request:new Proxy({},{get:(_,method)=>async params=>{
            if(window.__requests?.[method])return window.__requests[method](params);
            if(method==="getSessionHistory")return window.__getSessionHistory(params);
            if(method==="listFontFamilies")return [];
            if(method==="syncDraft")return {applied:true,draft:{...params.content,revision:params.expectedRevision+1}};
            return {};
          }}),send:new Proxy({},{get:()=>noop})};
          export const sends={subscribe:()=>noop,getTick:()=>0,read:()=>window.__sendState,optimistic:()=>[],queued:()=>[],retained:()=>[],send:async(_address,_content,_attachments,delivery)=>{window.__sendCount=(window.__sendCount??0)+1;window.__sendModes?.push(delivery);}};
          export const updateAppearance=noop,updateSettings=noop,updateUiPreferences=noop,refreshSessions=noop,refresh=()=>window.__refresh?.()??Promise.resolve(),requestSelection=(_address,request)=>request(),connectRuntime=noop,initRuntimeConnection=noop,cancelOpening=noop,openChat=noop,showPendingOpen=noop,openChatLink=noop,forkChat=noop,regenerate=noop,initSessionLinks=noop,initSessionReadTracking=noop,reconnectRuntime=noop;
        `,
              }));
            },
          },
        ],
      });
      expect(built.success, built.logs.map(String).join("\n")).toBe(true);
      const script = await built.outputs[0].text();
      await Bun.write(
        join(dir, "fixture.js"),
        `const fail=error=>{window.__transcriptReport={ok:false,error:String(error),stack:error?.stack,metrics:window.__transcriptMetrics};};window.addEventListener("error",event=>fail(event.error??event.message));window.addEventListener("unhandledrejection",event=>fail(event.reason));void (async()=>{try{${script}}catch(error){fail(error);}})()`,
      );
      const cssEntry = join(dir, "styles.css");
      await Bun.write(
        cssEntry,
        [...cssFiles]
          .map(
            (path) => `@import ${JSON.stringify(path.replaceAll("\\", "/"))};`,
          )
          .join("\n"),
      );
      const styles = await buildStyles({
        configFile: false,
        root: dir,
        logLevel: "silent",
        plugins: [tailwindcss()],
        build: {
          write: false,
          assetsInlineLimit: Number.POSITIVE_INFINITY,
          rollupOptions: { input: cssEntry },
        },
      });
      if (Array.isArray(styles) || !("output" in styles))
        throw new Error("Expected one stylesheet build");
      const css = styles.output.find(
        (asset) => asset.type === "asset" && asset.fileName.endsWith(".css"),
      );
      if (css?.type !== "asset")
        throw new Error("Missing production stylesheet");
      await Bun.write(join(dir, "fixture.css"), css.source);
      const html = join(dir, "index.html");
      await Bun.write(
        html,
        '<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="fixture.css"><div id="root"></div><script src="fixture.js"></script>',
      );
      const child = Bun.spawn(
        [
          edge,
          "--headless=new",
          "--disable-gpu",
          "--no-first-run",
          "--no-default-browser-check",
          "--disable-extensions",
          "--disable-background-mode",
          `--user-data-dir=${join(dir, "profile")}`,
          "--remote-debugging-port=0",
          "--disable-background-timer-throttling",
          "--disable-renderer-backgrounding",
          "--disable-backgrounding-occluded-windows",
          "--force-device-scale-factor=1",
          "--window-size=1100,800",
          "about:blank",
        ],
        { stdout: "ignore", stderr: "pipe" },
      );
      const timeout = setTimeout(() => child.kill(), 45_000);
      const errors = new Response(child.stderr).text();
      let socket: WebSocket | undefined;
      try {
        const portFile = join(dir, "profile", "DevToolsActivePort");
        let port = "";
        for (let i = 0; i < 400; i++) {
          try {
            const lines = (await readFile(portFile, "utf8")).split(/\r?\n/);
            if (/^\d+$/.test(lines[0]) && lines[1]?.startsWith("/devtools/")) {
              port = lines[0];
              break;
            }
          } catch (error) {
            // On Windows Edge may still hold the new port file exclusively.
            const code = (error as NodeJS.ErrnoException).code;
            if (code !== "ENOENT" && code !== "EBUSY") throw error;
          }
          await Bun.sleep(25);
        }
        if (!port) throw new Error("Edge did not publish its debugging port");
        const target = (await (
          await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, {
            method: "PUT",
          })
        ).json()) as { webSocketDebuggerUrl: string };
        socket = new WebSocket(target.webSocketDebuggerUrl);
        const connected = socket;
        await new Promise<void>((resolve, reject) => {
          connected.addEventListener("open", () => resolve(), { once: true });
          connected.addEventListener("error", reject, { once: true });
        });
        let id = 0;
        function command<T = unknown>(
          method: string,
          params: Record<string, unknown> = {},
        ): Promise<T> {
          return new Promise((resolve, reject) => {
            const requestId = ++id;
            const cleanup = () => {
              connected.removeEventListener("message", receive);
              connected.removeEventListener("close", closed);
            };
            const closed = () => {
              cleanup();
              reject(new Error("Fixture browser closed"));
            };
            const receive = (event: MessageEvent) => {
              const reply = JSON.parse(String(event.data));
              if (reply.id !== requestId) return;
              cleanup();
              if (reply.error) reject(new Error(reply.error.message));
              else resolve(reply.result);
            };
            connected.addEventListener("message", receive);
            connected.addEventListener("close", closed, { once: true });
            connected.send(JSON.stringify({ id: requestId, method, params }));
          });
        }
        // Edge's delayed 34px automation infobar must not resize the content
        // viewport halfway through native input/geometry assertions.
        await command("Emulation.setDeviceMetricsOverride", {
          width: 1100,
          height: 800,
          deviceScaleFactor: 1,
          mobile: false,
        });
        await command("Page.navigate", { url: pathToFileURL(html).href });
        type Report = { ok: boolean; metrics: { wheels: unknown[] } };
        type Evaluation = {
          result: {
            value: {
              wheel?: Record<string, unknown>;
              input?: { text: string };
              capture?: boolean;
              report?: Report;
            };
          };
          exceptionDetails?: unknown;
        };
        let report: Report | undefined;
        const deadline = Date.now() + 35_000;
        while (!report) {
          if (Date.now() > deadline) {
            const debug = await command("Runtime.evaluate", {
              expression:
                "({ready:document.readyState,metrics:window.__transcriptMetrics,text:document.body.innerText.slice(-500)})",
              returnByValue: true,
            });
            throw new Error(`UI fixture timed out: ${JSON.stringify(debug)}`);
          }
          let result: Evaluation;
          try {
            result = await command<Evaluation>("Runtime.evaluate", {
              expression:
                "({wheel:window.__transcriptWheel,input:window.__transcriptInput,capture:window.__scrollbarCapture===true,report:window.__transcriptReport})",
              returnByValue: true,
            });
          } catch (error) {
            // A new target may still be replacing its initial about:blank document.
            if (
              error instanceof Error &&
              error.message === "Execution context was destroyed."
            )
              continue;
            throw error;
          }
          expect(
            result.exceptionDetails,
            JSON.stringify(result),
          ).toBeUndefined();
          const state = result.result.value;
          if (state.wheel) {
            await command("Input.dispatchMouseEvent", state.wheel);
            await command("Runtime.evaluate", {
              expression: "delete window.__transcriptWheel",
            });
          }
          if (state.input) {
            await command("Input.insertText", state.input);
            await command("Runtime.evaluate", {
              expression: "delete window.__transcriptInput",
            });
          }
          if (state.capture) {
            const screenshot = await command<{ data: string }>(
              "Page.captureScreenshot",
              { format: "png" },
            );
            await command("Runtime.evaluate", {
              expression: `window.__scrollbarCapture=${JSON.stringify(screenshot.data)}`,
            });
          }
          report = state.report;
          if (!report) await Bun.sleep(25);
        }
        if (process.env.PIG_UI_SCREENSHOT) {
          const screenshot = await command<{ data: string }>(
            "Page.captureScreenshot",
            { format: "png" },
          );
          await Bun.write(
            process.env.PIG_UI_SCREENSHOT,
            Buffer.from(screenshot.data, "base64"),
          );
        }
        for (const [variable, filename] of [
          ["__responseSpacingScreenshot", "pig-response-spacing.png"],
          ["__jumpButtonScreenshot", "pig-scroll-to-bottom.png"],
          ["__modelPickerScreenshot", "pig-model-picker.png"],
          ["__defaultModelScreenshot", "pig-default-model-settings.png"],
        ]) {
          const screenshot = await command<{ result: { value?: string } }>(
            "Runtime.evaluate",
            { expression: `window.${variable}`, returnByValue: true },
          );
          if (screenshot.result.value)
            await Bun.write(
              join(tmpdir(), filename),
              Buffer.from(screenshot.result.value, "base64"),
            );
        }
        expect(report.ok, JSON.stringify(report)).toBe(true);
        expect(report.metrics.wheels.length).toBeGreaterThanOrEqual(10);
        console.info(
          "Native transcript Edge regression",
          JSON.stringify(report.metrics),
        );
        passed = true;
      } finally {
        if (socket?.readyState === WebSocket.OPEN)
          socket.send(JSON.stringify({ id: -1, method: "Browser.close" }));
        else child.kill();
        await child.exited;
        clearTimeout(timeout);
        socket?.close();
        await errors;
      }
    } finally {
      if (passed) {
        try {
          await rm(dir, {
            recursive: true,
            force: true,
            maxRetries: 10,
            retryDelay: 100,
          });
        } catch (error) {
          // Edge's Windows profile writers can outlive the browser process; don't mask UI results.
          expect(["EBUSY", "ENOTEMPTY"], String(error)).toContain(
            (error as NodeJS.ErrnoException).code ?? "",
          );
          console.warn("Windows still holds the temporary Edge profile:", dir);
        }
      } else console.error("Failed Edge fixture retained at", dir);
    }
  },
  60_000,
);
