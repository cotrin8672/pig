import { test } from "bun:test";
import { existsSync } from "node:fs";
import {
  fixtureEdge,
  fixtureHelpers,
  fixtureImport,
  runUiFixture,
} from "../../scripts/ui-fixture";
import { staticMcpApp } from "../bun/mcp-app-static";

const local = (path: string) => fixtureImport(new URL(path, import.meta.url));

test.skipIf(!existsSync(fixtureEdge) && !process.env.PIG_REQUIRE_UI_TESTS)(
  "MCP Apps: static preview beside the normal result, script-free, 8 lines, lazy and retryable",
  async () => {
    const html = await staticMcpApp(`<!doctype html><html><body>
      <svg width="80" height="32" viewBox="0 0 80 32"><rect width="80" height="32" fill="#e62850"/></svg>
      <h2>Static forecast</h2><pre>${"line\n".repeat(30)}</pre>
      <script>parent.postMessage({type:"mcp-script-ran"},"*")</script></body></html>`);
    await runUiFixture(
      "mcp-apps",
      `
      const {createRoot}=await import(${fixtureImport(import.meta.resolve("react-dom/client"))});
      const {flushSync}=await import(${fixtureImport(import.meta.resolve("react-dom"))});
      const {ToolBlock}=await import(${local("./ToolBlock.tsx")});
      const {McpAppScope}=await import(${local("./McpAppPreview.tsx")});
      const {widgetScriptPolicy}=await import(${local("./widget-frame.ts")});
      await import(${local("./styles.css")});
      ${fixtureHelpers}
      const root=createFixtureRoot(createRoot);
      let reads=0,ran=0,fail=false;
      addEventListener("message",e=>{if(e.data?.type==="mcp-script-ran")ran++});
      window.__requests={getMcpAppPreview:async input=>{
        check(input.appId&&input.toolCallId&&!("uri" in input),"only opaque references cross RPC");
        reads++;return fail?null:{html:${JSON.stringify(html)}};
      }};
      const address={hostId:"host",sessionId:"session",epoch:1};
      const ref={version:1,id:crypto.randomUUID(),title:"Forecast"};
      const state={status:"done",result:{content:[{type:"text",text:"Normal result retained"}],details:{mcpApp:ref}}};
      const call={id:"root",name:"mcp__fixture__forecast",arguments:{}};
      const render=(owner=address,width=736)=>flushSync(()=>root.render(
        <McpAppScope address={{...owner}}><div style={{width:width+"px"}}>
        <div id="spacer"/><ToolBlock call={call} state={state} live={false}/></div></McpAppScope>));
      // The fixture's file:// stylesheet is unreadable; the app's own sheet is same-origin.
      const readable=document.createElement("style");
      readable.textContent="*{--scrollbar-inset:4px}::-webkit-scrollbar-thumb{border-radius:9px}";
      document.head.append(readable);
      widgetScriptPolicy.requested=true;
      render();
      const frames=()=>[...document.querySelectorAll(".widget-frame iframe")];
      await until(()=>frames().length===1,"the visible preview loads");
      const frame=frames()[0];
      check(frame.getAttribute("sandbox")==="","MCP stays script-free even with the global script switch");
      check(frame.srcdoc.includes("script-src 'none'")&&!frame.srcdoc.includes("<script"),"strict static document");
      check(frame.srcdoc.includes("::-webkit-scrollbar-thumb")&&frame.srcdoc.includes("--scrollbar-inset"),"the frame reuses the app's scrollbar rules");
      document.querySelector(".tool-row > summary").click();
      await until(()=>document.body.textContent.includes("Normal result retained"),"the normal result stays accessible");
      await wait();
      const box=document.querySelector(".widget-frame.preview"),rect=box.getBoundingClientRect();
      const pixel=await capturePixels();
      const painted=pixel(rect.left+30,rect.top+16);
      check(Math.abs(painted[0]-230)<6&&Math.abs(painted[1]-40)<6&&Math.abs(painted[2]-80)<6,"static SVG paints");
      const style=getComputedStyle(box);
      check(Math.abs(rect.height-8*parseFloat(style.lineHeight)-parseFloat(style.getPropertyValue("--scrollbar-size")))<1,"eight lines plus scrollbar");
      // Snapshot updates with a new but equal address object keep the frame.
      render();await wait();
      check(frames()[0]===frame&&reads===1,"re-render keeps the frame without another read");
      render(address,280);await wait();
      check(box.getBoundingClientRect().width<=281,"no overflow in a narrow pane");
      document.getElementById("spacer").style.height="4000px";
      await until(()=>frames().length===0,"offscreen frames are released");
      document.getElementById("spacer").style.height="0px";
      await until(()=>frames().length===1,"returning preview remounts");
      check(reads===1,"returning reuses cached HTML");
      // A new epoch asks again; a failure offers retry without moving layout.
      fail=true;render({...address,epoch:2});
      await until(()=>document.querySelector(".widget-frame-note button"),"failure offers retry");
      const height=document.querySelector(".widget-frame").getBoundingClientRect().height;
      fail=false;document.querySelector(".widget-frame-note button").click();
      await until(()=>frames().length===1,"retry loads the preview");
      check(Math.abs(document.querySelector(".widget-frame").getBoundingClientRect().height-height)<1,"retry keeps the height");
      check(ran===0,"server scripts never ran");
      widgetScriptPolicy.requested=false;
      flushSync(()=>root.unmount());
    `,
      { viewport: { width: 900, height: 1100 } },
    );
  },
  150_000,
);
