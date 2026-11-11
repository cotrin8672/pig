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
    try {
      const source = (name: string) =>
        JSON.stringify(fileURLToPath(new URL(name, import.meta.url)));
      const entry = join(dir, "fixture.tsx");
      await Bun.write(
        entry,
        `
      import {createRoot} from ${JSON.stringify(fileURLToPath(import.meta.resolve("react-dom/client")))};
      import {flushSync} from ${JSON.stringify(fileURLToPath(import.meta.resolve("react-dom")))};
      import {Chat} from ${source("./App.tsx")};
      import {ToolBlock,ToolGroup,ThinkingBlock} from ${source("./ToolBlock.tsx")};
      import {DisclosureScope} from ${source("./LazyDetails.tsx")};
      import {Markdown,BuiltinMarkdown} from ${source("./MessageContent.tsx")};
      import {installChatRenderers} from ${source("./chat-renderer-registry.ts")};
      import {useStore} from ${source("./store.ts")};
      const root=createRoot(document.getElementById("root"));
      const wait=()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
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
      check(!visible(document.querySelector(".tool-diff")),"closed diff must stay visually collapsed");
      await click(document.querySelector("summary"));
      metrics.diffSpans=document.querySelectorAll(".tool-diff span").length;
      check(metrics.diffSpans===10000 && visible(document.querySelector(".tool-diff")) && !document.querySelector(".text-range"),"expanded diff must show every line in the original scrollable preview");
      check(getComputedStyle(document.querySelector(".tool-diff")).maxHeight==="240px","diff preview must keep its original height limit");
      await wheel(document.querySelector(".tool-diff"),320);
      await click(document.querySelector("summary"));check(!visible(document.querySelector(".tool-diff")),"closing must hide the diff");
      await click(document.querySelector("summary"));await render(<div/>);await render(edit);
      check(visible(document.querySelector(".tool-diff")),"tool expansion must survive navigation");
      await render(<ThinkingBlock text="# actual thinking" label="Thinking" active={false}/>);
      check(!visible(document.querySelector("h1")),"closed thinking must stay visually collapsed");
      await click(document.querySelector("summary"));check(visible(document.querySelector("h1")),"thinking must open with formatted content");
      const output=Array.from({length:600},(_,i)=>"line "+i+" "+"original output ".repeat(4)+"end").join("\\n");
      await render(<ToolBlock call={{id:"shell",name:"bash",arguments:{command:"echo fixture"}}} state={{status:"done",result:{content:[{type:"text",text:output}]}}} live={false}/>);
      const peek=document.querySelector(".tool-peek");
      check(peek?.tagName==="PRE" && peek.parentElement.matches("details.tool-term") && peek.textContent===output.split("\\n").slice(-2).join("\\n"),"shell preview must keep the original separate two-line preformatted block");
      check(document.querySelector(".tool-badge").textContent==="exit 0","completed shell must retain its exit badge");
      await click(document.querySelector("summary"));
      const shell=document.querySelector(".tool-term-output");
      check(shell.textContent===output && visible(shell) && !visible(peek) && getComputedStyle(shell).maxHeight==="280px" && !document.querySelector(".text-range"),"expanded shell must retain the complete output in its original preview");
      await wheel(shell,240);
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
        await wheel(focused.querySelector(grouped?".tool-body pre":".tool-term-output"),120);
        check(Math.abs(readingThread.scrollTop-top)<=2,"wheel over a scrollable tool preview must scroll the preview alone");
      }
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
          const noop=()=>{};export const rpc={request:new Proxy({},{get:(_,method)=>async params=>method==="getSessionHistory"?window.__getSessionHistory(params):{}}),send:new Proxy({},{get:()=>noop})};
          export const sends={subscribe:()=>noop,read:()=>undefined};
          export const updateAppearance=noop,updateSettings=noop,updateUiPreferences=noop,refreshSessions=noop,refresh=noop,connectRuntime=noop,initRuntimeConnection=noop,cancelOpening=noop,openChat=noop,openChatLink=noop,forkChat=noop,regenerate=noop,initSessionLinks=noop,initSessionReadTracking=noop,reconnectRuntime=noop;
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
        `void (async()=>{try{${script}}catch(error){window.__transcriptReport={ok:false,error:String(error),stack:error.stack,metrics:window.__transcriptMetrics};}})()`,
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
        while (!report) {
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
        expect(report.ok, JSON.stringify(report)).toBe(true);
        expect(report.metrics.wheels.length).toBeGreaterThanOrEqual(10);
        console.info(
          "Native transcript Edge regression",
          JSON.stringify(report.metrics),
        );
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
      await rm(dir, {
        recursive: true,
        force: true,
        maxRetries: 10,
        retryDelay: 100,
      });
    }
  },
  60_000,
);
