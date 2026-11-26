import { test } from "bun:test";
import { existsSync } from "node:fs";
import {
  fixtureEdge,
  fixtureHelpers,
  fixtureImport,
  runUiFixture,
} from "../../scripts/ui-fixture";

test.skipIf(!existsSync(fixtureEdge) && !process.env.PIG_REQUIRE_UI_TESTS)(
  "suspension in Edge retains transcript DOM, ranges, scroll and composer through a cold epoch",
  () =>
    runUiFixture(
      "runtime-suspension",
      `
    const {createRoot}=await import(${fixtureImport(import.meta.resolve("react-dom/client"))});
    const {flushSync}=await import(${fixtureImport(import.meta.resolve("react-dom"))});
    const {fauxAssistantMessage}=await import(${fixtureImport(import.meta.resolve("@earendil-works/pi-ai"))});
    const {App}=await import(${fixtureImport(new URL("./App.tsx", import.meta.url))});
    const {useStore}=await import(${fixtureImport(new URL("./store.ts", import.meta.url))});
    const {drafts,emptyContent}=await import(${fixtureImport(new URL("./draft-store.ts", import.meta.url))});
    const {receiveExtension,receiveRuntime,receiveSnapshot}=await import(${fixtureImport(new URL("./runtime-events.ts", import.meta.url))});
    await import(${fixtureImport(new URL("./styles.css", import.meta.url))});
    ${fixtureHelpers}
    const root=createFixtureRoot(createRoot),address={hostId:"suspension-ui",sessionId:"chat",epoch:1};
    let wakes=0;
    window.__requests={
      listSlashCommands:async()=>[],
      syncDraft:async input=>({applied:true,draft:{...input.content,revision:input.expectedRevision+1}}),
      wakeSession:async()=>{wakes++;throw Error("viewing must not start the SDK");},
    };
    const records=Array.from({length:80},(_,i)=>({
      id:"q-"+i,entryId:"q-"+i,parentId:i?"q-"+(i-1):null,branchId:"leaf",order:i,kind:"message",
      message:{role:"user",content:"Earlier question "+i+" ".repeat(2)+"history ".repeat(12),timestamp:i},
    }));
    records.push({id:"answer",entryId:"answer",parentId:"q-79",branchId:"leaf",order:80,kind:"message",
      message:fauxAssistantMessage("A retained response with **formatting** and $x^2$.")});
    const snapshot={address,snapshotSeq:1,info:{id:"chat",cwd:"fixture",title:"Saved chat",modified:1},
      effort:"off",effortLevels:[],transcript:{history:{revision:"history"},records,tools:{},current:null,running:false,liveToEntry:{}}};
    flushSync(()=>useStore.setState(s=>({
      initialized:true,page:"chat",active:"chat",activePane:1,panes:{1:{sessionId:"chat"}},
      paneTree:{type:"pane",id:1},snapshots:{chat:snapshot},addresses:{chat:address},sessions:{},
      bootstrap:{...s.bootstrap,generalCwd:"fixture"},settings:{...s.settings,language:"en"},
    })));
    flushSync(()=>root.render(<App/>));
    await until(()=>document.querySelector(".prose p")&&document.querySelector(".composer textarea"),"chat must render");
    await document.fonts.ready;
    const paragraph=document.querySelector(".prose p"),range=document.createRange();
    range.selectNodeContents(paragraph);const selected=range.toString(),start=range.startContainer;
    const thread=document.querySelector(".thread-scroll");thread.scrollTop=240;await wait();
    const top=thread.scrollTop,height=thread.clientHeight;
    flushSync(()=>drafts.edit(address,()=>({...emptyContent(),text:"local editor input"})));await wait();
    const editor=document.querySelector(".composer textarea");
    editor.focus();editor.setSelectionRange(2,8);
    editor.dispatchEvent(new CompositionEvent("compositionstart",{bubbles:true,data:""}));
    const next={...address,epoch:2};
    const revision=drafts.read(address).revision+1;
    receiveExtension({type:"draft",address:next,draft:{...emptyContent(),revision}});
    flushSync(()=>receiveRuntime({type:"suspended",previous:address,address:next,snapshotSeq:2,historyRevision:"history",draftRevision:revision}));
    await wait();
    check(document.querySelector(".prose p")===paragraph&&range.startContainer===start&&range.toString()===selected,"suspension must retain formatted DOM and annotation ranges");
    check(document.querySelector(".composer textarea")===editor&&editor.value==="local editor input","late local input and its editor must survive the transfer");
    check(editor.selectionStart===2&&editor.selectionEnd===8,"suspension must not reset the editor selection");
    check(thread.scrollTop===top&&thread.clientHeight===height,"suspension must not move or resize the conversation");
    check(drafts.read(next).content.text==="local editor input"&&wakes===0,"cold history and draft edits must not wake the SDK");
    check(drafts.read(next).revision>=revision,"draft must follow the new owner's revision");
    editor.dispatchEvent(new CompositionEvent("compositionend",{bubbles:true,data:""}));
    // Cold reads and a later ready publication keep explicitly loaded older rows.
    const tail={...snapshot,address:next,snapshotSeq:3,suspended:true,
      transcript:{...snapshot.transcript,records:records.slice(-10),history:{revision:"history",before:"q-71"}}};
    flushSync(()=>receiveSnapshot(tail));await wait();
    check(useStore.getState().snapshots.chat.transcript.records.length===81,"cold reads must retain loaded history");
    flushSync(()=>receiveRuntime({type:"ready",snapshot:{...tail,suspended:undefined,snapshotSeq:4}}));await wait();
    check(document.querySelector(".prose p")===paragraph&&range.toString()===selected&&thread.scrollTop===top,"SDK readiness must not rebuild the conversation");
    check(wakes===0,"publications must not retransmit or wake");
    root.unmount();
  `,
      { realRpc: true },
    ),
  60_000,
);
