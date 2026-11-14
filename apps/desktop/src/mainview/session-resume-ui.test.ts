import { test } from "bun:test";
import { existsSync } from "node:fs";
import {
  fixtureEdge,
  fixtureHelpers,
  fixtureImport,
  runUiFixture,
} from "../../scripts/ui-fixture";

const local = (path: string) => fixtureImport(new URL(path, import.meta.url));

test.skipIf(!existsSync(fixtureEdge) && !process.env.PIG_REQUIRE_UI_TESTS)(
  "read failures stay red and interrupted composers resume through the durable send path",
  () =>
    runUiFixture(
      "session-resume",
      `
    const {createRoot}=await import(${fixtureImport(import.meta.resolve("react-dom/client"))});
    const {flushSync}=await import(${fixtureImport(import.meta.resolve("react-dom"))});
    const {Composer}=await import(${local("./Composer.tsx")});
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
    const assistant=stopReason=>({id:'answer-'+stopReason,parentId:null,branchId:'root',order:1,kind:'message',message:{role:'assistant',content:[],stopReason,errorMessage:stopReason==='error'?'WebSocket closed 1000':undefined}});
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
        root.render(<div style={{display:'flex',height:600}}><aside className="sidebar" style={{width:260}}><SidebarSessions/></aside><div className="chat-shell" style={{width:640}}><Composer snapshot={snapshot}/></div></div>);
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
    check(requests[0].text.includes('Continue from where you stopped')&&!requests[0].text.includes('WebSocket'),'Resume must continue, not replay the failed request');
    check(requests[0].delivery==='steer'&&requests[0].requestId,'Resume must use normal receipt-backed delivery');
    check(!drafts.read(address).content.text,'Resume must capture and clear synchronously');
    check(button().getAttribute('aria-busy')==='true'&&button().disabled,'pending Resume must use a disabled spinner');
    button().click();await wait();check(requests.length===1,'disabled spinner must not dispatch another send');
    pending[0].resolve({disposition:'started'});
    snapshot={...snapshot,transcript:{...snapshot.transcript,running:true,records:[...snapshot.transcript.records,{id:'resumed-user',requestId:requests[0].requestId,parentId:null,branchId:'root',order:2,kind:'message',message:{role:'user',content:requests[0].text,timestamp:1}}]}};
    await render();
    await until(()=>button().getAttribute('aria-label')==='Stop','resumed response must show Stop');
    check(requests.length===1,'repeated Resume must not dispatch twice');
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
    pending[1].resolve({disposition:'started'});
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
  `,
      { realRpc: true },
    ),
  60_000,
);
