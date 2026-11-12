import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import { build as buildStyles } from "vite";

const edge = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";

test.skipIf(!existsSync(edge))(
  "transcript in Edge: native wheel scrolling, original appearance, history, search and streaming",
  async () => {
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
      import {App,Chat} from ${source("./App.tsx")};
      import {Extensions} from ${source("./Extensions.tsx")};
      import {FontPicker} from ${source("./FontPicker.tsx")};
      import {FontSettings} from ${source("./FontSettings.tsx")};
      import {Composer} from ${source("./Composer.tsx")};
      import {MessageQueue} from ${source("./MessageQueue.tsx")};
      import {AnnotationPopover} from ${source("./AnnotationPopover.tsx")};
      import {AnnotationDrafts} from ${source("./AnnotationCards.tsx")};
      import {rememberAnnotationRange} from ${source("./annotation-highlights.ts")};
      import {SessionPanel} from ${source("./SessionPanel.tsx")};
      import {UIRequestBroker} from ${source("./UIRequestBroker.tsx")};
      import {drafts} from ${source("./draft-store.ts")};
      import {receiveTerminal} from ${source("./runtime-events.ts")};
      import {ToolBlock,ToolGroup,ThinkingBlock} from ${source("./ToolBlock.tsx")};
      import {DisclosureScope} from ${source("./LazyDetails.tsx")};
      import {Markdown,BuiltinMarkdown} from ${source("./MessageContent.tsx")};
      import {CodeText} from ${source("./HighlightedCode.tsx")};
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
      const base={address:{hostId:"ui",sessionId:"chat",epoch:1},snapshotSeq:1,info:{id:"chat",cwd:"fixture",title:"Fixture",modified:1},effort:"off",effortLevels:[],ready:false};
      const record=(id,order,message)=>({id,parentId:null,branchId:"branch",order,kind:"message",message});
      const transcript=records=>({records,tools:{},history:{revision:"branch"},current:null,running:false,liveToEntry:{}});
      const user=i=>record("r"+i,i,{role:"user",content:"Question "+i+" "+(i===5?"needle-search ":"")+"wrapping words ".repeat(20),timestamp:i});
      const assistant=(id,order,content)=>record(id,order,{role:"assistant",content,api:"openai-responses",provider:"fixture",model:"fixture",usage:{input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}},stopReason:"stop",timestamp:order});
      function StoredChat({id}){const snapshot=useStore(state=>state.snapshots[id]);return <Chat snapshot={snapshot}/>;}
      const show=async snapshot=>{flushSync(()=>useStore.setState(state=>({snapshots:{...state.snapshots,[snapshot.info.id]:snapshot},settings:{...state.settings,language:"en"}})));await render(<StoredChat key={snapshot.info.id+":"+snapshot.address.epoch} id={snapshot.info.id}/>);};
      let snapshot;
      for(const count of [50,1000]){
        snapshot={...base,transcript:transcript(Array.from({length:count},(_,i)=>user(i)))};
        const started=performance.now();await show(snapshot);
        const mounted=document.querySelectorAll("[data-record-id]");
        metrics.loaded.push({count,mounted:mounted.length,ms:performance.now()-started});
        check(mounted.length===count && [...mounted].every(visible),"all loaded conversation rows must remain rendered");
        check(!document.querySelector(".text-range"),"loaded rows must not have presentation paging");
      }
      let thread=document.querySelector(".thread-scroll");
      check(getComputedStyle(thread).overflowY==="auto" && getComputedStyle(thread).overflowAnchor==="auto","the real stylesheet must allow browser scrolling and anchoring");
      const bubble=document.querySelector(".user-bubble");
      check(getComputedStyle(bubble).whiteSpace==="pre-wrap" && parseFloat(getComputedStyle(bubble).borderRadius)>0,"user bubbles must retain their original formatting");
      const writes=[];
      const scrollTop=Object.getOwnPropertyDescriptor(Element.prototype,"scrollTop");
      Object.defineProperty(thread,"scrollTop",{configurable:true,get(){return scrollTop.get.call(this);},set(value){writes.push(value);scrollTop.set.call(this,value);}});
      await wheel(thread,-420);await wheel(thread,160);await wheel(thread,-200);await wheel(thread,120);
      check(writes.length===0,"wheel input must not cause application scroll corrections");
      const reader=[...thread.querySelectorAll("[data-record-id]")].find(row=>row.getBoundingClientRect().top>=thread.getBoundingClientRect().top+24);
      const selected=reader.querySelector(".user-bubble");
      const selection=window.getSelection();const selectionRange=document.createRange();selectionRange.selectNodeContents(selected);selection.removeAllRanges();selection.addRange(selectionRange);
      const readingTop=thread.scrollTop,readingOffset=reader.getBoundingClientRect().top,readingHeight=thread.scrollHeight;
      snapshot={...snapshot,transcript:{...snapshot.transcript,records:[...snapshot.transcript.records,assistant("live",1000,[{type:"text",text:"Streaming starts"}])],current:"live",running:true}};await show(snapshot);
      snapshot={...snapshot,transcript:{...snapshot.transcript,records:[...snapshot.transcript.records.slice(0,-1),assistant("live",1000,[{type:"text",text:"Streaming paragraph\\n\\n".repeat(80)}])]}};await show(snapshot);await pause(150);await wait();
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
      async function search(query){
        const details=document.querySelector(".transcript-search");if(!details.open) await click(details.querySelector("summary"));
        const input=details.querySelector("input");Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(input,query);input.dispatchEvent(new Event("input",{bubbles:true}));
        await until(()=>details.querySelector("button"),"search must produce a result");await click(details.querySelector("button"));
      }
      await search("needle-search");
      check(document.activeElement.dataset.recordId==="r5" && visible(document.activeElement),"search must focus an earlier loaded record");
      const searchRect=document.activeElement.getBoundingClientRect(),threadRect=thread.getBoundingClientRect();
      check(searchRect.bottom>threadRect.top && searchRect.top<threadRect.bottom,"search must scroll its result into view");
      const searchTop=thread.scrollTop;
      snapshot={...snapshot,transcript:{...snapshot.transcript,records:[...snapshot.transcript.records,user(1001)]}};await show(snapshot);
      check(Math.abs(thread.scrollTop-searchTop)<=2,"a search result must not resume following background output");
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
      check(!visible(document.querySelector(".tool-diff")),"edits must start collapsed as in v0.2");
      await click(document.querySelector("summary"));
      metrics.diffSpans=document.querySelectorAll(".tool-diff > span").length;
      check(metrics.diffSpans===10000 && visible(document.querySelector(".tool-diff")) && !document.querySelector(".text-range"),"expanded diff must show every line in the original scrollable preview");
      check(getComputedStyle(document.querySelector(".tool-diff")).maxHeight==="240px","diff preview must keep its original height limit");
      await wheel(document.querySelector(".tool-diff"),320);
      await click(document.querySelector("summary"));check(!visible(document.querySelector(".tool-diff")),"closing must hide the diff");
      await render(<div/>);await render(edit);
      check(!visible(document.querySelector(".tool-diff")),"closing a diff must survive navigation");
      await render(<ThinkingBlock text="# actual thinking" label="Thinking" active={false}/>);
      check(!visible(document.querySelector("h1")),"thinking must start collapsed as in v0.2");
      await click(document.querySelector("summary"));
      check(visible(document.querySelector("h1")),"opened thinking must show formatted content");
      const output=Array.from({length:600},(_,i)=>"line "+i+" "+"original output ".repeat(4)+"end").join("\\n");
      await render(<ToolBlock call={{id:"shell",name:"bash",arguments:{command:"echo fixture"}}} state={{status:"done",result:{content:[{type:"text",text:output}]}}} live={false}/>);
      const peek=document.querySelector(".tool-peek");
      check(peek?.tagName==="PRE" && peek.parentElement.matches("details.tool-term") && peek.textContent===output.split("\\n").slice(-2).join("\\n"),"shell preview must keep the original separate two-line preformatted block");
      check(document.querySelector(".tool-badge.done").textContent==="exit 0","completed shell must retain its v0.2 exit badge");
      await click(document.querySelector(".tool-term > summary"));
      const shell=document.querySelector(".tool-term-output");
      check(shell.textContent===output && visible(shell) && !visible(peek) && getComputedStyle(shell).maxHeight==="280px" && !document.querySelector(".text-range"),"expanded shell must retain the complete output in its original preview");
      await wheel(shell,240);
      const syntaxCode='const message = "<script>literal</script>";\\nconst count = 42;';
      await render(<ToolBlock call={{id:"syntax-write",name:"write",arguments:{path:"file.ts",content:syntaxCode}}} state={{status:"done"}} live={false}/>);
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
      metrics.syntaxHighlighting=true;
      const calls=Array.from({length:500},(_,i)=>({id:"call"+i,name:"read",arguments:{path:"file"+i}}));
      await render(<ToolGroup calls={calls} tools={{}} live={false}/>);
      check(!visible(document.querySelector(".tool-group-body")),"exploration group must start collapsed");
      await click(document.querySelector("summary"));
      metrics.groupCalls=document.querySelectorAll(".tool-group-body > details").length;
      check(metrics.groupCalls===500 && !document.querySelector(".text-range") && document.querySelector('.tool-target[title="file499"]'),"expanded exploration group must keep every original tool row without paging or wrappers");
      await render(<ToolGroup calls={calls.slice(0,2)} tools={{}} live={false}/>);
      check(document.querySelectorAll(".tool-group-body > details").length===2,"a reconciled shorter group must show all remaining calls");
      let parses=0;
      installChatRenderers([{id:"counter",kind:"markdown",component:({DefaultRenderer})=>{parses++;return <DefaultRenderer/>;}}]);
      await render(<Markdown text={"start"} streaming/>);
      const before=parses;
      for(let i=0;i<100;i++) flushSync(()=>root.render(<Markdown text={"# token "+i} streaming/>));
      check(parses===before,"streaming updates must not reparse unchanged samples");
      await pause(130);
      check(parses===before+1 && document.querySelector("h1")?.textContent==="token 99","streaming must publish the latest sample once per interval");
      const final=["| A | B |","| - | - |","| 1 | 2 |","","[go][ref]","","[ref]: https://example.com","","\u0060\u0060\u0060ts","const x=1","\u0060\u0060\u0060","","$x^2$"].join("\\n");
      await render(<Markdown text={final}/>);
      await until(()=>document.querySelector("pre code.language-ts .syntax-token"),"Markdown code fences must eventually highlight");
      const complete=document.getElementById("root").innerHTML;
      const comparison=document.createElement("div");document.body.append(comparison);
      const other=createRoot(comparison);flushSync(()=>other.render(<BuiltinMarkdown data={{text:final}} DefaultRenderer={()=>null}/>));
      check(complete===comparison.innerHTML && document.querySelector("table td")?.textContent==="1" && document.querySelector('a[href="https://example.com"]') && document.querySelector("pre code.language-ts") && document.querySelector(".katex"),"final Markdown must preserve ordinary tables, references, code and math");
      await pause(130);check(document.getElementById("root").innerHTML===complete,"old streaming samples must not overwrite final Markdown");
      metrics.streamParses=parses-before;other.unmount();comparison.remove();installChatRenderers([]);
      await render(<Markdown text={"# Large\\n\\n"+"wrapping words ".repeat(10000)+"\\n\\n**End marker**"}/>);
      check(document.querySelector("h1")?.textContent==="Large" && document.querySelector("strong")?.textContent==="End marker" && !button(document,"Render full Markdown") && !document.querySelector(".text-range"),"large messages must use original Markdown appearance immediately");
      const workRecords=[user(0)];const tools={};
      for(let i=0;i<150;i++){const call={id:"t"+i,name:"bash",arguments:{command:"echo "+i}};const text="Tool-marker-"+i+"-end";workRecords.push(assistant("a"+i,1+2*i,[{type:"toolCall",...call}]));workRecords.push(record("result"+i,2+2*i,{role:"toolResult",toolCallId:call.id,toolName:"bash",content:[{type:"text",text}],isError:false,timestamp:i}));tools[call.id]={status:"done",result:{content:[{type:"text",text}]}};}
      workRecords.push(assistant("final",301,[{type:"text",text:"Final answer"}]));
      snapshot={...base,address:{...base.address,sessionId:"work"},info:{...base.info,id:"work"},transcript:{...transcript(workRecords),tools}};await show(snapshot);
      check(document.querySelector(".work-toggle")?.getAttribute("aria-expanded")==="false" && document.querySelector('[data-record-id="final"]').textContent.includes("Final answer"),"finished work must stay folded above the final answer");
      await search("Tool-marker-125-end");
      check(document.activeElement.closest("[data-record-id]")?.dataset.recordId==="a125" && document.activeElement.closest("[data-tool-call-id]")?.dataset.toolCallId==="t125" && document.activeElement.tagName==="SUMMARY","tool-result search must open work and focus its owning tool beyond the old record page");
      check(document.querySelectorAll(".tool-term").length===150 && !document.querySelector(".text-range"),"unfolded work must contain every tool record");
      for(const grouped of [true,false]){
        metrics.stage="nested-"+grouped;
        const nestedCalls=Array.from({length:150},(_,i)=>({id:"nested"+i,name:grouped?"read":"bash",arguments:grouped?{path:"file"+i}:{command:"echo "+i}}));
        const nestedTools={};
        const nestedResults=nestedCalls.map((call,i)=>{const text=i===125?"Single-marker-125-end\\n"+output:"small result "+i;nestedTools[call.id]={status:"done",result:{content:[{type:"text",text}]}};return record("nested-result"+i,2+i,{role:"toolResult",toolCallId:call.id,toolName:call.name,content:[{type:"text",text}],isError:false,timestamp:i});});
        const id=grouped?"single-grouped":"single-ungrouped";
        snapshot={...base,address:{...base.address,sessionId:id},info:{...base.info,id},transcript:{...transcript([user(0),assistant("single",1,nestedCalls.map(call=>({type:"toolCall",...call}))),...nestedResults,assistant("single-final",152,[{type:"text",text:"Nested final"}])]),tools:nestedTools}};await show(snapshot);await search("Single-marker-125-end");
        const focused=document.activeElement.closest("[data-tool-call-id]");
        check(focused?.dataset.toolCallId==="nested125" && document.activeElement.tagName==="SUMMARY","nested tool-result search must retain native summary focus");
        check(document.querySelectorAll("details[data-tool-call-id]").length===150 && !document.querySelector(".text-range"),"nested tools must all be available without content paging");
        check(focused.open && (grouped?focused.closest(".tool-group").open:!focused.closest(".tool-group")),"search must preserve exploration grouping and separate shell rows");
        check(focused.querySelector("pre").textContent.includes("line 599"),"search must expose complete output beyond the old text range");
        const readingThread=document.querySelector(".thread-scroll");const top=readingThread.scrollTop;
        metrics.stage="nested-wheel-"+grouped;
        await wheel(focused.querySelector(grouped?".tool-body pre":".tool-term-output"),120);
        check(Math.abs(readingThread.scrollTop-top)<=2,"wheel over a scrollable tool preview must scroll the preview alone");
      }
      // Pending work must not replace known content or add temporary status rows.
      const type=async(input,value)=>{Object.getOwnPropertyDescriptor(input instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,"value").set.call(input,value);input.dispatchEvent(new Event("input",{bubbles:true}));await wait();};
      const deferred=()=>Promise.withResolvers();
      metrics.stage="startup";
      const startup=deferred();window.__refresh=()=>startup.promise;
      flushSync(()=>useStore.setState(state=>({initialized:false,active:undefined,page:"chat",settings:{...state.settings,language:"en"}})));
      await render(<App/>);
      check(document.querySelector("main").textContent==="" && !document.querySelector(".welcome"),"startup must not publish English, disconnected or empty-state content");
      startup.reject(new Error("internal startup details"));await until(()=>document.querySelector('main [role="alert"]'),"failed initialization must offer recovery");
      check(!document.querySelector("main").textContent.includes("internal startup details"),"startup errors must not expose internal diagnostics");
      const retryStartup=deferred();window.__refresh=()=>retryStartup.promise;await click(button(document,"Retry"));check(document.querySelector("main").textContent==="","startup retry must retain the shell without temporary text");
      flushSync(()=>useStore.setState(state=>({initialized:true,settings:{...state.settings,language:"ja"}})));retryStartup.resolve();await wait();
      check(document.documentElement.lang==="ja" && document.querySelector(".welcome") && !document.querySelector("main").textContent.includes("What shall"),"first real screen must use the saved language");
      flushSync(()=>useStore.setState({page:"settings"}));await wait();
      check(document.querySelector(".settings-page") && !document.querySelector("main").textContent.includes("Loading"),"settings navigation must render immediately without a whole-screen fallback");
      await render(<div/>);flushSync(()=>useStore.setState(state=>({settings:{...state.settings,language:"en"}})));
      metrics.stage="packages";
      const searches=[];const installedRead=deferred();
      window.__requests={searchPackages:params=>{const read=deferred();searches.push({...params,read});return read.promise;},listInstalled:()=>installedRead.promise,packagePreviews:()=>({})};
      const pkg=name=>({name,version:"1",description:"Package "+name,publisher:"fixture",monthlyDownloads:1,date:"2026-01-01",types:[]});
      flushSync(()=>useStore.setState({installedLoaded:true,installed:[{source:"npm:cached",name:"cached",scope:"user",types:[]}],packageOps:{}}));
      await render(<Extensions/>);await until(()=>searches.length===1,"missing initial package search");
      check(document.querySelectorAll(".package-skeleton").length>0 && !document.body.textContent.includes("Finding packages"),"initial package search must show card-shaped skeletons instead of an empty grid or loading message");
      searches[0].read.resolve({items:[pkg("original")],total:2});await until(()=>document.querySelector(".market-card:not(.package-skeleton)"),"missing original package result");
      check(!document.querySelector(".package-skeleton"),"skeletons must be replaced by results");
      await until(()=>!document.querySelector(".package-preview.skeleton"),"previews absent from the response must stop shimmering");
      const originalCard=document.querySelector(".market-card"),originalCount=document.querySelector(".package-results").textContent;
      const searchInput=document.querySelector(".package-search input");await type(searchInput,"first");await until(()=>searches.some(read=>read.query==="first"),"first search did not start");
      check(document.querySelector(".market-card")===originalCard && document.querySelector(".package-results").textContent===originalCount,"search must retain both the old cards and their matching count while pending");
      const more=button(document,"Load more");check(more.disabled && more.textContent==="Load more","pending search must not append to an old query or resize the load-more button");
      await type(searchInput,"latest");await until(()=>searches.some(read=>read.query==="latest"),"latest search did not start");
      searches.find(read=>read.query==="latest").read.resolve({items:[pkg("latest")],total:1});await until(()=>document.querySelector(".market-card h2")?.textContent==="latest","latest search did not publish");
      searches.find(read=>read.query==="first").read.resolve({items:[pkg("stale")],total:1});await wait();
      check(document.querySelector(".market-card h2").textContent==="latest","late search result must not overwrite the latest query");
      await type(searchInput,"failed");await until(()=>searches.some(read=>read.query==="failed"),"failed search did not start");
      searches.find(read=>read.query==="failed").read.reject(new Error("fixture failure"));await until(()=>document.querySelector(".package-error"),"search failure must remain actionable");
      check(document.querySelector(".market-card h2").textContent==="latest","failed search must retain the last successful result");
      await click(document.getElementById("extensions-tab-installed"));
      check(document.querySelector(".installed-card h2").textContent==="cached" && !document.body.textContent.includes("Loading installed packages"),"cached installed packages must remain visible without an inserted loading row");
      flushSync(()=>useStore.setState({installed:[{source:"npm:newer",name:"newer",scope:"user",types:[]}]}));installedRead.resolve([]);await wait();
      check(document.querySelector(".installed-card h2").textContent==="newer","a stale installed read must not replace a newer package event");
      const uninstall=document.querySelector(".installed-card .package-actions button"),uninstallWidth=uninstall.getBoundingClientRect().width;
      flushSync(()=>useStore.setState({packageOps:{op:{opId:"op",source:"npm:newer",action:"uninstall",status:"running"}}}));await wait();
      check(document.querySelector(".installed-card .package-actions button")===uninstall && uninstall.disabled && uninstall.getAttribute("aria-busy")==="true" && uninstall.getBoundingClientRect().width===uninstallWidth,"package operations must keep their buttons and not pretend installation or deletion has finished");
      await render(<div/>);
      metrics.stage="actions";
      const actions=[];let actionGate=deferred();
      const actionState={generation:"ui",commands:[{adapterId:"ui",id:"apply",title:"Apply"}],keymaps:[],diagnostics:[],views:[{adapterId:"ui",revision:1,view:{id:"status",kind:"status",title:"Action",tone:"info",text:"Ready",source:{label:"Fixture",scope:{kind:"session",id:"action"},freshness:"saved",observedAt:"now"},actions:[{id:"apply",label:"Apply",command:"apply",fields:[{name:"note",label:"Note",required:true}]}]}}]};
      await render(<SessionPanel sessionId="action" state={actionState} onAction={request=>{actions.push(request);return actionGate.promise;}} onReload={async()=>{}}/>);
      await click(document.querySelector(".session-dock-summary"));
      const form=document.querySelector(".session-action");await type(form.querySelector("input"),"keep this text");
      const submit=form.querySelector('[type="submit"]'),height=form.getBoundingClientRect().height,width=submit.getBoundingClientRect().width;
      await click(submit);form.requestSubmit();await wait();
      check(actions.length===1 && submit.disabled && submit.getAttribute("aria-busy")==="true" && submit.textContent==="Apply","pending actions must keep their label and block duplicate execution");
      check(form.getBoundingClientRect().height===height && submit.getBoundingClientRect().width===width && !form.querySelector('[role="status"]'),"pending actions must not add a line or change geometry");
      actionGate.resolve();await until(()=>!submit.disabled,"action did not settle");actionGate=deferred();await click(submit);actionGate.reject(new Error("action failure"));
      await until(()=>form.querySelector('[role="alert"]'),"action failure must be visible");check(form.querySelector("input").value==="keep this text","action failure must preserve input");
      await render(<div/>);
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
      const keyEditor=document.querySelector("textarea");keyEditor.focus();
      const press=async(key,modifiers={})=>{const event=new KeyboardEvent("keydown",{key,bubbles:true,cancelable:true,...modifiers});keyEditor.dispatchEvent(event);await wait();return event;};
      await press("Enter");check(window.__sendModes.length===0 && keyEditor.value.includes("\\n"),"Enter must insert a newline, never send");
      await press("Enter",{shiftKey:true});await press("Enter",{ctrlKey:true});
      check(JSON.stringify(window.__sendModes)==='["followUp","steer"]',"Shift+Enter must queue and Ctrl+Enter must steer");
      await press("Enter",{isComposing:true});await press("Enter",{keyCode:229});await press("Enter",{ctrlKey:true,repeat:true});
      check(window.__sendModes.length===2,"IME confirmation and key-repeat must never send messages");
      const altEnter=await press("Enter",{altKey:true});check(!altEnter.defaultPrevented && window.__sendModes.length===2,"Alt+Enter must have no app shortcut binding");
      await type(keyEditor,"message");keyEditor.setSelectionRange(3,3);await press("Enter");
      check(keyEditor.value==="mes\\nsage" && keyEditor.selectionStart===4,"Enter must insert at the caret without sending");
      flushSync(()=>useStore.setState(state=>({settings:{...state.settings,keybindings:{"composer.steer":"Ctrl+S","composer.newline":"Ctrl+J"}}})));await wait();
      await press("j",{ctrlKey:true});check(window.__sendModes.length===2,"custom newline must not send");
      await press("s",{ctrlKey:true});check(window.__sendModes.length===3 && window.__sendModes[2]==="steer","custom steering binding must work in the real composer");
      check(!document.querySelector(".composer-dock kbd"),"the composer must not display shortcut instructions");
      flushSync(()=>useStore.setState(state=>({settings:{...state.settings,keybindings:{}}})));
      const queueActions=[];
      const queueContent={text:"A quiet follow-up",pastes:[],images:[]};
      await render(<div style={{width:340}}><MessageQueue items={[{id:"one",content:queueContent},{id:"two",content:{...queueContent,text:"Another message"}}]} onEdit={id=>queueActions.push("edit:"+id)} onDelete={id=>queueActions.push("delete:"+id)}/></div>);
      check(document.querySelectorAll(".message-queue li").length===2 && document.querySelector(".message-queue").scrollWidth<=340,"queue rows must fit a narrow composer without horizontal overflow");
      await click(document.querySelector('.message-queue button[aria-label="Edit queued message in composer"]'));
      await click(document.querySelector('.message-queue button[aria-label="Delete queued message"]'));
      check(JSON.stringify(queueActions)==='["edit:one","delete:one"]',"queue edit/delete controls must target the correct message");
      await click(document.querySelector(".message-queue summary"));check(!document.querySelector(".message-queue").open,"queue must collapse to its compact summary");
      metrics.composerKeys=true;await render(<div/>);
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
      const selectPassage=async index=>{
        const range=document.createRange();range.selectNodeContents(paragraphs[index]);
        getSelection().removeAllRanges();getSelection().addRange(range);
        await until(()=>document.querySelector(".annotation-popover > button"),"selection must show annotation trigger");
      };
      await selectPassage(1);
      check(document.querySelector(".annotation-popover > button").textContent==="注釈をつける","annotation trigger must have the requested label");
      await click(document.querySelector(".annotation-popover > button"));
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
      metrics.stage="terminal";
      const owner={hostId:"terminal-stability",sessionId:"terminal-stability",epoch:1};const terminalCommands=[];window.__requests={terminalCommand:command=>{terminalCommands.push(command);return {};}};
      const terminalRequest={...owner,uiId:"pending",kind:"terminal",title:"Fixture terminal"};
      flushSync(()=>useStore.setState({hostId:owner.hostId,active:owner.sessionId,page:"chat",addresses:{[owner.sessionId]:owner},snapshots:{[owner.sessionId]:{...base,ready:true,address:owner,info:{...base.info,id:owner.sessionId},transcript:transcript([])}},pendingUI:[],terminals:{}}));
      await render(<div className="app-shell"><main><p>Unchanged main</p></main><UIRequestBroker/></div>);const mainWidth=document.querySelector("main").getBoundingClientRect().width;
      flushSync(()=>useStore.setState({pendingUI:[terminalRequest]}));await until(()=>document.querySelector('.terminal-dialog[open]'),"terminal shell did not open");
      const pendingTerminal=document.querySelector(".terminal-dialog");
      check(document.querySelector("main").getBoundingClientRect().width===mainWidth && !document.querySelector(".ui-starting") && !pendingTerminal.querySelector(".xterm") && terminalCommands.length===0,"pending terminal must retain main width and must not initialize or send ready before host open");
      await click(pendingTerminal.querySelector("header button"));check(!pendingTerminal.open && terminalCommands.filter(command=>command.type==="cancel").length===1,"pending terminal must close and cancel immediately");
      receiveTerminal({...owner,uiId:terminalRequest.uiId,type:"open",title:terminalRequest.title});await wait();
      check(!pendingTerminal.open && !pendingTerminal.querySelector(".xterm"),"a late terminal-open event must not reopen or initialize a cancelled shell");
      const nextRequest={...terminalRequest,uiId:"ready"};flushSync(()=>useStore.setState({pendingUI:[nextRequest]}));await until(()=>document.querySelector('.terminal-dialog[open]'),"second terminal shell did not open");
      const readyTerminal=document.querySelector(".terminal-dialog");receiveTerminal({...owner,uiId:nextRequest.uiId,type:"open",title:nextRequest.title});
      await until(()=>terminalCommands.some(command=>command.uiId==="ready" && command.type==="ready"),"real terminal did not complete its fitted-ready handshake");
      check(document.querySelector(".terminal-dialog")===readyTerminal && document.querySelector("main").getBoundingClientRect().width===mainWidth,"host open must fill the existing terminal without remounting its shell or resizing main");
      await click(readyTerminal.querySelector("header button"));flushSync(()=>useStore.setState({pendingUI:[],terminals:{}}));await render(<div/>);
      check(terminalCommands.filter(command=>command.uiId==="ready" && command.type==="cancel").length===1,"closing and unmounting must not cancel a terminal twice");
      metrics.stablePendingUI=true;
      const fontFamilies=["Agency FB","Algerian","Arial","Arial Rounded MT","Bahnschrift","Baskerville Old Face","Cascadia Code","Consolas","游ゴシック",...Array.from({length:50},(_,i)=>"Example font "+i)];
      function FontFixture(){
        const [family,setFamily]=useState("");
        return <div className="app-shell" style={{"--window-opacity":0.35}}><main className="content-page settings-page"><div className="content-page-shell"><header className="content-page-header"><h1>Settings</h1></header><div className="settings-layout"><nav className="settings-nav"><button aria-current="page">Appearance</button></nav><section className="settings-content"><h2>Appearance</h2><div className="settings-card font-settings">{[["Interface font",family,setFamily],["Code font","",()=>{}]].map(([label,value,onChange])=><div className="settings-row" key={label}><div className="settings-label">{label}</div><FontPicker label={label} value={value} fonts={fontFamilies} onChange={onChange}/></div>)}</div><div className="settings-card" style={{marginTop:20,padding:20}}><h2>Chat renderers</h2><p>Changes only affect chat display.</p><button>Reload chat renderers</button></div></section></div></div></main></div>;
      }
      await render(<FontFixture/>);
      const fontPicker=document.querySelector(".font-picker");
      await click(fontPicker.querySelector("summary"));
      const fontPanel=fontPicker.querySelector(".font-picker-panel"),fontInput=fontPicker.querySelector("input"),fontList=fontPicker.querySelector('[role="listbox"]');
      const panelStyle=getComputedStyle(fontPanel),panelRect=fontPanel.getBoundingClientRect();
      check(panelRect.height>200,"font menu must have its own full-height background, independent of stylesheet import order");
      const popupReference=document.createElement("div");popupReference.className="picker-panel model-panel";popupReference.hidden=true;fontPicker.append(popupReference);
      const popupStyle=getComputedStyle(popupReference);
      check(panelStyle.backgroundColor===popupStyle.backgroundColor && panelStyle.backdropFilter===popupStyle.backdropFilter && panelStyle.backdropFilter!=="none","font menu must use the same translucent background and blur as other popups");
      popupReference.remove();
      check(document.activeElement===fontInput,"opening a font menu must focus search");
      check(parseFloat(getComputedStyle(fontPicker).width)>=240,"font trigger must not collapse to the selected label width");
      const optionButtons=[...fontList.querySelectorAll("button")];
      check(optionButtons.every(option=>getComputedStyle(option).fontFamily===getComputedStyle(optionButtons[0]).fontFamily),"font names must use a consistent readable typeface, including decorative fonts");
      check(optionButtons.every(option=>option.getBoundingClientRect().height===optionButtons[0].getBoundingClientRect().height),"font rows must have consistent heights");
      const secondTrigger=document.querySelectorAll(".font-picker > summary")[1].getBoundingClientRect();
      check(fontPanel.contains(document.elementFromPoint(secondTrigger.left+20,secondTrigger.top+secondTrigger.height/2)),"the next font control must not paint through the open menu");
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(fontInput,"cAsCaDiA");fontInput.dispatchEvent(new Event("input",{bubbles:true}));await wait();
      check(fontList.children.length===1 && fontList.textContent==="Cascadia Code","font search must filter without case sensitivity");
      fontInput.dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",bubbles:true}));await wait();
      check(!fontPicker.open && fontPicker.querySelector("summary").textContent==="Cascadia Code","keyboard selection must update the value and close the menu");
      await click(fontPicker.querySelector("summary"));
      fontInput.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}));await wait();
      check(!fontPicker.open && document.activeElement===fontPicker.querySelector("summary"),"Escape must close font search and restore trigger focus");
      document.querySelector(".app-shell").style.width="420px";await wait();
      await click(fontPicker.querySelector("summary"));
      const narrowPanel=fontPanel.getBoundingClientRect();
      check(narrowPanel.left>=0 && narrowPanel.right<=420 && narrowPanel.height>200,"font menu must fit the narrow settings page");
      metrics.fontPicker={height:panelRect.height,background:panelStyle.backgroundColor,search:true,keyboard:true,narrowWidth:narrowPanel.width};
      flushSync(()=>useStore.setState(state=>({settings:{...state.settings,fontFamily:"Arial",codeFontFamily:"Consolas"}})));
      for(const outcome of ["ready","error"]){
        let finish;
        window.__requests={...window.__requests,listFontFamilies:()=>new Promise((resolve,reject)=>{finish=()=>outcome==="ready"?resolve(fontFamilies):reject(new Error("Font discovery fixture failure"));})};
        await render(<div className="app-shell"><main className="content-page settings-page"><div className="content-page-shell"><FontSettings key={outcome}/><p id="after-font-settings">Next setting</p></div></main></div>);
        const card=document.querySelector(".font-settings"),after=document.getElementById("after-font-settings");
        const height=card.getBoundingClientRect().height,afterTop=after.getBoundingClientRect().top;
        const labels=[...card.querySelectorAll("summary")].map(element=>element.textContent).join("|");
        check(card.querySelectorAll(".settings-row").length===2 && !card.textContent.includes("Loading"),"pending font discovery must show only the two stable settings rows");
        check(labels==="Arial|Consolas","font discovery must not replace the saved selection with a loading label");
        finish();await wait();
        check(card.getBoundingClientRect().height===height && after.getBoundingClientRect().top===afterTop,"font discovery "+outcome+" must not shift settings layout");
        check([...card.querySelectorAll("summary")].map(element=>element.textContent).join("|")===labels,"font discovery "+outcome+" must retain saved font labels");
      }
      metrics.fontPicker.stableLoading=true;
      await render(<FontFixture/>);await click(document.querySelector(".font-picker summary"));
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
          export const sends={subscribe:()=>noop,getTick:()=>0,read:()=>undefined,optimistic:()=>[],queued:()=>[],retained:()=>[],send:async(_address,_content,_attachments,delivery)=>{window.__sendCount=(window.__sendCount??0)+1;window.__sendModes?.push(delivery);}};
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
      // Settings is imported by App before main.tsx imports the global stylesheet.
      const settingsCss = fileURLToPath(
        new URL("./settings.css", import.meta.url),
      );
      await Bun.write(
        cssEntry,
        [settingsCss, ...[...cssFiles].filter((path) => path !== settingsCss)]
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
          await fetch(
            `http://127.0.0.1:${port}/json/new?${encodeURIComponent(pathToFileURL(html).href)}`,
            { method: "PUT" },
          )
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
        type Report = { ok: boolean; metrics: { wheels: unknown[] } };
        type Evaluation = {
          result: {
            value: { wheel?: Record<string, unknown>; report?: Report };
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
                "({wheel:window.__transcriptWheel,report:window.__transcriptReport})",
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
        expect(report.ok, JSON.stringify(report)).toBe(true);
        expect(report.metrics.wheels.length).toBeGreaterThanOrEqual(10);
        expect(
          (report.metrics as { stablePendingUI?: boolean }).stablePendingUI,
        ).toBe(true);
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
