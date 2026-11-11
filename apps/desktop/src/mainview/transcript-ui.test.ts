import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const edge = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";

test.skipIf(!existsSync(edge))(
  "transcript in Edge: real toggles, large pages, search, anchors and final Markdown",
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
      import {captureThreadAnchor,threadView} from ${source("./thread-scroll.ts")};
      import {useStore} from ${source("./store.ts")};
      const root=createRoot(document.getElementById("root"));
      const wait=()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
      const check=(value,message)=>{if(!value) throw new Error(message);};
      const render=async node=>{flushSync(()=>root.render(node));await wait();};
      const metrics={};
      let copied="";
      Object.defineProperty(navigator,"clipboard",{value:{writeText:async text=>{copied=text;}}});
      const click=async element=>{check(element,"missing click target");element.click();await wait();};
      const button=(parent,text)=>[...parent.querySelectorAll("button")].find(b=>b.textContent===text);
      const values={};
      const diff=Array.from({length:10000},(_,i)=>"+"+i+" changed").join("\\n");
      const edit=<DisclosureScope id="edit" values={values}><ToolBlock call={{id:"edit",name:"edit",arguments:{path:"file.ts"}}} state={{status:"done",result:{details:{diff}}}} live={false}/></DisclosureScope>;
      await render(edit);
      check(!document.querySelector(".tool-diff"),"closed diff must not mount body");
      await click(document.querySelector("summary"));
      metrics.diffSpans=document.querySelectorAll(".tool-diff span").length;
      check(metrics.diffSpans>0 && metrics.diffSpans<=201,"expanded diff must be bounded");
      await click(button(document,"Copy full text"));check(copied===diff,"copy must contain all 10000 lines");
      await click(document.querySelector("summary"));check(!document.querySelector(".tool-diff"),"close must release body");
      await click(document.querySelector("summary"));
      await render(<div/>);await render(edit);
      check(document.querySelector(".tool-diff"),"tool expansion must survive navigation");
      await render(<ThinkingBlock text="# actual thinking" label="Thinking" active={false}/>);
      check(!document.querySelector("h1"),"closed thinking must not parse Markdown");
      await click(document.querySelector("summary"));check(document.querySelector("h1"),"thinking must open with formatted content");
      const calls=Array.from({length:500},(_,i)=>({id:"call"+i,name:"read",arguments:{path:"file"+i}}));
      await render(<ToolGroup calls={calls} tools={{}} live={false}/>);
      check(!document.querySelector(".tool-group-body"),"closed 500-call group must not mount tools");
      await click(document.querySelector("summary"));
      metrics.groupCalls=document.querySelectorAll(".tool-group-body details").length;
      check(metrics.groupCalls===100,"500-call group must page at 100");
      await click(button(document,"Next"));check(document.body.textContent.includes("file100"),"next group page must remain accessible");
      await render(<ToolGroup calls={calls.slice(0,2)} tools={{}} live={false}/>);
      check(document.querySelectorAll(".tool-group-body details").length===2 && document.body.textContent.includes("file0"),"a reconciled shorter group must restore the complete first page");
      let parses=0;
      installChatRenderers([{id:"counter",kind:"markdown",component:({DefaultRenderer})=>{parses++;return <DefaultRenderer/>;}}]);
      await render(<Markdown text={"start"} streaming/>);
      const before=parses;
      for(let i=0;i<100;i++) flushSync(()=>root.render(<Markdown text={"# token "+i} streaming/>));
      check(parses===before,"streaming updates must not reparse unchanged sample");
      await new Promise(resolve=>setTimeout(resolve,130));
      check(parses<=before+1,"one interval must publish at most one sample");
      const final=["| A | B |","| - | - |","| 1 | 2 |","","[go][ref]","","[ref]: https://example.com","","\u0060\u0060\u0060ts","const x=1","\u0060\u0060\u0060","","$x^2$"].join("\\n");
      await render(<Markdown text={final}/>);
      const complete=document.getElementById("root").innerHTML;
      const comparison=document.createElement("div");document.body.append(comparison);
      const other=createRoot(comparison);flushSync(()=>other.render(<BuiltinMarkdown data={{text:final}} DefaultRenderer={()=>null}/>));
      check(complete===comparison.innerHTML,"final Markdown must equal the complete ordinary parser");
      await new Promise(resolve=>setTimeout(resolve,130));check(document.getElementById("root").innerHTML===complete,"old sample must not overwrite final Markdown");
      metrics.streamParses=parses-before;other.unmount();comparison.remove();installChatRenderers([]);
      await render(<Markdown text={"# Large\\n\\n"+"x".repeat(132000)}/>);
      check(!document.querySelector("h1") && document.querySelector("pre").textContent.length<=16384,"huge message must start in explicit source ranges");
      await click(button(document,"Render full Markdown"));check(document.querySelector("h1")?.textContent==="Large","full Markdown must remain available");
      const base={address:{hostId:"ui",sessionId:"chat",epoch:1},snapshotSeq:1,info:{id:"chat",cwd:"fixture",title:"Fixture",modified:1},effort:"off",effortLevels:[],ready:false};
      const record=(id,order,message)=>({id,parentId:null,branchId:"branch",order,kind:"message",message});
      const transcript=records=>({records,tools:{},history:{revision:"branch"},current:null,running:false,liveToEntry:{}});
      const user=i=>record("r"+i,i,{role:"user",content:"Question "+i+" "+(i===5?"needle-search ":"")+"wrapping words ".repeat(20),timestamp:i});
      const assistant=(id,order,content)=>record(id,order,{role:"assistant",content,api:"openai-responses",provider:"fixture",model:"fixture",usage:{input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}},stopReason:"stop",timestamp:order});
      const show=async snapshot=>{useStore.setState({snapshots:{[snapshot.info.id]:snapshot},settings:{...useStore.getState().settings,language:"en"}});await render(<Chat key={snapshot.address.epoch} snapshot={snapshot}/>);};
      metrics.loaded=[];
      let snapshot;
      for(const count of [50,1000,10000]){
        snapshot={...base,transcript:transcript(Array.from({length:count},(_,i)=>user(i)))};
        const started=performance.now();await show(snapshot);
        const mounted=document.querySelectorAll("[data-record-id]").length;
        check(mounted===Math.min(count,100),"loaded records must mount at most 100");
        metrics.loaded.push({count,mounted,dom:document.querySelectorAll("*").length,ms:performance.now()-started});
      }
      const selected=document.querySelector('[data-record-id="r9999"] .user-bubble');
      selected.dispatchEvent(new PointerEvent("pointerdown",{bubbles:true}));await wait();
      const selection=window.getSelection();const selectionRange=document.createRange();selectionRange.selectNodeContents(selected);selection.removeAllRanges();selection.addRange(selectionRange);
      check(!threadView("ui","chat").follow,"interacting with a record must stop following and pin its range");
      snapshot={...snapshot,transcript:{...snapshot.transcript,records:[...snapshot.transcript.records,user(10000)]}};await show(snapshot);
      check(selected.isConnected && selection.toString().includes("Question 9999"),"appending must preserve selected content and its DOM");selection.removeAllRanges();
      async function search(query){
        const details=document.querySelector(".transcript-search");if(!details.open) await click(details.querySelector("summary"));
        const input=details.querySelector("input");Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(input,query);input.dispatchEvent(new Event("input",{bubbles:true}));await wait();await click(details.querySelector("button"));
      }
      await search("needle-search");
      check(document.activeElement.dataset.recordId==="r5","search must reveal, mount and focus unloaded presentation range");
      check(!threadView("ui","chat").follow,"search must stop following");
      let thread=document.querySelector(".thread-scroll");
      thread.dispatchEvent(new WheelEvent("wheel",{deltaY:-40,bubbles:true}));thread.scrollTop+=80;thread.dispatchEvent(new Event("scroll"));await wait();
      const anchor=captureThreadAnchor(thread);
      await render(<div/>);snapshot={...snapshot,address:{...base.address,epoch:2}};await show(snapshot);
      thread=document.querySelector(".thread-scroll");const restored=captureThreadAnchor(thread);
      metrics.navigationDrift=Math.abs(restored.offset-anchor.offset);
      check(restored.id===anchor.id && metrics.navigationDrift<=2,"navigation must restore the same record and offset across epochs");
      const first=thread.querySelector("[data-record-id]");const spacer=document.createElement("div");spacer.style.height="128px";first.prepend(spacer);await wait();
      const delayed=captureThreadAnchor(thread);metrics.delayedDrift=Math.abs(delayed.offset-restored.offset);
      check(delayed.id===restored.id && metrics.delayedDrift<=2,"late height changes must preserve the reader anchor "+JSON.stringify({restored,delayed,view:threadView("ui","chat")}));
      thread.style.width="360px";await wait();
      const resized=captureThreadAnchor(thread);metrics.resizeDrift=Math.abs(resized.offset-restored.offset);
      check(resized.id===restored.id && metrics.resizeDrift<=2,"width changes must preserve the reader anchor");
      snapshot={...snapshot,transcript:{...snapshot.transcript,records:[...snapshot.transcript.records,...Array.from({length:50},(_,i)=>user(10001+i))],running:true}};await show(snapshot);
      check(document.querySelector('[data-record-id="r5"]'),"background append must not evict the reader's range");
      snapshot={...snapshot,transcript:transcript(Array.from({length:200},(_,i)=>user(20000+i)))};await show(snapshot);
      const pinned=threadView("ui","chat").start;
      snapshot={...snapshot,transcript:{...snapshot.transcript,records:[...snapshot.transcript.records,user(20200)]}};await show(snapshot);
      check(threadView("ui","chat").start===pinned,"rewind fallback must become a stable reading range");
      const workRecords=[user(0)];const tools={};
      for(let i=0;i<500;i++) {const call={id:"t"+i,name:"bash",arguments:{command:"echo "+i}};workRecords.push(assistant("a"+i,1+2*i,[{type:"toolCall",...call}]));workRecords.push(record("result"+i,2+2*i,{role:"toolResult",toolCallId:call.id,toolName:"bash",content:[{type:"text",text:"Tool-marker-"+i+"-end"}],isError:false,timestamp:i}));tools[call.id]={status:"done",result:{content:[{type:"text",text:"Tool-marker-"+i+"-end"}]}};}
      workRecords.push(assistant("final",1001,[{type:"text",text:"Final answer"}]));
      snapshot={...base,address:{...base.address,sessionId:"work"},info:{...base.info,id:"work"},transcript:{...transcript(workRecords),tools}};
      await render(<div/>);await show(snapshot);
      check(document.querySelector(".work-toggle"),"work toggle must exist when page starts with a tool result inside a 500-step response");
      await click(document.querySelector(".work-toggle"));check(document.querySelectorAll(".tool-term").length>0,"cross-page work must open");
      await search("Tool-marker-150-end");
      check(document.activeElement.closest("[data-record-id]")?.dataset.recordId==="a150","tool-result search must jump to the owning call across pages");
      check(document.activeElement.closest("[data-tool-call-id]")?.dataset.toolCallId==="t150" && document.activeElement.tagName==="SUMMARY","search must focus the targeted tool summary");
      await render(<div/>);await show(snapshot);check(document.querySelector('[data-record-id="a150"] details[open]'),"work and tool expansion must survive navigation");
      for(const grouped of [true,false]) {
        const nestedCalls=Array.from({length:500},(_,i)=>({id:"nested"+i,name:grouped?"read":"bash",arguments:grouped?{path:"file"+i}:{command:"echo "+i}}));
        const nestedTools={};
        const nestedResults=nestedCalls.map((call,i)=>{const text=i===450?"Single-marker-450-end\\n"+diff:"small result "+i;nestedTools[call.id]={status:"done",result:{content:[{type:"text",text}]}};return record("nested-result"+i,2+i,{role:"toolResult",toolCallId:call.id,toolName:call.name,content:[{type:"text",text}],isError:false,timestamp:i});});
        const singleId=grouped?"single-grouped":"single-ungrouped";
        snapshot={...base,address:{...base.address,sessionId:singleId},info:{...base.info,id:singleId},transcript:{...transcript([user(0),assistant("single",1,nestedCalls.map(call=>({type:"toolCall",...call}))),...nestedResults,assistant("single-final",502,[{type:"text",text:"Nested final"}])]),tools:nestedTools}};
        await render(<div/>);await show(snapshot);await search("Single-marker-450-end");
        const focused=document.activeElement.closest("[data-tool-call-id]");
        check(focused?.dataset.toolCallId==="nested450" && document.activeElement.tagName==="SUMMARY","nested result 450 must select its page and retain native summary focus");
        check(document.querySelectorAll("[data-tool-call-id]").length===100,"nested result search must mount only its 100-call page");
        check(document.querySelectorAll(grouped?".tool-body":".tool-term-output").length===1,"one nested search must mount only the targeted tool body");
        await click(button(focused,"Next"));
        const savedRange=focused.querySelector(".text-range [role=status]").textContent;
        await render(<div/>);await show(snapshot);
        const restoredTool=document.querySelector('[data-tool-call-id="nested450"]');
        check(restoredTool?.querySelector(".text-range [role=status]")?.textContent===savedRange,"nested tool page and text range must survive navigation");
        if(grouped) {
          await click(button(document.querySelector(".tool-group-body"),"Previous"));
          await search("Single-marker-450-end");
          check(document.activeElement.closest("[data-tool-call-id]")?.dataset.toolCallId==="nested450","reselecting a result must restore its nested page before focus");
        }
      }
      await render(<div/>);document.body.replaceChildren();const result=document.createElement("output");result.id="result";result.textContent=JSON.stringify({ok:true,metrics});document.body.append(result);
    `,
      );
      const built = await Bun.build({
        entrypoints: [entry],
        target: "browser",
        minify: true,
        define: { "process.env.NODE_ENV": '"production"' },
        loader: { ".css": "text", ".svg": "text" },
        plugins: [
          {
            name: "isolated-host",
            setup(build) {
              build.onResolve({ filter: /^react\/jsx-runtime$/ }, () => ({
                path: fileURLToPath(import.meta.resolve("react/jsx-runtime")),
              }));
              build.onLoad({ filter: /[\\/]rpc\.ts$/ }, () => ({
                loader: "ts",
                contents: `
          const noop=()=>{};export const rpc={request:new Proxy({},{get:()=>async()=>({})}),send:new Proxy({},{get:()=>noop})};
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
        `window.__transcriptDone=(async()=>{try{${script};return JSON.parse(document.getElementById('result').textContent);}catch(error){return {ok:false,error:String(error),stack:error.stack};}})()`,
      );
      const html = join(dir, "index.html");
      await Bun.write(
        html,
        '<!doctype html><meta charset="utf-8"><style>.session-layout,.chat-shell{height:600px}.thread-scroll{height:400px;overflow:auto;overflow-anchor:none;width:600px}.response-turn{padding:8px}.message{margin-bottom:16px}</style><div id="root"></div><script src="fixture.js"></script>',
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
          "about:blank",
        ],
        { stdout: "pipe", stderr: "pipe" },
      );
      const timeout = setTimeout(() => child.kill(), 25_000);
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
        const result = await new Promise<{
          result: { value: { ok: boolean; metrics: unknown } };
          exceptionDetails?: unknown;
        }>((resolve, reject) => {
          connected.addEventListener("message", (event) => {
            const reply = JSON.parse(String(event.data));
            if (reply.id === 1) {
              // The new target can still be replacing its initial about:blank document.
              if (reply.error?.message === "Execution context was destroyed.")
                evaluate();
              else if (reply.error) reject(reply.error);
              else resolve(reply.result);
            }
          });
          connected.addEventListener(
            "close",
            () => reject(new Error("Fixture browser closed")),
            { once: true },
          );
          const evaluate = () =>
            connected.send(
              JSON.stringify({
                id: 1,
                method: "Runtime.evaluate",
                params: {
                  expression:
                    "(async()=>{while(!window.__transcriptDone) await new Promise(r=>setTimeout(r,10));return await window.__transcriptDone;})()",
                  awaitPromise: true,
                  returnByValue: true,
                },
              }),
            );
          evaluate();
        });
        expect(result.exceptionDetails, JSON.stringify(result)).toBeUndefined();
        const report = result.result.value;
        expect(report.ok, JSON.stringify(report)).toBe(true);
        console.info("F17–F20 Edge fixture", JSON.stringify(report.metrics));
      } finally {
        socket?.send(JSON.stringify({ id: 2, method: "Browser.close" }));
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
  40_000,
);
