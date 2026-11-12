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
  "transcript in Edge: native wheel scrolling, original appearance, history, attachments and streaming",
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
      import {Chat} from ${source("./App.tsx")};
      import {Composer} from ${source("./Composer.tsx")};
      import {OpeningComposer} from ${source("./ChatOpening.tsx")};
      import {MessageQueue} from ${source("./MessageQueue.tsx")};
      import {AnnotationPopover} from ${source("./AnnotationPopover.tsx")};
      import {AnnotationDrafts} from ${source("./AnnotationCards.tsx")};
      import {rememberAnnotationRange} from ${source("./annotation-highlights.ts")};
      import {drafts} from ${source("./draft-store.ts")};
      import {addressKey} from ${source("./chat-snapshot.ts")};
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
      check(!document.querySelector(".transcript-search") && !document.querySelector('input[type="search"]'),"loaded-message search must not appear in a conversation");
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
      check(getComputedStyle(document.querySelector(".tool-diff")).maxHeight==="240px","diff preview must keep its original height limit");
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
      await render(<ThinkingBlock text="# actual thinking" label="Thinking" active={false}/>);
      check(document.querySelector("details").open && visible(document.querySelector("h1")),"thinking must start expanded with formatted content");
      await click(document.querySelector("summary"));
      check(!visible(document.querySelector("h1")),"thinking must still close manually");
      const output=Array.from({length:600},(_,i)=>"line "+i+" "+"original output ".repeat(4)+"end").join("\\n");
      await render(<ToolBlock call={{id:"shell",name:"bash",arguments:{command:"echo fixture"}}} state={{status:"done",result:{content:[{type:"text",text:output}]}}} live={false}/>);
      const peek=document.querySelector(".tool-peek");
      check(peek?.tagName==="PRE" && peek.parentElement.matches("details.tool-term") && peek.textContent===output.split("\\n").slice(-2).join("\\n"),"shell preview must keep the original separate two-line preformatted block");
      check(document.querySelector(".tool-badge.done").textContent==="exit 0","completed shell must retain its v0.2 exit badge");
      check(document.querySelector(".tool-term").open,"bash must start expanded");
      const shell=document.querySelector(".tool-term-output");
      check(shell.textContent===output && visible(shell) && !visible(peek) && getComputedStyle(shell).maxHeight==="280px" && !document.querySelector(".text-range"),"expanded shell must retain the complete output in its original preview");
      await wheel(shell,240);
      const shellTop=shell.scrollTop;
      await click(document.querySelector(".tool-term > summary"));
      check(!document.querySelector(".tool-term-output") && document.querySelector(".tool-peek"),"closing a shell must release its complete body, retaining the small preview");
      await click(document.querySelector(".tool-term > summary"));
      check(document.querySelector(".tool-term-output").textContent===output,"reopening a shell must restore its complete output");
      check(document.querySelector(".tool-term-output").scrollTop===shellTop,"reopening a shell must restore its internal scroll position");
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
      for(const selector of [".thinking > summary",".thinking.active",".tool-verb",".tool-badge",".tool-prompt",".tool-group > summary .tool-target",".response-footer strong",".response-footer time","article > button"]){
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
