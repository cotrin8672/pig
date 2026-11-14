import { test } from "bun:test";
import { existsSync } from "node:fs";
import {
  fixtureEdge,
  fixtureHelpers,
  fixtureImport,
  runUiFixture,
} from "../../scripts/ui-fixture";

test.skipIf(!existsSync(fixtureEdge) && !process.env.PIG_REQUIRE_UI_TESTS)(
  "work folding in Edge: streaming reuse, copy, history prepend, search and branch replacement",
  () =>
    runUiFixture(
      "work-folding",
      `
      const {createRoot}=await import(${fixtureImport(import.meta.resolve("react-dom/client"))});
      const {flushSync}=await import(${fixtureImport(import.meta.resolve("react-dom"))});
      const {Chat}=await import(${fixtureImport(new URL("./App.tsx", import.meta.url))});
      const {useStore}=await import(${fixtureImport(new URL("./store.ts", import.meta.url))});
      const {newerSnapshot,addressKey}=await import(${fixtureImport(new URL("./chat-snapshot.ts", import.meta.url))});
      await import(${fixtureImport(new URL("./styles.css", import.meta.url))});
      ${fixtureHelpers}
      const root=createFixtureRoot(createRoot),copied=[];
      Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>{copied.push(text)}}});
      const record=(id,order,message)=>({id,entryId:id,parentId:null,branchId:'branch',order,kind:'message',message});
      const user=(id,order)=>record(id,order,{role:'user',content:'Question '+id,timestamp:order});
      const assistant=(id,order,content)=>record(id,order,{role:'assistant',content,api:'openai-responses',provider:'fixture',model:'fixture-model',
        usage:{input:10,output:90,cacheRead:0,cacheWrite:0,totalTokens:100,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}},stopReason:'stop',timestamp:order,durationMs:500});
      const text=value=>({type:'text',text:value});
      const log=Array.from({length:40},(_,i)=>'Full output line '+i).join('\\n');
      const call={type:'toolCall',id:'tool',name:'bash',arguments:{command:'echo fixture'}};
      const live=assistant('live',8,[text('Live answer')]);delete live.entryId;
      let current={address:{hostId:'work',sessionId:'chat',epoch:1},snapshotSeq:1,
        info:{id:'chat',cwd:'fixture',title:'Work fixture',modified:1},effort:'off',effortLevels:[],
        transcript:{history:{revision:'branch',before:'u1'},records:[user('u1',3),assistant('step',4,[text('Checking file'),call]),
          record('result',5,{role:'toolResult',toolCallId:'tool',toolName:'bash',content:[text(log)],isError:false,timestamp:5}),
          assistant('final',6,[text('Final answer')]),user('u2',7),live],
          tools:{tool:{status:'done',result:{content:[text(log)]}}},running:true,current:'live',liveToEntry:{}}};
      let replyHistory;
      const historyGate=new Promise(resolve=>{replyHistory=resolve;});
      window.__requests={listSlashCommands:async()=>[],getSessionHistory:async()=>historyGate};
      flushSync(()=>useStore.setState(s=>({snapshots:{chat:current},settings:{...s.settings,language:'en'}})));
      function StoredChat(){const snapshot=useStore(s=>s.snapshots.chat);return <Chat key={addressKey(snapshot.address)} snapshot={snapshot}/>;}
      flushSync(()=>root.render(<div className="chat-shell" style={{height:600}}><StoredChat/></div>));
      await until(()=>document.querySelector('.work-toggle'),'completed response must have a work toggle');
      const click=async element=>{check(element,'missing click target');element.click();await wait();};
      const final=()=>document.querySelector('[data-record-id="final"]');
      check(document.querySelector('.work-toggle').getAttribute('aria-expanded')==='false'&&!document.querySelector('.tool-term'),'work must start folded without removing the final answer');
      const footer=final().querySelector('.response-footer'),footerText=footer.textContent;
      await click(footer.querySelector('[aria-label="Copy response"]'));
      check(copied.at(-1)==='Checking file\\n\\nFinal answer','copy must include the complete response, not only its visible final answer');
      await click(document.querySelector('.work-toggle'));
      await until(()=>document.querySelector('.work-toggle')?.getAttribute('aria-expanded')==='true','work toggle must expand while history is pending');
      const output=document.querySelector('.tool-term-output');
      check(output?.textContent===log,'expanded work must retain the complete tool output');
      output.scrollTop=80;const top=output.scrollTop;
      const range=document.createRange();range.selectNodeContents(output);const selection=getSelection();selection.removeAllRanges();selection.addRange(range);
      const selected=selection.toString();check(top>0&&selected===log,'tool fixture must scroll and remain completely selectable');
      const publish=next=>{current=newerSnapshot(current,next);flushSync(()=>useStore.setState({snapshots:{chat:current}}));};
      for(let i=0;i<8;i++){
        const next=structuredClone(current);next.snapshotSeq++;
        next.transcript.records.at(-1).message.content[0].text+=' token';
        publish(next);await wait();
        check(document.querySelector('.tool-term-output')===output&&output.scrollTop===top&&selection.toString()===selected,'live updates must preserve expanded work, scroll and selection');
        check(final().querySelector('.response-footer')===footer&&footer.textContent===footerText,'completed footer statistics must remain unchanged');
      }
      selection.removeAllRanges();
      await click(document.querySelector('.work-toggle'));
      check(!document.querySelector('[data-record-id="step"]'),'closing work must still remove its intermediate rows');
      flushSync(()=>useStore.setState({jump:{sessionId:'chat',entryId:'step',nonce:1}}));
      await until(()=>useStore.getState().jump===undefined&&document.querySelector('[data-record-id="step"].search-target'),'search must unfold and reveal the cached work range');
      const step=document.querySelector('[data-record-id="step"]');
      check(document.querySelector('.tool-term-output').scrollTop===top,'search reopening must restore the internal tool scroll');
      check(![...document.querySelectorAll('button')].some(button=>button.textContent==='Load earlier messages'),'history must not require a load button');
      replyHistory({history:{revision:'branch'},
        records:[user('earlier-user',0),assistant('earlier-step',1,[text('Earlier work')]),assistant('earlier-final',2,[text('Earlier final')])],
        tools:{},running:false,current:null,liveToEntry:{}});
      await until(()=>document.querySelector('[data-record-id="earlier-final"]'),'history must be automatically prepended');
      current=useStore.getState().snapshots.chat;
      check(document.querySelector('[data-record-id="step"]')===step&&document.querySelectorAll('.work-toggle').length===2,'prepend must recompute indices without losing the existing open work');
      const complete=structuredClone(current);complete.snapshotSeq++;complete.transcript.running=false;complete.transcript.current=null;
      complete.transcript.records.at(-1).id='saved-live';complete.transcript.records.at(-1).entryId='saved-live';complete.transcript.liveToEntry.live='saved-live';
      publish(complete);await wait();
      check(document.querySelectorAll('.response-footer').length===3&&document.querySelector('[data-record-id="saved-live"]'),'completion and live-to-saved migration must show the final footer');
      const branch=structuredClone(current);branch.snapshotSeq++;branch.transcript.history={revision:'replacement'};
      branch.transcript.records=[user('branch-user',0),assistant('branch-final',1,[text('Replacement answer')])];branch.transcript.tools={};
      publish(branch);await wait();
      check(document.querySelector('[data-record-id="branch-final"]')&&!document.querySelector('.work-toggle')&&!document.querySelector('.tool-term')&&document.querySelectorAll('.response-footer').length===1,'branch replacement must discard cached work and old statistics');
      root.unmount();
      `,
    ),
  60_000,
);
