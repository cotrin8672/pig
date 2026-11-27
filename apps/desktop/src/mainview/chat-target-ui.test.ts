import { test } from "bun:test";
import {
  fixtureHelpers,
  fixtureImport,
  runUiFixture,
} from "../../scripts/ui-fixture";

test(
  "new-chat target selection keeps the draft and sends only to the chosen PC and project",
  () =>
    runUiFixture(
      "chat-target",
      `
      const {createRoot}=await import(${fixtureImport(import.meta.resolve("react-dom/client"))});
      const {flushSync}=await import(${fixtureImport(import.meta.resolve("react-dom"))});
      await import(${fixtureImport(new URL("./styles.css", import.meta.url))});
      const {ChatOpening}=await import(${fixtureImport(new URL("./ChatOpening.tsx", import.meta.url))});
      const {RemoteConversation}=await import(${fixtureImport(new URL("./RemoteConversation.tsx", import.meta.url))});
      const {openChat,openRemoteDraft}=await import(${fixtureImport(new URL("./rpc.ts", import.meta.url))});
      const {useStore}=await import(${fixtureImport(new URL("./store.ts", import.meta.url))});
      ${fixtureHelpers}
      const root=createFixtureRoot(createRoot);
      const work='Work with a very long project name';
      const host={id:'home',name:'Home PC',online:true,projects:[{id:'one',name:'First'},{id:'two',name:'Second'}]};
      useStore.setState(s=>({
        bootstrap:{...s.bootstrap,generalCwd:'general',projects:[work]},
        remoteHosts:[host,{id:'off',name:'Offline PC',online:false}],
      }));
      const calls=[];
      let reply;
      window.__requests={remoteWorkspace:async({id,query:q})=>{
        calls.push([id,q]);
        if(q.op==='new')return {chat:'chat',view:'view'};
        if(q.op==='send')return new Promise((_,reject)=>{reply=reject});
        return {messages:[],running:false};
      }};
      function View() {
        const {page,openId}=useStore();
        return page==='remoteChat' ? <RemoteConversation/> : <ChatOpening openId={openId}/>;
      }
      await openChat('general');
      const current=()=>useStore.getState().openingTarget;
      const first=current().draftId;
      flushSync(()=>root.render(<div style={{width:'285px',height:'620px',position:'relative'}}><View/></div>));
      const input=()=>document.querySelector('textarea');
      const write=text=>{
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input(),text);
        input().dispatchEvent(new Event('input',{bubbles:true}));
      };
      const trigger=i=>document.querySelectorAll('.chat-target summary')[i];
      const option=text=>Array.from(document.querySelectorAll('.chat-target-panel [role="option"]')).find(el=>el.textContent.includes(text));
      async function choose(i,text){
        trigger(i).click();
        await until(()=>option(text),'target '+text);
        const panel=document.querySelector('.chat-target-panel');
        const tray=document.querySelector('.chat-target').getBoundingClientRect();
        const rect=panel.getBoundingClientRect();
        check(rect.left>=tray.left && rect.right<=tray.right+1 && rect.width>100,'picker fits a narrow pane');
        check(panel.contains(document.activeElement),'search focused');
        option(text).click();
        await until(()=>!document.querySelector('.chat-target-panel'),'picker dismissed');
      }
      flushSync(()=>write('  Keep this draft  '));
      await choose(1,work);
      check(current().cwd===work && current().draftId===first,'local Project retargets the same draft');
      await choose(0,'Home PC');
      await choose(1,'Second');
      check(current().remote.project==='two' && input().value==='  Keep this draft  ','remote project retains the draft');
      trigger(0).click();
      await until(()=>option('Offline PC'),'offline PC row');
      check(option('Offline PC').disabled,'offline PC cannot be selected');
      document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
      await until(()=>!document.querySelector('.chat-target-panel'),'escape dismisses picker');
      check(calls.length===0,'selection does not create a session');
      const form=document.querySelector('.composer');
      const submit=()=>form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));
      useStore.setState({newChatFiles:{[first]:[{id:'file',path:'local-only',name:'file.txt'}]}});
      await until(()=>document.querySelector('.composer-attachments'),'local attachment present');
      submit();
      check(calls.length===0 && input().value==='  Keep this draft  ','unsupported attachments never reach remote or lose the draft');
      useStore.setState({newChatFiles:{}});
      await until(()=>!document.querySelector('.composer-attachments'),'attachment removed');
      submit();submit();
      await until(()=>reply && useStore.getState().page==='remoteChat' && !trigger(0),'first send binds to remote thread');
      check(calls.filter(([,q])=>q.op==='new').length===1 && calls[0][0]==='home' && calls[0][1].project==='two','exactly one remote open for the selected PC and Project');
      check(calls.filter(([,q])=>q.op==='send').length===1 && calls[1][1].text==='  Keep this draft  ','exactly one send with unchanged text');
      reply(Error('lost acknowledgement'));
      await until(()=>document.body.textContent.includes('受付を確認'),'uncertain receipt');
      check(input().value==='  Keep this draft  ' && Object.keys(localStorage).some(k=>k.endsWith(calls[1][1].id)),'uncertain first send remains recoverable');
      openRemoteDraft({host:host.id,hostName:host.name,project:'one'});
      await until(()=>trigger(1)?.textContent.includes('First'),'remote sidebar starts with its own Project selected');
      check(calls.filter(([,q])=>q.op==='new').length===1,'opening from the sidebar path is also deferred');
      `,
      { realRpc: true },
    ),
  120_000,
);
