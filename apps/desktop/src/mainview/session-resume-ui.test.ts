import { test } from "bun:test";
import { existsSync } from "node:fs";
import {
  fixtureEdge,
  fixtureHelpers,
  fixtureImport,
  runUiFixture,
} from "../../scripts/ui-fixture";

const local = (path: string) => fixtureImport(new URL(path, import.meta.url));

for (const action of ["fork", "rewind"]) {
  test.skipIf(!existsSync(fixtureEdge) && !process.env.PIG_REQUIRE_UI_TESTS)(
    `unknown sends can recover through ${action} after confirmed Stop without replay`,
    () =>
      runUiFixture(
        `unknown-send-${action}`,
        `
    const {createRoot}=await import(${fixtureImport(import.meta.resolve("react-dom/client"))});
    const {flushSync}=await import(${fixtureImport(import.meta.resolve("react-dom"))});
    const {fauxAssistantMessage}=await import(${fixtureImport(import.meta.resolve("@earendil-works/pi-ai"))});
    const {Chat}=await import(${local("./App.tsx")});
    const {useStore}=await import(${local("./store.ts")});
    const {drafts}=await import(${local("./draft-store.ts")});
    const {sends,forkChat,regenerate}=await import(${local("./rpc.ts")});
    await import(${local("./styles.css")});
    ${fixtureHelpers}
    const root=createFixtureRoot(createRoot),requests=[],events=[],stopped=Promise.withResolvers();
    const address={hostId:'recovery',sessionId:'${action}-chat',epoch:1};
    const nextAddress=${JSON.stringify(action)}==='fork'?{...address,sessionId:'branch',epoch:2}:address;
    const model={provider:'fixture',id:'fixture',name:'Fixture'};
    const user={role:'user',content:'original request',timestamp:1};
    const original={id:'user-entry',entryId:'user-entry',parentId:null,branchId:'root',order:0,kind:'message',message:user};
    let snapshot={address,snapshotSeq:1,info:{id:address.sessionId,cwd:'fixture',title:'Fixture',modified:1},model,effort:'off',effortLevels:[],
      transcript:{records:[original],tools:{},running:true,current:null,liveToEntry:{}}};
    let recovered={...snapshot,address:nextAddress,snapshotSeq:2,info:{...snapshot.info,id:nextAddress.sessionId},
      transcript:{...snapshot.transcript,running:false,records:[]}};
    window.__requests={
      listSlashCommands:()=>[],listSessions:()=>[],
      syncDraft:params=>({applied:true,draft:{...params.content,revision:params.expectedRevision+1}}),
      prompt:params=>{requests.push(params);if(requests.length===1)throw new Error('Lost send response');return {disposition:'started'};},
      getPromptReceipt:()=>{throw new Error('Receipt service unavailable');},
      abort:async()=>{events.push('stop');await stopped.promise;},
      forkSession:()=>{events.push('fork');return recovered;},
      rewindSession:()=>{events.push('rewind');return recovered;},
    };
    useStore.setState(s=>({hostId:address.hostId,addresses:{[address.sessionId]:address},snapshots:{[address.sessionId]:snapshot},active:address.sessionId,page:'chat',
      settings:{...s.settings,language:'en'},bootstrap:{...s.bootstrap,models:[model],disabledModels:[]}}));
    const render=async()=>{flushSync(()=>{sends.reconcile(snapshot);root.render(<Chat snapshot={snapshot}/>);});await wait();};
    await render();
    drafts.edit(address,content=>({...content,text:'failed steering'}));await sends.send(address);
    await sends.lookup(address);await sends.lookup(address);
    check(sends.read(address).state==='unknown','fixture must begin with an unconfirmed failed send');
    const recovery=${JSON.stringify(action)}==='fork'?forkChat(address.sessionId,'user-entry'):regenerate(address.sessionId,user,'user-entry');
    await until(()=>events.length===1,'recovery must request Stop first');
    check(events[0]==='stop','history must not change before Stop is confirmed');
    stopped.resolve();await recovery;
    check(events.join(',')==='stop,${action}','recovery must succeed despite unavailable receipt lookup');
    check(sends.retained().some(send=>send.detached&&send.content?.text==='failed steering'),'unknown payload must stay retained on the old operation');
    if(${JSON.stringify(action)}==='fork'){
      check(requests.length===1,'branching must not resend the unknown input');
      drafts.edit(nextAddress,content=>({...content,text:'new branch request'}));await sends.send(nextAddress);
    }
    check(requests.length===2&&requests[1].text===(${JSON.stringify(action)}==='fork'?'new branch request':'original request'),'only the explicit recovery instruction may be sent');
    snapshot={...recovered,snapshotSeq:3,transcript:{...recovered.transcript,records:[
      {...original,id:'recovered-user',entryId:'recovered-user',requestId:requests[1].requestId,message:{...user,content:requests[1].text}},
      {id:'answer',entryId:'answer',parentId:'recovered-user',branchId:'root',order:1,kind:'message',message:fauxAssistantMessage('recovered response')},
    ]}};
    await render();
    check(!document.querySelector('.user-steer')&&!document.querySelector('.send-button.waiting'),'recovered chat must have no stuck steering or send spinner');
    check(document.querySelector('.send-button').getAttribute('aria-label')==='Send','recovered chat must be usable for the next send');
    check(requests.length===2,'recovery must never replay the failed input');
    root.unmount();
  `,
        { realRpc: true },
      ),
    60_000,
  );
}

test.skipIf(!existsSync(fixtureEdge) && !process.env.PIG_REQUIRE_UI_TESTS)(
  "rejected and cancelled steering leave no ghost message and the same chat can resume without replay",
  () =>
    runUiFixture(
      "failed-steering",
      `
    const {createRoot}=await import(${fixtureImport(import.meta.resolve("react-dom/client"))});
    const {flushSync}=await import(${fixtureImport(import.meta.resolve("react-dom"))});
    const {Chat}=await import(${local("./App.tsx")});
    const {useStore}=await import(${local("./store.ts")});
    const {drafts}=await import(${local("./draft-store.ts")});
    const {sends}=await import(${local("./rpc.ts")});
    await import(${local("./styles.css")});
    ${fixtureHelpers}
    const root=createFixtureRoot(createRoot),requests=[],pending=[];
    const address={hostId:'failed-steering',sessionId:'chat',epoch:1};
    const model={provider:'fixture',id:'fixture',name:'Fixture'};
    window.__requests={
      listSlashCommands:()=>[],
      syncDraft:params=>({applied:true,draft:{...params.content,revision:params.expectedRevision+1}}),
      prompt:params=>{requests.push(params);const gate=Promise.withResolvers();pending.push(gate);return gate.promise;},
      getPromptReceipt:params=>({...params,state:'rejected',code:'PREFLIGHT_FAILED',message:'Send failed'}),
    };
    useStore.setState(s=>({settings:{...s.settings,language:'en'},bootstrap:{...s.bootstrap,models:[model],disabledModels:[]}}));
    let snapshot={address,info:{id:'chat',cwd:'fixture',title:'Fixture',modified:1},model,effort:'off',effortLevels:[],
      transcript:{records:[],tools:{},running:true,current:null,liveToEntry:{}}};
    const render=async()=>{flushSync(()=>{sends.reconcile(snapshot);root.render(<Chat snapshot={snapshot}/>);});await wait();};
    const button=()=>document.querySelector('.send-button');
    await render();
    drafts.edit(address,content=>({...content,text:'Keep this instruction'}));
    const rejected=sends.send(address);
    await until(()=>requests.length===1&&document.querySelector('.user-steer'),'in-flight steering must be visible');
    pending[0].reject(new Error('Send failed'));await rejected;await wait();
    check(!document.querySelector('.user-steer'),'rejected steering must disappear');
    check(drafts.read(address).content.text==='Keep this instruction','confirmed rejection must restore the input');
    check(button().getAttribute('aria-label')==='Send'&&!button().disabled,'a rejected send must not disable the composer');
    const queued=sends.send(address);
    await until(()=>requests.length===2,'a manual retry must send a new request');
    pending[1].resolve({disposition:'queued'});await queued;await wait();
    check(document.querySelector('.user-steer'),'accepted steering must remain visible until consumed or cancelled');
    const recovered={id:'cancelled',requestId:requests[1].requestId,parentId:null,branchId:'root',order:0,kind:'message',
      customType:'Cancelled queued prompt',display:true,
      message:{role:'custom',customType:'Cancelled queued prompt',display:true,content:[{type:'text',text:'Keep this instruction'}],details:{requestId:requests[1].requestId},timestamp:1}};
    snapshot={...snapshot,failure:'SDK dispatch failed',transcript:{...snapshot.transcript,running:false,records:[recovered]}};
    await render();
    check(!document.querySelector('.user-steer')&&!document.querySelector('.message.user'),'cancelled steering must not leave a ghost message');
    check(sends.optimistic(address).length===0,'recovered request identity must release the optimistic queue');
    check(snapshot.transcript.records[0].message.content[0].text==='Keep this instruction','cancelled input must remain preserved');
    check(requests.length===2,'neither rejection nor cancellation may resend automatically');
    check(button().getAttribute('aria-label')==='Resume'&&!button().disabled,'the same chat must offer an enabled Resume');
    button().click();await until(()=>requests.length===3,'the same chat must accept a manual Resume');
    check(requests[2].text==='continue','Resume must not replay cancelled steering');
    pending[2].resolve({disposition:'started'});
    snapshot={...snapshot,failure:undefined,transcript:{...snapshot.transcript,running:true,records:[recovered,{
      id:'resumed',requestId:requests[2].requestId,display:false,parentId:null,branchId:'root',order:1,kind:'message',
      message:{role:'user',content:'continue',timestamp:2},
    }]}};
    await render();await until(()=>button().getAttribute('aria-label')==='Stop'&&!button().disabled,'resumed chat must restore Stop');
    check(requests.length===3&&!document.querySelector('.user-steer'),'resuming must not resurrect failed steering');
    root.unmount();
  `,
      { realRpc: true },
    ),
  60_000,
);

test.skipIf(!existsSync(fixtureEdge) && !process.env.PIG_REQUIRE_UI_TESTS)(
  "unconfirmed sends leave no permanent steering bubble and retain data without replay",
  () =>
    runUiFixture(
      "unconfirmed-send",
      `
    const {createRoot}=await import(${fixtureImport(import.meta.resolve("react-dom/client"))});
    const {flushSync}=await import(${fixtureImport(import.meta.resolve("react-dom"))});
    const {Chat}=await import(${local("./App.tsx")});
    const {useStore}=await import(${local("./store.ts")});
    const {drafts}=await import(${local("./draft-store.ts")});
    const {sends}=await import(${local("./rpc.ts")});
    await import(${local("./styles.css")});
    ${fixtureHelpers}
    const root=createFixtureRoot(createRoot),gate=Promise.withResolvers(),requests=[];
    const address={hostId:'unconfirmed',sessionId:'chat',epoch:1};
    window.__requests={
      listSlashCommands:async()=>[],
      syncDraft:async params=>({applied:true,draft:{...params.content,revision:params.expectedRevision+1}}),
      prompt:params=>{requests.push(params);return gate.promise;},
      getPromptReceipt:async()=>{throw new Error('Disconnected');},
    };
    useStore.setState(s=>({settings:{...s.settings,language:'en'}}));
    let snapshot={address,info:{id:'chat',cwd:'fixture',title:'Fixture',modified:1},effort:'off',effortLevels:[],
      transcript:{records:[],tools:{},running:true,current:null,liveToEntry:{}}};
    const render=async()=>{flushSync(()=>root.render(<Chat snapshot={snapshot}/>));await wait();};
    await render();
    drafts.edit(address,content=>({...content,text:'作業を続けて'}));
    const sending=sends.send(address);
    await until(()=>requests.length===1&&document.querySelector('.user-steer'),'pending input must initially appear as steering');
    gate.reject(new Error('Prompt response disconnected'));await sending;
    await sends.lookup(address);await sends.lookup(address);
    snapshot={...snapshot,failure:'Request failed',transcript:{...snapshot.transcript,running:false}};
    await render();
    check(sends.read(address).state==='unknown','repeated receipt failures must leave an honest unknown state');
    check(!document.querySelector('.message.user'),'unknown input must not remain as steering or a normal optimistic bubble');
    check(sends.retained()[0].content.text==='作業を続けて','unknown payload must remain recoverable');
    check(requests.length===1,'unknown input must never resend automatically');
    snapshot={...snapshot,transcript:{...snapshot.transcript,records:[{
      id:'committed',requestId:requests[0].requestId,parentId:null,branchId:'root',order:0,kind:'message',
      message:{role:'user',content:'作業を続けて',timestamp:1},
    }]}};
    sends.reconcile(snapshot);await render();
    check(sends.read(address).state==='accepted','confirmed history must resolve unknown status even when receipt lookup is still disconnected');
    await sends.wait(address);
    check(document.querySelectorAll('.message.user').length===1&&document.querySelector('.user-bubble').textContent==='作業を続けて','confirmed history must remain visible exactly once');
    check(requests.length===1,'history reconciliation must not replay input');
    root.unmount();
  `,
      { realRpc: true },
    ),
  60_000,
);

test.skipIf(!existsSync(fixtureEdge) && !process.env.PIG_REQUIRE_UI_TESTS)(
  "read failures stay red and interrupted composers resume through the durable send path",
  () =>
    runUiFixture(
      "session-resume",
      `
    const {createRoot}=await import(${fixtureImport(import.meta.resolve("react-dom/client"))});
    const {flushSync}=await import(${fixtureImport(import.meta.resolve("react-dom"))});
    const {fauxAssistantMessage}=await import(${fixtureImport(import.meta.resolve("@earendil-works/pi-ai"))});
    const {Chat}=await import(${local("./App.tsx")});
    const {SidebarSessions}=await import(${local("./SidebarSessions.tsx")});
    const {useStore}=await import(${local("./store.ts")});
    const {drafts}=await import(${local("./draft-store.ts")});
    const {sends}=await import(${local("./rpc.ts")});
    await import(${local("./styles.css")});
    ${fixtureHelpers}
    const root=createFixtureRoot(createRoot);
    const model={provider:'fixture',id:'fixture',name:'Fixture'};
    const address={hostId:'fixture',sessionId:'failed-chat',epoch:1};
    const info={id:address.sessionId,cwd:'project',title:'Failed chat',modified:2};
    const assistant=stopReason=>({id:'answer-'+stopReason,parentId:null,branchId:'root',order:1,kind:'message',message:{...fauxAssistantMessage(''),stopReason,errorMessage:stopReason==='error'?'WebSocket closed 1000':undefined}});
    let snapshot={address,info,effort:'off',effortLevels:[],model,transcript:{records:[assistant('error')],tools:{},running:false,current:null,liveToEntry:{}}};
    const other={...snapshot,address:{...address,sessionId:'working'},info:{...info,id:'working',title:'Working',modified:1},transcript:{...snapshot.transcript,records:[],running:true}};
    const requests=[];
    const pending=[];
    window.__requests={
      listSlashCommands:()=>[],
      syncDraft:params=>({applied:true,draft:{...params.content,revision:params.expectedRevision+1}}),
      prompt:params=>{requests.push(params);const gate=Promise.withResolvers();pending.push(gate);return gate.promise;},
      getPromptReceipt:params=>({...params,state:'pending'}),
    };
    useStore.setState(s=>({initialized:true,hostId:address.hostId,active:address.sessionId,page:'chat',
      settings:{...s.settings,language:'en'},sessions:{project:[info,other.info]},
      bootstrap:{...s.bootstrap,projects:['project'],generalCwd:'',models:[model],disabledModels:[],desktop:{sessions:{[info.id]:{completion:{id:'error',outcome:'error'}}}}}}));
    const render=async()=>{
      flushSync(()=>{
        useStore.setState({snapshots:{[info.id]:snapshot,working:other}});
        sends.reconcile(snapshot);
        root.render(<div style={{display:'flex',height:600}}><aside className="sidebar" style={{width:260}}><SidebarSessions/></aside><div className="chat-shell" style={{width:640}}><Chat snapshot={snapshot}/></div></div>);
      });await wait();
    };
    const button=()=>document.querySelector('.send-button');
    const checkRed=()=>{
      check(document.querySelector('.thread-row.active .session-dot.failed'),'chat must remain red');
      check(document.querySelector('.project-activity .session-dot.failed'),'project failure must outrank another running chat');
      const dot=document.querySelector('.thread-row.active .session-dot');
      check(getComputedStyle(dot).animationName==='none','failure must not pulse');
      check(getComputedStyle(dot).boxShadow!=='none','failure must retain its glow');
    };
    await render();checkRed();
    check(button().getAttribute('aria-label')==='Resume'&&!button().disabled&&button().querySelector('.lucide-play'),'legacy error must offer an enabled Resume icon');
    const bounds=element=>{const r=element.getBoundingClientRect();return [r.x,r.y,r.width,r.height];};
    const initial=JSON.stringify([bounds(button()),bounds(document.querySelector('.composer')),bounds(document.querySelector('.thread-row.active'))]);
    flushSync(()=>useStore.setState(s=>({bootstrap:{...s.bootstrap,desktop:{...s.bootstrap.desktop,sessions:{}}}})));
    await wait();checkRed();
    flushSync(()=>useStore.setState(s=>({bootstrap:{...s.bootstrap,desktop:{...s.bootstrap.desktop,sessions:{[info.id]:{completion:{id:'error',outcome:'error'},readCompletionId:'error'}}}}})));
    await wait();checkRed();
    check(initial===JSON.stringify([bounds(button()),bounds(document.querySelector('.composer')),bounds(document.querySelector('.thread-row.active'))]),'reading must not shift row, composer or action');
    button().click();button().click();
    await until(()=>requests.length===1,'Resume must issue a prompt');
    check(requests[0].text==='continue','Resume must send only continue');
    check(requests[0].delivery==='steer'&&requests[0].requestId,'Resume must use normal receipt-backed delivery');
    check(!drafts.read(address).content.text,'Resume must capture and clear synchronously');
    check(!document.querySelector('.message.user'),'pending Resume must not render a user turn');
    check(button().getAttribute('aria-busy')==='true'&&button().disabled,'pending Resume must use a disabled spinner');
    button().click();await wait();check(requests.length===1,'disabled spinner must not dispatch another send');
    pending[0].resolve({disposition:'started'});
    snapshot={...snapshot,transcript:{...snapshot.transcript,running:true,records:[...snapshot.transcript.records,{id:'resumed-user',requestId:requests[0].requestId,display:false,parentId:null,branchId:'root',order:2,kind:'message',message:{role:'user',content:requests[0].text,timestamp:1}}]}};
    await render();
    await until(()=>button().getAttribute('aria-label')==='Stop','resumed response must show Stop');
    check(requests.length===1,'repeated Resume must not dispatch twice');
    check(!document.querySelector('.message.user'),'committed Resume must not leave text or an empty turn');
    check(document.querySelector('.thread-row.active .session-dot.running'),'restart must clear stale historical failure');
    check(JSON.stringify(bounds(button()))===JSON.stringify(JSON.parse(initial)[0]),'Resume, waiting and Stop must share the same action slot');
    const actionBounds=JSON.stringify(bounds(button()));
    const pickerBounds=JSON.stringify(bounds(document.querySelector('.composer-pickers')));
    flushSync(()=>drafts.edit(address,content=>({...content,text:'While responding'})));await wait();
    check(document.querySelectorAll('.send-controls button').length===1&&button().getAttribute('aria-label')==='Send','typing during a response must replace Stop with one Send');
    check(JSON.stringify(bounds(button()))===actionBounds&&JSON.stringify(bounds(document.querySelector('.composer-pickers')))===pickerBounds,'typing must not shift the action or pickers');
    flushSync(()=>drafts.edit(address,content=>({...content,text:''})));await wait();
    check(document.querySelectorAll('.send-controls button').length===1&&button().getAttribute('aria-label')==='Stop','clearing input must restore only Stop');
    flushSync(()=>drafts.edit(address,content=>({...content,text:'While responding'})));await wait();
    button().click();await until(()=>requests.length===2,'running response must allow the next message');
    check(requests[1].text==='While responding','Send must capture the next message');
    check(document.querySelectorAll('.send-controls button').length===1&&button().getAttribute('aria-busy')==='true'&&button().disabled,'sending during a response must show one disabled spinner');
    button().click();await wait();check(requests.length===2,'running send spinner must ignore clicks');
    check(JSON.stringify(bounds(button()))===actionBounds,'pending send must keep the same action slot');
    pending[1].resolve({disposition:'queued'});
    await until(()=>button().getAttribute('aria-label')==='Stop'&&!button().disabled,'queued steering must restore an enabled Stop before entering history');
    check(document.querySelector('.user-steer')?.textContent.includes('While responding'),'accepted steering must remain visible while queued');
    check(JSON.stringify(bounds(button()))===actionBounds&&JSON.stringify(bounds(document.querySelector('.composer-pickers')))===pickerBounds,'queue acceptance must not shift the action or pickers');
    flushSync(()=>drafts.edit(address,content=>({...content,text:'Another instruction'})));await wait();
    check(button().getAttribute('aria-label')==='Send'&&!button().disabled,'queued steering must not block the next instruction');
    flushSync(()=>drafts.edit(address,content=>({...content,text:''})));await wait();
    check(button().getAttribute('aria-label')==='Stop'&&!button().disabled,'clearing the next draft must restore Stop while steering is queued');
    snapshot={...snapshot,transcript:{...snapshot.transcript,records:[...snapshot.transcript.records,{id:'follow-up',requestId:requests[1].requestId,parentId:null,branchId:'root',order:3,kind:'message',message:{role:'user',content:requests[1].text,timestamp:2}}]}};
    await render();await until(()=>button().getAttribute('aria-label')==='Stop','acknowledged next message must restore Stop');
    snapshot={...snapshot,transcript:{...snapshot.transcript,running:false,records:[...snapshot.transcript.records,assistant('stop')]}};
    useStore.setState(s=>({bootstrap:{...s.bootstrap,desktop:{...s.bootstrap.desktop,sessions:{[info.id]:{completion:{id:'ok',outcome:'success'},readCompletionId:'ok'}}}}}));
    await render();
    check(button().getAttribute('aria-label')==='Send'&&button().disabled,'successful completion must return to empty Send');
    snapshot={...snapshot,aborted:true,transcript:{...snapshot.transcript,records:[assistant('aborted')]}};
    await render();check(button().getAttribute('aria-label')==='Resume'&&!button().disabled,'manual stop must also allow Resume');
    snapshot={...snapshot,modelCatalog:[]};await render();
    check(button().getAttribute('aria-label')==='Resume'&&button().disabled,'Resume must preserve model validation');
    snapshot={...snapshot,modelCatalog:[model]};await render();
    flushSync(()=>drafts.edit(address,content=>({...content,text:'A new instruction'})));await wait();
    check(button().getAttribute('aria-label')==='Send','typed instruction must take priority over Resume');
    button().click();await until(()=>requests.length===3,'typed instruction must send');
    check(requests[2].text==='A new instruction','Resume must not overwrite typed instructions');
    pending[2].resolve({disposition:'started'});
    await wait();
    check(document.querySelector('.composer-dock').lastElementChild.matches('form.composer'),'Resume must not add a footer message');
    snapshot={...snapshot,aborted:false,transcript:{...snapshot.transcript,running:false,records:[{id:'typed-continue',parentId:null,branchId:'root',order:1,kind:'message',message:{role:'user',content:'continue',timestamp:3}}]}};
    await render();
    check(document.querySelector('.user-bubble')?.textContent==='continue','manually typed continue must remain visible');
  `,
      { realRpc: true },
    ),
  60_000,
);
